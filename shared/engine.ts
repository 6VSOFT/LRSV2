// 自动法官核心规则引擎（纯函数式变更 GameState，服务端唯一可信结算）
import {
  Board, BoardId, BOARDS, Continuation, DEFAULT_BOARD, DeathCause, Effect, GameState, GOD_ROLES, NIGHT_STEPS, NightState,
  NightStep, Player, Role, ROLE_NAMES, Settings, SpeechPurpose, Team, VoteResult, VoteState,
} from './types';

export class GameError extends Error {}
export type Rng = () => number;

export const OFFLINE_MS = 30_000;
const PRESENCE_WRITE_MS = 10_000;
/** 角色已死亡时的伪装等待，避免通过夜晚时长推断身份 */
const FAKE_STEP_MS: Record<NightStep, [number, number]> = {
  wolf: [0, 0], witch: [8_000, 16_000], seer: [8_000, 16_000], hunter: [4_000, 9_000],
};

export type Action =
  | { type: 'ready'; ready: boolean }
  | { type: 'seat'; seat: number }
  | { type: 'leave' }
  | { type: 'settings'; settings: Partial<Settings> }
  | { type: 'start' }
  | { type: 'wolf_pick'; targetId: string; lock: boolean }
  | { type: 'seer_check'; targetId: string }
  | { type: 'hunter_ack' }
  | { type: 'witch'; action: 'save' | 'poison' | 'none'; targetId?: string | null }
  | { type: 'continue' }
  | { type: 'hunter_shoot'; targetId: string | null }
  | { type: 'badge'; targetId: string | null }
  | { type: 'exile_confirm' }
  | { type: 'restart' }
  | { type: 'sheriff_signup'; join: boolean }
  | { type: 'sheriff_withdraw' }
  | { type: 'speech_done' }
  | { type: 'speech_skip' }
  | { type: 'speech_order'; direction: 'cw' | 'ccw' }
  | { type: 'sheriff_suggest'; targetId: string | null }
  | { type: 'vote'; targetId: string | null };

// ---------------- 工具函数 ----------------

function fail(msg: string): never {
  throw new GameError(msg);
}

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randRange([lo, hi]: [number, number], rng: Rng) {
  return lo + Math.floor(rng() * (hi - lo));
}

export function getPlayer(state: GameState, id: string | null | undefined): Player | undefined {
  return state.players.find((p) => p.id === id);
}

function mustPlayer(state: GameState, id: string | null | undefined): Player {
  return getPlayer(state, id) ?? fail('玩家不存在');
}

function bySeat(state: GameState, ids: string[]): string[] {
  return ids.slice().sort((a, b) => mustPlayer(state, a).seat - mustPlayer(state, b).seat);
}

export function alivePlayers(state: GameState): Player[] {
  return state.players.filter((p) => p.alive).sort((a, b) => a.seat - b.seat);
}

function aliveWithRole(state: GameState, role: Player['role']): Player | undefined {
  return state.players.find((p) => p.alive && p.role === role);
}

export function seatLabel(state: GameState, id: string | null | undefined): string {
  const p = getPlayer(state, id);
  return p ? `${p.seat}号（${p.nickname}）` : '未知';
}

function log(state: GameState, now: number, text: string, isPublic: boolean) {
  state.log.push({ at: now, day: state.day, text, public: isPublic });
}

function setPhase(state: GameState, phase: GameState['phase'], now: number) {
  state.phase = phase;
  state.phaseStartedAt = now;
}

export function isConnected(p: Player, now: number) {
  return now - p.lastSeen < OFFLINE_MS;
}

// ---------------- 房间 ----------------

export const DEFAULT_SETTINGS: Settings = { idiotFlipSurvives: false, speechSeconds: 120 };

/** 警长发言比其他玩家多 30 秒 */
export const SHERIFF_BONUS_SECONDS = 30;

export function speechSecondsFor(settings: Settings, sheriffId: string | null, speakerId: string | null | undefined): number {
  return settings.speechSeconds + (speakerId && speakerId === sheriffId ? SHERIFF_BONUS_SECONDS : 0);
}

export function newPlayer(id: string, nickname: string, tokenHash: string, seat: number, now: number): Player {
  return {
    id, seat, nickname, tokenHash, ready: false, role: null, alive: true, deathCause: null,
    deathDay: null, revealed: false, canVote: true, lastSeen: now,
  };
}

export function getBoard(state: Pick<GameState, 'board'>): Board {
  return BOARDS[state.board ?? DEFAULT_BOARD];
}

export function parseBoardId(raw: unknown): BoardId {
  if (raw == null || raw === '') return DEFAULT_BOARD;
  if (typeof raw === 'string' && raw in BOARDS) return raw as BoardId;
  fail('未知的板子');
}

export function createGame(
  code: string, creator: { id: string; nickname: string; tokenHash: string }, now: number, board: BoardId = DEFAULT_BOARD,
): GameState {
  return {
    code, board, createdAt: now, creatorId: creator.id, settings: { ...DEFAULT_SETTINGS },
    status: 'lobby', phase: 'lobby', phaseStartedAt: now, day: 0,
    players: [newPlayer(creator.id, validateNickname(creator.nickname), creator.tokenHash, 1, now)],
    sheriffId: null, electionDone: false, sheriffSuggestion: null,
    witchPotions: { antidote: true, poison: true }, night: null, seerChecks: [], dawnDeaths: [],
    election: null, speech: null, speechDirection: null, vote: null, voteResults: [],
    exiledPendingId: null, effects: [], continuation: null, winner: null, winReason: null, log: [],
  };
}

export function validateNickname(raw: string): string {
  const name = (raw ?? '').toString().trim().replace(/\s+/g, ' ');
  if (name.length < 1) fail('请输入昵称');
  if ([...name].length > 12) fail('昵称最多 12 个字');
  return name;
}

export function addPlayer(state: GameState, p: { id: string; nickname: string; tokenHash: string }, now: number): Player {
  if (state.status !== 'lobby') fail('游戏已开始，无法加入');
  const size = getBoard(state).size;
  if (state.players.length >= size) fail(`房间已满（${size} 人）`);
  const nickname = validateNickname(p.nickname);
  if (state.players.some((x) => x.nickname === nickname)) fail('昵称已被使用');
  if (state.players.some((x) => x.id === p.id)) fail('你已在房间中');
  const taken = new Set(state.players.map((x) => x.seat));
  let seat = 1;
  while (taken.has(seat)) seat++;
  const player = newPlayer(p.id, nickname, p.tokenHash, seat, now);
  state.players.push(player);
  state.players.sort((a, b) => a.seat - b.seat);
  return player;
}

/** 记录在线状态；只有在显著过期时才需要写库，返回是否修改 */
export function touch(state: GameState, playerId: string, now: number): boolean {
  const p = getPlayer(state, playerId);
  if (!p || now - p.lastSeen < PRESENCE_WRITE_MS) return false;
  p.lastSeen = now;
  return true;
}

// ---------------- 动作入口 ----------------

export function applyAction(state: GameState, actorId: string, action: Action, now: number, rng: Rng): void {
  const actor = mustPlayer(state, actorId);
  actor.lastSeen = now;
  if (action.type === 'restart') return restartGame(state, actor, now);
  if (state.status === 'ended') fail('游戏已结束');

  if (state.status === 'lobby') {
    lobbyAction(state, actor, action, now, rng);
    return;
  }

  advanceTimers(state, now, rng);
  if (state.status !== 'playing') fail('游戏已结束');

  switch (action.type) {
    case 'wolf_pick': return wolfPick(state, actor, action.targetId, action.lock, now, rng);
    case 'seer_check': return seerCheck(state, actor, action.targetId, now, rng);
    case 'hunter_ack': return hunterAck(state, actor, now, rng);
    case 'witch': return witchAct(state, actor, action.action, action.targetId ?? null, now, rng);
    case 'continue': return dawnContinue(state, now, rng);
    case 'hunter_shoot': return hunterShoot(state, actor, action.targetId, now, rng);
    case 'badge': return badgeAct(state, actor, action.targetId, now, rng);
    case 'exile_confirm': return exileConfirm(state, actor, now, rng);
    case 'sheriff_signup': return sheriffSignup(state, actor, action.join, now, rng);
    case 'sheriff_withdraw': return sheriffWithdraw(state, actor, now, rng);
    case 'speech_done': return speechDone(state, actor, false, now, rng);
    case 'speech_skip': return speechDone(state, actor, true, now, rng);
    case 'speech_order': return speechOrder(state, actor, action.direction, now);
    case 'sheriff_suggest': return sheriffSuggest(state, actor, action.targetId, now);
    case 'vote': return castVote(state, actor, action.targetId, now, rng);
    default: fail('游戏已开始，无法执行该操作');
  }
}

/** 处理时间驱动的推进（夜间伪装等待），返回是否有变化 */
export function tick(state: GameState, now: number, rng: Rng): boolean {
  if (state.status !== 'playing') return false;
  const before = state.phase + (state.night?.step ?? '');
  advanceTimers(state, now, rng);
  return before !== state.phase + (state.night?.step ?? '');
}

function advanceTimers(state: GameState, now: number, rng: Rng) {
  if (state.phase === 'night') {
    upgradeLegacyNight(state);
    advanceNight(state, now, rng);
  }
}

/** 兼容旧版本（狼人与预言家同时行动）保存的夜晚数据，升级后进行中的房间不会卡住 */
function upgradeLegacyNight(state: GameState) {
  const night = state.night as (NightState & { step: string }) | null;
  if (!night || (NIGHT_STEPS as string[]).includes(night.step)) return;
  night.step = night.killTargetId ? 'witch' : 'wolf';
  night.hunterAcked ??= false;
  night.fakeUntil ??= null;
}

// ---------------- 等待室 ----------------

function lobbyAction(state: GameState, actor: Player, action: Action, now: number, rng: Rng) {
  switch (action.type) {
    case 'ready':
      actor.ready = !!action.ready;
      return;
    case 'seat': {
      const seat = Math.floor(Number(action.seat));
      if (!(seat >= 1 && seat <= getBoard(state).size)) fail('座位号无效');
      if (state.players.some((p) => p.seat === seat && p.id !== actor.id)) fail('该座位已有人');
      actor.seat = seat;
      actor.ready = false;
      state.players.sort((a, b) => a.seat - b.seat);
      return;
    }
    case 'leave': {
      state.players = state.players.filter((p) => p.id !== actor.id);
      if (state.creatorId === actor.id && state.players.length > 0) state.creatorId = state.players[0].id;
      return;
    }
    case 'settings': {
      if (actor.id !== state.creatorId) fail('只有房间创建者可以修改设置');
      const s = action.settings ?? {};
      if (typeof s.idiotFlipSurvives === 'boolean') state.settings.idiotFlipSurvives = s.idiotFlipSurvives;
      if (typeof s.speechSeconds === 'number') {
        state.settings.speechSeconds = Math.min(600, Math.max(15, Math.floor(s.speechSeconds)));
      }
      state.players.forEach((p) => (p.ready = false));
      return;
    }
    case 'start':
      return startGame(state, actor, now, rng);
    default:
      fail('游戏尚未开始');
  }
}

/** 游戏结束后由房主把同一房间重置为等待室，保留玩家与座位，清空身份与记录 */
function restartGame(state: GameState, actor: Player, now: number) {
  if (state.status !== 'ended') fail('游戏尚未结束');
  if (actor.id !== state.creatorId) fail('只有房间创建者可以开始新一局');
  for (const p of state.players) {
    Object.assign(p, { ready: false, role: null, alive: true, deathCause: null, deathDay: null, revealed: false, canVote: true });
  }
  Object.assign(state, {
    status: 'lobby', day: 0, sheriffId: null, electionDone: false, sheriffSuggestion: null,
    witchPotions: { antidote: true, poison: true }, night: null, seerChecks: [], dawnDeaths: [],
    election: null, speech: null, speechDirection: null, vote: null, voteResults: [],
    exiledPendingId: null, effects: [], continuation: null, winner: null, winReason: null, log: [],
  } satisfies Partial<GameState>);
  setPhase(state, 'lobby', now);
}

export function startGame(state: GameState, actor: Player, now: number, rng: Rng) {
  if (actor.id !== state.creatorId) fail('只有房间创建者可以开始游戏');
  const board = getBoard(state);
  if (state.players.length !== board.size) fail(`需要 ${board.size} 名玩家，目前 ${state.players.length} 名`);
  if (state.players.some((p) => !p.ready)) fail('还有玩家未准备');
  const roles = shuffle(board.roles, rng);
  state.players.forEach((p, i) => {
    p.role = roles[i];
    p.alive = true;
  });
  state.status = 'playing';
  state.day = 1;
  log(state, now, `游戏开始：${board.name}（${board.summary}），身份已发放`, true);
  for (const p of state.players) log(state, now, `${seatLabel(state, p.id)} 的身份是 ${ROLE_NAMES[p.role!]}`, false);
  beginNight(state, now);
}

// ---------------- 夜晚 ----------------

function beginNight(state: GameState, now: number) {
  state.speech = null;
  state.vote = null;
  state.sheriffSuggestion = null;
  state.speechDirection = null;
  state.dawnDeaths = [];
  const night: NightState = {
    step: 'wolf', stepStartedAt: now, wolfVotes: {}, killTargetId: null,
    witchDone: false, witchAction: null, seerTargetId: null, hunterAcked: false, fakeUntil: null,
  };
  state.night = night;
  setPhase(state, 'night', now);
  log(state, now, `第 ${state.day} 夜：天黑请闭眼`, true);
}

function requireNight(state: GameState, step: NightState['step']): NightState {
  if (state.phase !== 'night' || !state.night) fail('现在不是夜晚');
  if (state.night.step !== step) fail('当前不是你的行动时间');
  return state.night;
}

function wolfPick(state: GameState, actor: Player, targetId: string, lock: boolean, now: number, rng: Rng) {
  const night = requireNight(state, 'wolf');
  if (actor.role !== 'werewolf' || !actor.alive) fail('只有存活的狼人可以行动');
  const prev = night.wolfVotes[actor.id];
  if (prev?.locked) fail('你的选择已锁定');
  const target = mustPlayer(state, targetId);
  if (!target.alive) fail('不能选择已出局的玩家');
  night.wolfVotes[actor.id] = { targetId: target.id, locked: !!lock };
  if (lock) log(state, now, `狼人 ${seatLabel(state, actor.id)} 锁定击杀 ${seatLabel(state, target.id)}`, false);
  advanceNight(state, now, rng);
}

function seerCheck(state: GameState, actor: Player, targetId: string, now: number, rng: Rng) {
  const night = requireNight(state, 'seer');
  if (actor.role !== 'seer' || !actor.alive) fail('只有存活的预言家可以查验');
  if (night.seerTargetId) fail('今晚已查验，结果已锁定');
  const target = mustPlayer(state, targetId);
  if (!target.alive) fail('不能查验已出局的玩家');
  night.seerTargetId = target.id;
  const isWolf = target.role === 'werewolf';
  state.seerChecks.push({ night: state.day, targetId: target.id, isWolf });
  log(state, now, `预言家查验 ${seatLabel(state, target.id)}：${isWolf ? '狼人' : '好人'}`, false);
  advanceNight(state, now, rng);
}

/** 本晚女巫能否自救（9 人局：仅首晚可以） */
export function witchMaySelfSave(state: GameState): boolean {
  return getBoard(state).witchSelfSaveFirstNight && state.day === 1;
}

/** 女巫当晚是否可获知刀口：解药未使用时才可获知 */
export function witchKnowsKill(state: GameState): boolean {
  return state.witchPotions.antidote;
}

function witchAct(state: GameState, actor: Player, type: 'save' | 'poison' | 'none', targetId: string | null, now: number, rng: Rng) {
  const night = requireNight(state, 'witch');
  if (actor.role !== 'witch' || !actor.alive) fail('只有存活的女巫可以用药');
  if (night.witchDone) fail('今晚已行动，操作已锁定');
  if (type === 'save') {
    if (!state.witchPotions.antidote) fail('解药已用完');
    if (!night.killTargetId) fail('今晚没有可救的玩家');
    if (night.killTargetId === actor.id && !witchMaySelfSave(state)) {
      fail(getBoard(state).witchSelfSaveFirstNight ? '女巫只有首晚可以自救' : '女巫不能自救');
    }
    night.witchAction = { type: 'save', targetId: night.killTargetId };
    state.witchPotions.antidote = false;
    log(state, now, `女巫使用解药救了 ${seatLabel(state, night.killTargetId)}`, false);
  } else if (type === 'poison') {
    if (!state.witchPotions.poison) fail('毒药已用完');
    const target = mustPlayer(state, targetId);
    if (!target.alive) fail('不能毒杀已出局的玩家');
    night.witchAction = { type: 'poison', targetId: target.id };
    state.witchPotions.poison = false;
    log(state, now, `女巫使用毒药毒杀 ${seatLabel(state, target.id)}`, false);
  } else if (type === 'none') {
    night.witchAction = { type: 'none', targetId: null };
    log(state, now, '女巫今晚不使用药剂', false);
  } else {
    fail('无效的女巫操作');
  }
  night.witchDone = true;
  advanceNight(state, now, rng);
}

/** 猎人当晚是否具备开枪资格：被女巫毒杀则不具备 */
export function hunterCanShootTonight(state: GameState, hunterId: string): boolean {
  const a = state.night?.witchAction;
  return !(a?.type === 'poison' && a.targetId === hunterId);
}

function hunterAck(state: GameState, actor: Player, now: number, rng: Rng) {
  const night = requireNight(state, 'hunter');
  if (actor.role !== 'hunter' || !actor.alive) fail('只有存活的猎人可以确认');
  if (night.hunterAcked) fail('已确认');
  night.hunterAcked = true;
  log(state, now, `猎人确认开枪状态：${hunterCanShootTonight(state, actor.id) ? '可以开枪' : '不能开枪（被毒）'}`, false);
  advanceNight(state, now, rng);
}

const STEP_ROLE: Record<NightStep, Role> = { wolf: 'werewolf', witch: 'witch', seer: 'seer', hunter: 'hunter' };

function stepDone(state: GameState, night: NightState, now: number): boolean {
  switch (night.step) {
    case 'wolf': return state.players.filter((p) => p.alive && p.role === 'werewolf').every((w) => night.wolfVotes[w.id]?.locked);
    case 'witch': return aliveWithRole(state, 'witch') ? night.witchDone : now >= (night.fakeUntil ?? 0);
    case 'seer': return aliveWithRole(state, 'seer') ? !!night.seerTargetId : now >= (night.fakeUntil ?? 0);
    case 'hunter': return aliveWithRole(state, 'hunter') ? night.hunterAcked : now >= (night.fakeUntil ?? 0);
  }
}

/** 上一步全部完成后才进入下一步；全部完成后统一结算 */
function advanceNight(state: GameState, now: number, rng: Rng) {
  const night = state.night;
  if (state.phase !== 'night' || !night) return;
  while (stepDone(state, night, now)) {
    if (night.step === 'wolf') {
      const wolves = state.players.filter((p) => p.alive && p.role === 'werewolf');
      night.killTargetId = tallyWolves(state, night, wolves.map((w) => w.id), rng);
      log(state, now, `狼人最终刀口：${seatLabel(state, night.killTargetId)}`, false);
    }
    const next = NIGHT_STEPS[NIGHT_STEPS.indexOf(night.step) + 1];
    if (!next) return resolveNight(state, now);
    night.step = next;
    night.stepStartedAt = now;
    // 角色已出局或本局不存在：随机等待一段时间再继续
    night.fakeUntil = aliveWithRole(state, STEP_ROLE[next]) ? null : now + randRange(FAKE_STEP_MS[next], rng);
  }
}

/** 狼人票数最多者为刀口；平票随机 */
export function tallyWolves(state: GameState, night: NightState, wolfIds: string[], rng: Rng): string {
  const counts = new Map<string, number>();
  for (const id of wolfIds) {
    const t = night.wolfVotes[id]?.targetId;
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const max = Math.max(...counts.values());
  const top = bySeat(state, [...counts.entries()].filter(([, c]) => c === max).map(([id]) => id));
  return top[Math.floor(rng() * top.length)];
}

function resolveNight(state: GameState, now: number) {
  const night = state.night!;
  const deaths = new Map<string, DeathCause>();
  const kill = night.killTargetId;
  const saved = night.witchAction?.type === 'save' && night.witchAction.targetId === kill;
  if (kill && !saved) deaths.set(kill, 'wolf');
  // 毒药独立结算；同时被刀与被毒只死一次，按毒杀处理（猎人不能开枪）
  if (night.witchAction?.type === 'poison' && night.witchAction.targetId) deaths.set(night.witchAction.targetId, 'poison');

  const list = bySeat(state, [...deaths.keys()]).map((id) => ({ id, cause: deaths.get(id)! }));
  const effects = killPlayers(state, list, now);
  state.dawnDeaths = list.map((d) => d.id);
  state.night = null;
  setPhase(state, 'dawn', now);
  log(state, now, list.length === 0
    ? `第 ${state.day} 天：天亮了，昨晚是平安夜`
    : `第 ${state.day} 天：天亮了，昨晚出局的是 ${list.map((d) => seatLabel(state, d.id)).join('、')}`, true);
  if (checkWin(state, now)) return;
  state.effects = effects;
  state.continuation = 'after_dawn';
}

function dawnContinue(state: GameState, now: number, rng: Rng) {
  if (state.phase !== 'dawn') fail('当前阶段不可操作');
  runEffects(state, now, rng);
}

// ---------------- 死亡与连锁效果 ----------------

/** 标记死亡并返回需要处理的后续效果（猎人开枪 → 警徽移交） */
function killPlayers(state: GameState, list: { id: string; cause: DeathCause }[], now: number): Effect[] {
  const hunters: Effect[] = [];
  const badges: Effect[] = [];
  for (const { id, cause } of list) {
    const p = mustPlayer(state, id);
    if (!p.alive) continue;
    p.alive = false;
    p.deathCause = cause;
    p.deathDay = state.day;
    log(state, now, `${seatLabel(state, id)} 出局（${causeText(cause)}）`, false);
    if (p.role === 'hunter' && (cause === 'wolf' || cause === 'exile')) hunters.push({ type: 'hunter', playerId: id });
    if (state.sheriffId === id) badges.push({ type: 'badge', playerId: id });
  }
  return [...hunters, ...badges];
}

export function causeText(c: DeathCause) {
  return { wolf: '被狼人击杀', poison: '被女巫毒杀', exile: '被投票放逐', hunter: '被猎人带走' }[c];
}

function runEffects(state: GameState, now: number, rng: Rng) {
  while (state.effects.length > 0) {
    const e = state.effects[0];
    if (e.type === 'hunter') {
      setPhase(state, 'hunter', now);
      log(state, now, `${seatLabel(state, e.playerId)} 翻牌：猎人，正在决定是否开枪`, true);
      mustPlayer(state, e.playerId).revealed = true;
      return;
    }
    if (e.type === 'badge' && state.sheriffId === e.playerId) {
      setPhase(state, 'badge', now);
      return;
    }
    state.effects.shift();
  }
  const cont: Continuation | null = state.continuation;
  state.continuation = null;
  if (cont === 'after_dawn') {
    if (!state.electionDone && state.day === 1) startSheriffSignup(state, now);
    else startDaySpeech(state, now, rng);
  } else if (cont === 'after_exile') {
    state.day += 1;
    beginNight(state, now);
  }
}

function currentEffect(state: GameState, type: Effect['type'], actor: Player): Effect {
  const e = state.effects[0];
  if (!e || e.type !== type || state.phase !== (type === 'hunter' ? 'hunter' : 'badge')) fail('当前阶段不可操作');
  if (e.playerId !== actor.id) fail('不是你的技能阶段');
  return e;
}

function hunterShoot(state: GameState, actor: Player, targetId: string | null, now: number, rng: Rng) {
  currentEffect(state, 'hunter', actor);
  state.effects.shift();
  if (targetId == null) {
    log(state, now, `猎人 ${seatLabel(state, actor.id)} 选择不开枪`, true);
    runEffects(state, now, rng);
    return;
  }
  const target = mustPlayer(state, targetId);
  if (!target.alive || target.id === actor.id) {
    state.effects.unshift({ type: 'hunter', playerId: actor.id });
    fail('只能选择其他存活玩家');
  }
  log(state, now, `猎人 ${seatLabel(state, actor.id)} 开枪带走了 ${seatLabel(state, target.id)}`, true);
  const more = killPlayers(state, [{ id: target.id, cause: 'hunter' }], now);
  if (checkWin(state, now)) return;
  state.effects.unshift(...more);
  runEffects(state, now, rng);
}

function badgeAct(state: GameState, actor: Player, targetId: string | null, now: number, rng: Rng) {
  currentEffect(state, 'badge', actor);
  if (targetId == null) {
    state.sheriffId = null;
    log(state, now, `警长 ${seatLabel(state, actor.id)} 撕毁了警徽，本局不再有警长`, true);
  } else {
    const target = mustPlayer(state, targetId);
    if (!target.alive || target.id === actor.id) fail('警徽只能移交给存活玩家');
    state.sheriffId = target.id;
    log(state, now, `警长 ${seatLabel(state, actor.id)} 将警徽移交给 ${seatLabel(state, target.id)}`, true);
  }
  state.effects.shift();
  runEffects(state, now, rng);
}

// ---------------- 胜负判定（屠边） ----------------

export function evaluateWinner(state: GameState): { winner: Team; reason: string } | null {
  const alive = state.players.filter((p) => p.alive);
  const wolves = alive.filter((p) => p.role === 'werewolf').length;
  const gods = alive.filter((p) => p.role && GOD_ROLES.includes(p.role)).length;
  const villagers = alive.filter((p) => p.role === 'villager').length;
  // 统一顺序：先判断狼人是否全灭（同时达成时好人胜），再判断屠神、屠民
  if (wolves === 0) return { winner: 'good', reason: '狼人全部出局，好人阵营胜利' };
  if (gods === 0) return { winner: 'wolf', reason: '神职全部出局（屠神），狼人阵营胜利' };
  if (villagers === 0) return { winner: 'wolf', reason: '村民全部出局（屠民），狼人阵营胜利' };
  return null;
}

function checkWin(state: GameState, now: number): boolean {
  const r = evaluateWinner(state);
  if (!r) return false;
  state.status = 'ended';
  state.winner = r.winner;
  state.winReason = r.reason;
  state.night = null;
  state.vote = null;
  state.speech = null;
  state.election = null;
  state.effects = [];
  state.continuation = null;
  state.exiledPendingId = null;
  setPhase(state, 'ended', now);
  log(state, now, `游戏结束：${r.reason}`, true);
  return true;
}

// ---------------- 警长竞选 ----------------

function startSheriffSignup(state: GameState, now: number) {
  state.election = { signup: {}, candidates: [], withdrawn: [], round: 1 };
  setPhase(state, 'sheriff_signup', now);
  log(state, now, '警长竞选开始：请选择是否上警', true);
}

function sheriffSignup(state: GameState, actor: Player, join: boolean, now: number, rng: Rng) {
  if (state.phase !== 'sheriff_signup' || !state.election) fail('现在不是警长报名阶段');
  if (!actor.alive) fail('已出局玩家不能参与竞选');
  const el = state.election;
  if (actor.id in el.signup) fail('你已做出选择');
  el.signup[actor.id] = !!join;
  const alive = alivePlayers(state);
  if (!alive.every((p) => p.id in el.signup)) return;

  el.candidates = bySeat(state, Object.keys(el.signup).filter((id) => el.signup[id]));
  if (el.candidates.length === 0) return electSheriff(state, null, now, rng, '无人上警');
  if (el.candidates.length === 1) return electSheriff(state, el.candidates[0], now, rng, '仅一人上警，自动当选');
  log(state, now, `上警玩家：${el.candidates.map((id) => seatLabel(state, id)).join('、')}`, true);
  const start = Math.floor(rng() * el.candidates.length);
  const order = [...el.candidates.slice(start), ...el.candidates.slice(0, start)];
  startSpeech(state, 'sheriff', order, now, rng);
}

function sheriffWithdraw(state: GameState, actor: Player, now: number, rng: Rng) {
  const el = state.election;
  if (state.phase !== 'sheriff_speech' || !el || state.speech?.purpose !== 'sheriff') fail('现在不能退水');
  if (!el.candidates.includes(actor.id) || el.withdrawn.includes(actor.id)) fail('你不是警上候选人');
  el.withdrawn.push(actor.id);
  log(state, now, `${seatLabel(state, actor.id)} 退水`, true);
  const remaining = el.candidates.filter((id) => !el.withdrawn.includes(id));
  if (remaining.length === 0) return electSheriff(state, null, now, rng, '所有候选人退水');
  if (remaining.length === 1) return electSheriff(state, remaining[0], now, rng, '其余候选人均已退水');
  // 若当前发言者退水，自动轮到下一位
  if (state.speech && state.speech.order[state.speech.index] === actor.id) nextSpeaker(state, now, rng);
}

function electSheriff(state: GameState, id: string | null, now: number, rng: Rng, reason: string) {
  state.sheriffId = id;
  state.electionDone = true;
  state.election = null;
  state.vote = null;
  state.speech = null;
  log(state, now, id ? `${seatLabel(state, id)} 当选警长（${reason}）` : `本局无警长（${reason}）`, true);
  startDaySpeech(state, now, rng);
}

// ---------------- 发言 ----------------

function startSpeech(state: GameState, purpose: SpeechPurpose, order: string[], now: number, rng: Rng) {
  state.speech = { purpose, order, index: 0, startedAt: now, spoken: [] };
  const phase = purpose === 'day' ? 'day_speech' : purpose === 'exile_pk' ? 'exile_pk_speech' : 'sheriff_speech';
  setPhase(state, phase, now);
  skipIneligible(state, now, rng);
}

function speakerEligible(state: GameState, id: string): boolean {
  const p = mustPlayer(state, id);
  if (!p.alive) return false;
  if (state.speech?.purpose === 'sheriff' && state.election?.withdrawn.includes(id)) return false;
  return true;
}

function skipIneligible(state: GameState, now: number, rng: Rng) {
  const sp = state.speech!;
  while (sp.index < sp.order.length && !speakerEligible(state, sp.order[sp.index])) sp.index++;
  if (sp.index >= sp.order.length) endSpeech(state, now, rng);
}

function nextSpeaker(state: GameState, now: number, rng: Rng) {
  const sp = state.speech!;
  sp.index++;
  sp.startedAt = now;
  skipIneligible(state, now, rng);
}

function speechDone(state: GameState, actor: Player, skip: boolean, now: number, rng: Rng) {
  const sp = state.speech;
  if (!sp || !['sheriff_speech', 'day_speech', 'exile_pk_speech'].includes(state.phase)) fail('现在不是发言阶段');
  const current = mustPlayer(state, sp.order[sp.index]);
  if (skip) {
    if (isConnected(current, now)) fail('只能跳过已断线玩家的发言');
    log(state, now, `${seatLabel(state, current.id)} 断线，发言被跳过`, true);
  } else if (current.id !== actor.id) {
    fail('还没轮到你发言');
  }
  sp.spoken.push(current.id);
  nextSpeaker(state, now, rng);
}

function endSpeech(state: GameState, now: number, rng: Rng) {
  const sp = state.speech!;
  const el = state.election;
  if (sp.purpose === 'sheriff' && el) {
    const remaining = el.candidates.filter((id) => !el.withdrawn.includes(id));
    const voters = alivePlayers(state).filter((p) => !el.withdrawn.includes(p.id)).map((p) => p.id);
    startVote(state, 'sheriff', 1, voters, remaining, now);
  } else if (sp.purpose === 'sheriff_pk' && el) {
    const prev = state.vote!;
    const voters = prev.voters.filter((id) => !prev.targets.includes(id));
    if (voters.length === 0) return electSheriff(state, null, now, rng, '平票且无人可投票');
    startVote(state, 'sheriff', 2, voters, prev.targets, now);
  } else if (sp.purpose === 'day') {
    if (sheriffAlive(state)) {
      setPhase(state, 'sheriff_suggest', now);
    } else {
      startExileRound1(state, now);
    }
  } else if (sp.purpose === 'exile_pk') {
    const prev = state.vote!;
    const voters = prev.voters.filter((id) => !prev.targets.includes(id));
    if (voters.length === 0) {
      log(state, now, '平票玩家之外无人可投票，本轮无人出局', true);
      return finishExile(state, null, now, rng);
    }
    startVote(state, 'exile', 2, voters, prev.targets, now);
  }
}

function sheriffAlive(state: GameState): boolean {
  return !!state.sheriffId && !!getPlayer(state, state.sheriffId)?.alive;
}

function startDaySpeech(state: GameState, now: number, rng: Rng) {
  if (sheriffAlive(state)) {
    state.speech = null;
    setPhase(state, 'speech_order', now);
    return;
  }
  const alive = alivePlayers(state).map((p) => p.id);
  const start = Math.floor(rng() * alive.length);
  startSpeech(state, 'day', [...alive.slice(start), ...alive.slice(0, start)], now, rng);
}

/** 顺时针 = 座位号递增；从警长下一位开始，警长最后发言 */
export function speechOrderFrom(state: GameState, sheriffId: string, direction: 'cw' | 'ccw'): string[] {
  const alive = alivePlayers(state);
  const idx = alive.findIndex((p) => p.id === sheriffId);
  const n = alive.length;
  const order: string[] = [];
  for (let k = 1; k <= n; k++) {
    const i = direction === 'cw' ? (idx + k) % n : (idx - k + n * 2) % n;
    order.push(alive[i].id);
  }
  return order;
}

function speechOrder(state: GameState, actor: Player, direction: 'cw' | 'ccw', now: number) {
  if (state.phase !== 'speech_order') fail('现在不是选择发言顺序的阶段');
  if (actor.id !== state.sheriffId || !actor.alive) fail('只有警长可以决定发言顺序');
  if (direction !== 'cw' && direction !== 'ccw') fail('无效的方向');
  state.speechDirection = direction;
  log(state, now, `警长选择${direction === 'cw' ? '顺时针（座位号递增）' : '逆时针（座位号递减）'}发言，警长最后发言`, true);
  startSpeech(state, 'day', speechOrderFrom(state, actor.id, direction), now, () => 0);
}

// ---------------- 放逐投票 ----------------

function sheriffSuggest(state: GameState, actor: Player, targetId: string | null, now: number) {
  if (state.phase !== 'sheriff_suggest') fail('现在不是归票阶段');
  if (actor.id !== state.sheriffId || !actor.alive) fail('只有警长可以归票');
  if (targetId != null) {
    const t = mustPlayer(state, targetId);
    if (!t.alive) fail('只能归票给存活玩家');
    state.sheriffSuggestion = { targetId: t.id };
    log(state, now, `警长归票 ${seatLabel(state, t.id)}（警长本轮 1.5 票）`, true);
  } else {
    state.sheriffSuggestion = { targetId: null };
    log(state, now, '警长不归票（警长本轮 1 票）', true);
  }
  startExileRound1(state, now);
}

function exileVoters(state: GameState): string[] {
  return alivePlayers(state).filter((p) => p.canVote).map((p) => p.id);
}

function exileTargets(state: GameState): string[] {
  // 翻牌存活的白痴不能再被放逐
  return alivePlayers(state).filter((p) => !(p.role === 'idiot' && p.revealed)).map((p) => p.id);
}

function startExileRound1(state: GameState, now: number) {
  startVote(state, 'exile', 1, exileVoters(state), exileTargets(state), now);
}

function startVote(state: GameState, kind: VoteState['kind'], round: 1 | 2, voters: string[], targets: string[], now: number) {
  state.speech = null;
  state.vote = { kind, round, voters: bySeat(state, voters), targets: bySeat(state, targets), ballots: {}, startedAt: now };
  setPhase(state, kind === 'sheriff' ? 'sheriff_vote' : 'exile_vote', now);
}

export function voteWeight(state: GameState, voterId: string, kind: VoteState['kind']): number {
  if (kind === 'exile' && voterId === state.sheriffId && state.sheriffSuggestion?.targetId) return 1.5;
  return 1;
}

function castVote(state: GameState, actor: Player, targetId: string | null, now: number, rng: Rng) {
  const v = state.vote;
  if (!v || (state.phase !== 'sheriff_vote' && state.phase !== 'exile_vote')) fail('现在不是投票阶段');
  if (!actor.alive) fail('已出局玩家不能投票');
  if (!v.voters.includes(actor.id)) fail('你本轮没有投票权');
  if (actor.id in v.ballots) fail('你已投票，选票已锁定');
  if (targetId != null) {
    if (!v.targets.includes(targetId)) fail('不能投给该玩家');
    if (v.kind === 'sheriff' && targetId === actor.id) fail('候选人不能投票给自己');
  }
  v.ballots[actor.id] = targetId;
  if (v.voters.every((id) => id in v.ballots)) finalizeVote(state, now, rng);
}

export function tallyVote(state: GameState, v: VoteState): VoteResult {
  const ballots = v.voters.map((voterId) => ({
    voterId, targetId: v.ballots[voterId] ?? null, weight: voteWeight(state, voterId, v.kind),
  }));
  const totals = new Map<string, number>();
  for (const b of ballots) if (b.targetId) totals.set(b.targetId, (totals.get(b.targetId) ?? 0) + b.weight);
  const tally = bySeat(state, [...totals.keys()]).map((id) => ({ targetId: id, votes: totals.get(id)! }));
  if (tally.length === 0) {
    return { kind: v.kind, day: state.day, round: v.round, ballots, tally, outcome: 'none', topIds: [] };
  }
  const max = Math.max(...tally.map((t) => t.votes));
  const topIds = tally.filter((t) => t.votes === max).map((t) => t.targetId);
  return { kind: v.kind, day: state.day, round: v.round, ballots, tally, outcome: topIds.length === 1 ? 'single' : 'tie', topIds };
}

function describeTally(state: GameState, r: VoteResult): string {
  if (r.tally.length === 0) return '全部弃票';
  return r.tally.map((t) => `${seatLabel(state, t.targetId)} ${t.votes} 票`).join('，');
}

function finalizeVote(state: GameState, now: number, rng: Rng) {
  const v = state.vote!;
  const r = tallyVote(state, v);
  state.voteResults.push(r);
  const title = v.kind === 'sheriff' ? '警长投票' : '放逐投票';
  log(state, now, `${title}${v.round === 2 ? '（平票重投）' : ''}结果：${describeTally(state, r)}`, true);

  if (v.kind === 'sheriff') {
    const el = state.election!;
    if (r.outcome === 'single') return electSheriff(state, r.topIds[0], now, rng, '得票最多');
    if (v.round === 2) return electSheriff(state, null, now, rng, '再次平票');
    const tied = r.outcome === 'tie' ? r.topIds : el.candidates.filter((id) => !el.withdrawn.includes(id));
    el.round = 2;
    v.targets = bySeat(state, tied);
    log(state, now, `警长竞选平票：${tied.map((id) => seatLabel(state, id)).join('、')} 进入 PK 发言`, true);
    startSpeech(state, 'sheriff_pk', v.targets, now, rng);
    // startSpeech 会清空 vote，这里保留上一轮信息用于确定 PK 投票人
    state.vote = v;
    return;
  }

  if (r.outcome === 'single') return exilePlayer(state, r.topIds[0], now, rng);
  if (r.outcome === 'none') {
    log(state, now, '无人获得有效票，本轮无人出局', true);
    return finishExile(state, null, now, rng);
  }
  if (v.round === 2) {
    log(state, now, '再次平票，本轮无人出局', true);
    return finishExile(state, null, now, rng);
  }
  v.targets = bySeat(state, r.topIds);
  log(state, now, `放逐投票平票：${v.targets.map((id) => seatLabel(state, id)).join('、')} 进入 PK 发言`, true);
  startSpeech(state, 'exile_pk', v.targets, now, rng);
  state.vote = v;
}

function exilePlayer(state: GameState, id: string, now: number, rng: Rng) {
  const p = mustPlayer(state, id);
  state.vote = null;
  log(state, now, `${seatLabel(state, id)} 被投票放逐`, true);
  // 白痴被放逐时系统自动翻牌公布身份
  if (p.role === 'idiot' && !p.revealed) {
    p.revealed = true;
    log(state, now, `${seatLabel(state, id)} 自动翻牌：白痴`, true);
    if (state.settings.idiotFlipSurvives) {
      p.canVote = false;
      log(state, now, '白痴翻牌免于出局，但失去投票权', true);
      if (state.sheriffId === p.id) {
        state.sheriffId = null;
        log(state, now, '白痴翻牌后警徽流失，本局不再有警长', true);
      }
      return finishExile(state, null, now, rng);
    }
  }
  // 被放逐者发表遗言后自行确认出局
  state.exiledPendingId = p.id;
  setPhase(state, 'exile_confirm', now);
}

function exileConfirm(state: GameState, actor: Player, now: number, rng: Rng) {
  if (state.phase !== 'exile_confirm' || state.exiledPendingId !== actor.id) fail('当前不能操作');
  state.exiledPendingId = null;
  log(state, now, `${seatLabel(state, actor.id)} 发表遗言后出局`, true);
  finishExile(state, actor.id, now, rng);
}

/** 放逐结算：死亡 → 胜负 → 猎人/警徽 → 进入夜晚 */
function finishExile(state: GameState, id: string | null, now: number, rng: Rng) {
  state.vote = null;
  state.speech = null;
  let effects: Effect[] = [];
  if (id) {
    effects = killPlayers(state, [{ id, cause: 'exile' }], now);
    if (checkWin(state, now)) return;
  }
  state.effects = effects;
  state.continuation = 'after_exile';
  runEffects(state, now, rng);
}
