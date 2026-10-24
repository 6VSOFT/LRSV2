import { Action, addPlayer, applyAction, createGame, Rng, tick, witchMaySelfSave } from '../shared/engine';
import { BoardId, BOARDS, GameState, Role } from '../shared/types';

/** 默认座位身份：1-4 狼，5 预言家，6 女巫，7 猎人，8 白痴，9-12 村民 */
export const SEAT_ROLES: Role[] = [
  'werewolf', 'werewolf', 'werewolf', 'werewolf',
  'seer', 'witch', 'hunter', 'idiot',
  'villager', 'villager', 'villager', 'villager',
];

/** 9 人局默认座位身份：1-3 狼，4 预言家，5 女巫，6 猎人，7-9 村民 */
export const SEAT_ROLES_9: Role[] = [
  'werewolf', 'werewolf', 'werewolf',
  'seer', 'witch', 'hunter',
  'villager', 'villager', 'villager',
];

export const T0 = 1_000_000;

export class Game {
  state: GameState;
  now = T0;
  rng: Rng = () => 0;

  constructor(opts: { idiotFlipSurvives?: boolean; board?: BoardId } = {}) {
    const board = opts.board ?? 'std12';
    const size = BOARDS[board].size;
    this.state = createGame('TEST', { id: 'p1', nickname: '玩家1', tokenHash: 'h1' }, this.now, board);
    for (let i = 2; i <= size; i++) addPlayer(this.state, { id: `p${i}`, nickname: `玩家${i}`, tokenHash: `h${i}` }, this.now);
    if (opts.idiotFlipSurvives) this.act(1, { type: 'settings', settings: { idiotFlipSurvives: true } });
    for (let i = 1; i <= size; i++) this.act(i, { type: 'ready', ready: true });
    this.act(1, { type: 'start' });
    // 固定身份，便于测试
    const roles = board === 'pnl9' ? SEAT_ROLES_9 : SEAT_ROLES;
    this.state.players.forEach((p, i) => (p.role = roles[i]));
  }

  id(seat: number) {
    return `p${seat}`;
  }

  p(seat: number) {
    return this.state.players.find((x) => x.seat === seat)!;
  }

  act(seat: number, action: Action) {
    this.now += 1000;
    applyAction(this.state, `p${seat}`, action, this.now, this.rng);
  }

  alive() {
    return this.state.players.filter((p) => p.alive).map((p) => p.seat);
  }

  /** 完成一整晚（狼人 → 女巫 → 预言家 → 猎人）：狼人统一刀 kill；女巫行动；预言家查验 check */
  night(kill: number, check: number, witch: { action: 'save' | 'poison' | 'none'; target?: number } = { action: 'none' }) {
    this.wolvesKill(kill);
    this.witchStep(witch);
    this.seerStep(check);
    this.hunterStep();
  }

  roleSeat(role: Role) {
    return this.state.players.find((p) => p.role === role);
  }

  wolvesKill(kill: number) {
    for (const w of this.state.players.filter((p) => p.alive && p.role === 'werewolf')) {
      this.act(w.seat, { type: 'wolf_pick', targetId: this.id(kill), lock: true });
    }
  }

  witchStep(witch: { action: 'save' | 'poison' | 'none'; target?: number } = { action: 'none' }) {
    const w = this.roleSeat('witch');
    if (w?.alive) this.act(w.seat, { type: 'witch', action: witch.action, targetId: witch.target ? this.id(witch.target) : null });
    else this.wait(30_000);
  }

  seerStep(check: number) {
    const s = this.roleSeat('seer');
    if (s?.alive) this.act(s.seat, { type: 'seer_check', targetId: this.id(check) });
    else this.wait(30_000);
  }

  hunterStep() {
    if (this.state.phase !== 'night') return;
    const h = this.roleSeat('hunter');
    if (h?.alive) this.act(h.seat, { type: 'hunter_ack' });
    else this.wait(30_000);
  }

  wait(ms: number) {
    this.now += ms;
    tick(this.state, this.now, this.rng);
  }

  /** 让当前发言阶段所有人依次发言完毕 */
  finishSpeeches() {
    let guard = 0;
    while (this.state.speech && ['day_speech', 'sheriff_speech', 'exile_pk_speech'].includes(this.state.phase)) {
      const sp = this.state.speech;
      const cur = this.state.players.find((p) => p.id === sp.order[sp.index])!;
      this.act(cur.seat, { type: 'speech_done' });
      if (++guard > 50) throw new Error('speech loop');
    }
  }

  /** 所有有投票权的人按 map 投票（seat -> target seat 或 null），未列出者投给 fallback */
  voteAll(map: Record<number, number | null>, fallback: number | null = null) {
    const v = this.state.vote!;
    for (const voterId of v.voters.slice()) {
      const seat = this.state.players.find((p) => p.id === voterId)!.seat;
      const t = seat in map ? map[seat] : fallback;
      this.act(seat, { type: 'vote', targetId: t == null ? null : this.id(t) });
    }
  }

  /** 被放逐者遗言后确认出局 */
  confirmExile() {
    const id = this.state.exiledPendingId!;
    this.act(this.state.players.find((p) => p.id === id)!.seat, { type: 'exile_confirm' });
  }

  /** 首夜之后：所有人不上警，走到「公布首夜信息」（之后的夜晚天亮后直接就是 dawn） */
  dawn() {
    if (this.state.phase === 'sheriff_signup') this.skipElection();
    return this;
  }

  /** 首日：所有人不上警 */
  skipElection() {
    for (const p of this.state.players.filter((x) => x.alive)) this.act(p.seat, { type: 'sheriff_signup', join: false });
  }
}

export function shuffleRoles(roles: Role[], rng: () => number) {
  const a = roles.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** 每一步由合法玩家随机做出合法操作，直到游戏结束 */
export function playRandom(g: Game, rng: () => number) {
  for (let step = 0; step < 2000 && g.state.status === 'playing'; step++) {
    const s = g.state;
    const alive = s.players.filter((p) => p.alive);
    const aliveIds = alive.map((p) => p.id);
    const seatOf = (id: string) => s.players.find((p) => p.id === id)!.seat;
    switch (s.phase) {
      case 'night': {
        const n = s.night!;
        if (n.step === 'wolf') {
          const wolf = alive.find((p) => p.role === 'werewolf' && !n.wolfVotes[p.id]?.locked)!;
          g.act(wolf.seat, { type: 'wolf_pick', targetId: pick(aliveIds, rng), lock: true });
        } else if (n.step === 'witch') {
          const witch = alive.find((p) => p.role === 'witch');
          if (!witch) { g.wait(30_000); break; }
          const r = rng();
          const canSave = s.witchPotions.antidote && n.killTargetId && (n.killTargetId !== witch.id || witchMaySelfSave(s));
          if (r < 0.3 && canSave) g.act(witch.seat, { type: 'witch', action: 'save' });
          else if (r < 0.5 && s.witchPotions.poison) g.act(witch.seat, { type: 'witch', action: 'poison', targetId: pick(aliveIds, rng) });
          else g.act(witch.seat, { type: 'witch', action: 'none' });
        } else if (n.step === 'seer') {
          const seer = alive.find((p) => p.role === 'seer');
          if (seer) g.act(seer.seat, { type: 'seer_check', targetId: pick(aliveIds, rng) });
          else g.wait(30_000);
        } else {
          const hunter = alive.find((p) => p.role === 'hunter');
          if (hunter) g.act(hunter.seat, { type: 'hunter_ack' });
          else g.wait(30_000);
        }
        break;
      }
      case 'dawn': g.act(1, { type: 'continue' }); break;
      case 'hunter': {
        const e = s.effects[0];
        const targets = aliveIds.filter((id) => id !== e.playerId);
        g.act(seatOf(e.playerId), { type: 'hunter_shoot', targetId: rng() < 0.8 ? pick(targets, rng) : null });
        break;
      }
      case 'badge': {
        const e = s.effects[0];
        const targets = aliveIds.filter((id) => id !== e.playerId);
        g.act(seatOf(e.playerId), { type: 'badge', targetId: rng() < 0.7 ? pick(targets, rng) : null });
        break;
      }
      case 'exile_confirm': g.act(seatOf(s.exiledPendingId!), { type: 'exile_confirm' }); break;
      case 'sheriff_signup': {
        const p = alive.find((x) => !(x.id in s.election!.signup))!;
        g.act(p.seat, { type: 'sheriff_signup', join: rng() < 0.3 });
        break;
      }
      case 'sheriff_speech': case 'day_speech': case 'exile_pk_speech': {
        const cur = s.speech!.order[s.speech!.index];
        const el = s.election;
        if (s.speech!.purpose === 'sheriff' && el && rng() < 0.1) {
          const c = el.candidates.find((id) => !el.withdrawn.includes(id));
          if (c) { g.act(seatOf(c), { type: 'sheriff_withdraw' }); break; }
        }
        g.act(seatOf(cur), { type: 'speech_done' });
        break;
      }
      case 'speech_order': g.act(seatOf(s.sheriffId!), { type: 'speech_order', direction: rng() < 0.5 ? 'cw' : 'ccw' }); break;
      case 'sheriff_suggest': g.act(seatOf(s.sheriffId!), { type: 'sheriff_suggest', targetId: rng() < 0.7 ? pick(aliveIds, rng) : null }); break;
      case 'sheriff_vote': case 'exile_vote': {
        const v = s.vote!;
        const voter = v.voters.find((id) => !(id in v.ballots))!;
        const targets = v.targets.filter((id) => !(v.kind === 'sheriff' && id === voter));
        g.act(seatOf(voter), { type: 'vote', targetId: rng() < 0.9 && targets.length ? pick(targets, rng) : null });
        break;
      }
      default: throw new Error('unexpected phase ' + s.phase);
    }
  }
}
