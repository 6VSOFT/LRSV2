// 共享类型定义：服务端完整状态（GameState）与客户端可见视图（PlayerView）

export type Role = 'werewolf' | 'wolf_king' | 'wolf_beauty' | 'seer' | 'witch' | 'hunter' | 'idiot' | 'guard' | 'knight' | 'villager';
export type Team = 'wolf' | 'good';
/** charm：狼美人出局后殉情；duel：骑士决斗（被决斗的狼人，或决斗失败的骑士） */
export type DeathCause = 'wolf' | 'poison' | 'exile' | 'hunter' | 'wolf_king' | 'charm' | 'duel';

export const ROLE_NAMES: Record<Role, string> = {
  werewolf: '狼人',
  wolf_king: '狼王',
  wolf_beauty: '狼美人',
  seer: '预言家',
  witch: '女巫',
  hunter: '猎人',
  idiot: '白痴',
  guard: '守卫',
  knight: '骑士',
  villager: '村民',
};

export const GOD_ROLES: Role[] = ['seer', 'witch', 'hunter', 'idiot', 'guard', 'knight'];

/** 狼人阵营角色（狼王、狼美人也参与夜间刀人） */
export function isWolfRole(role: Role | null | undefined): boolean {
  return role === 'werewolf' || role === 'wolf_king' || role === 'wolf_beauty';
}

/** 出局时可以开枪带人的角色 */
export function isShooterRole(role: Role | null | undefined): boolean {
  return role === 'hunter' || role === 'wolf_king';
}

/** 预女猎白 12 人标准局 */
export const STANDARD_12: Role[] = [
  'werewolf', 'werewolf', 'werewolf', 'werewolf',
  'seer', 'witch', 'hunter', 'idiot',
  'villager', 'villager', 'villager', 'villager',
];

/** 预女猎 9 人局 */
export const STANDARD_9: Role[] = [
  'werewolf', 'werewolf', 'werewolf',
  'seer', 'witch', 'hunter',
  'villager', 'villager', 'villager',
];

/** 狼王守卫 12 人局 */
export const WOLF_KING_GUARD_12: Role[] = [
  'wolf_king', 'werewolf', 'werewolf', 'werewolf',
  'seer', 'witch', 'hunter', 'guard',
  'villager', 'villager', 'villager', 'villager',
];

/** 狼美人骑士 12 人局 */
export const WOLF_BEAUTY_KNIGHT_12: Role[] = [
  'wolf_beauty', 'werewolf', 'werewolf', 'werewolf',
  'seer', 'witch', 'knight', 'guard',
  'villager', 'villager', 'villager', 'villager',
];

export type BoardId = 'std12' | 'pnl9' | 'wkg12' | 'wbk12';

export interface Board {
  id: BoardId;
  name: string;
  size: number;
  roles: Role[];
  /** 一句话配置说明 */
  summary: string;
  /** 女巫首晚可以自救 */
  witchSelfSaveFirstNight: boolean;
  /** 首页与等待室展示的特殊规则 */
  notes?: string[];
}

export const BOARDS: Record<BoardId, Board> = {
  std12: {
    id: 'std12', name: '12 人预女猎白', size: 12, roles: STANDARD_12,
    summary: '4 狼人 · 预言家 · 女巫 · 猎人 · 白痴 · 4 村民',
    witchSelfSaveFirstNight: false,
  },
  pnl9: {
    id: 'pnl9', name: '9 人预女猎', size: 9, roles: STANDARD_9,
    summary: '3 狼人 · 预言家 · 女巫 · 猎人 · 3 村民',
    witchSelfSaveFirstNight: true,
  },
  wkg12: {
    id: 'wkg12', name: '12 人狼王守卫', size: 12, roles: WOLF_KING_GUARD_12,
    summary: '狼王 · 3 狼人 · 预言家 · 女巫 · 猎人 · 守卫 · 4 村民',
    witchSelfSaveFirstNight: false,
    notes: ['守卫不可连续两晚守同一人，同守同救必死', '狼王被毒杀不能开枪'],
  },
  wbk12: {
    id: 'wbk12', name: '12 人狼美人骑士', size: 12, roles: WOLF_BEAUTY_KNIGHT_12,
    summary: '狼美人 · 3 狼人 · 预言家 · 女巫 · 骑士 · 守卫 · 4 村民',
    witchSelfSaveFirstNight: false,
    notes: ['狼美人出局时被魅惑者殉情', '骑士白天可决斗一次', '同守同救必死'],
  },
};

/** 首页展示顺序 */
export const BOARD_ORDER: BoardId[] = ['std12', 'pnl9', 'wkg12', 'wbk12'];

export const DEFAULT_BOARD: BoardId = 'std12';

/** 所有板子中的最大人数 */
export const MAX_PLAYERS = 12;

export type Phase =
  | 'lobby'
  | 'night'
  | 'dawn'
  | 'hunter'
  | 'badge'
  | 'exile_confirm'
  | 'sheriff_signup'
  | 'sheriff_speech'
  | 'sheriff_vote'
  | 'speech_order'
  | 'day_speech'
  | 'sheriff_suggest'
  | 'exile_vote'
  | 'exile_pk_speech'
  | 'ended';

export interface Settings {
  /** false（默认，按本项目规则）：白痴被放逐翻牌后仍出局；true：经典规则，翻牌免死但失去投票权 */
  idiotFlipSurvives: boolean;
  /** 发言倒计时（秒），仅作提示 */
  speechSeconds: number;
}

export interface Player {
  id: string;
  seat: number;
  nickname: string;
  tokenHash: string;
  ready: boolean;
  role: Role | null;
  alive: boolean;
  deathCause: DeathCause | null;
  deathDay: number | null;
  /** 身份已公开（白痴翻牌、猎人开枪） */
  revealed: boolean;
  /** 白痴翻牌存活后失去投票权 */
  canVote: boolean;
  lastSeen: number;
}

export interface WolfVote {
  targetId: string;
  locked: boolean;
}

/** 夜间行动严格按顺序进行：守卫 → 狼人 → 狼美人魅惑 → 女巫 → 预言家 → 猎人状态确认；板子里没有的角色整步跳过 */
export type NightStep = 'guard' | 'wolf' | 'charm' | 'witch' | 'seer' | 'hunter';
export const NIGHT_STEPS: NightStep[] = ['guard', 'wolf', 'charm', 'witch', 'seer', 'hunter'];

export interface NightState {
  step: NightStep;
  stepStartedAt: number;
  wolfVotes: Record<string, WolfVote>;
  killTargetId: string | null;
  witchDone: boolean;
  witchAction: { type: 'save' | 'poison' | 'none'; targetId: string | null } | null;
  seerTargetId: string | null;
  hunterAcked: boolean;
  /** 守卫今晚守护的玩家；null 表示空守。旧数据没有这些字段 */
  guardTargetId?: string | null;
  guardDone?: boolean;
  /** 狼美人今晚魅惑的玩家；null 表示不魅惑 */
  charmTargetId?: string | null;
  charmDone?: boolean;
  /** 该步骤角色已出局（或本局没有该角色）时，用随机等待时间掩盖，避免通过夜晚节奏推断身份 */
  fakeUntil: number | null;
}

/** 每晚结算时保存的夜间记录，仅在游戏结束后公开 */
export interface NightRecord {
  night: number;
  /** 每只存活狼人锁定的目标 */
  wolfVotes: { wolfId: string; targetId: string }[];
  /** 最终刀口（平票时为随机选出的那个） */
  killTargetId: string | null;
  /** 女巫当晚的操作；null 表示女巫已出局（或本局无女巫） */
  witch: { type: 'save' | 'poison' | 'none'; targetId: string | null } | null;
  /** 猎人当晚是否具备开枪资格；null 表示猎人已出局（或本局无猎人） */
  hunter: { hunterId: string; canShoot: boolean } | null;
  /** 守卫当晚守护的玩家；null 表示守卫已出局；undefined 表示本局无守卫 */
  guard?: { guardId: string; targetId: string | null } | null;
  /** 狼美人当晚魅惑的玩家；null 表示狼美人已出局；undefined 表示本局无狼美人 */
  charm?: { beautyId: string; targetId: string | null } | null;
}

export interface SeerCheck {
  night: number;
  targetId: string;
  isWolf: boolean;
}

export type SpeechPurpose = 'sheriff' | 'sheriff_pk' | 'day' | 'exile_pk';

export interface SpeechState {
  purpose: SpeechPurpose;
  order: string[];
  index: number;
  startedAt: number;
  spoken: string[];
}

export interface ElectionState {
  /** playerId -> 是否上警（未决定者不在表中） */
  signup: Record<string, boolean>;
  candidates: string[];
  withdrawn: string[];
  round: 1 | 2;
}

export interface VoteState {
  kind: 'sheriff' | 'exile';
  round: 1 | 2;
  voters: string[];
  targets: string[];
  /** voterId -> targetId；null 表示弃票 */
  ballots: Record<string, string | null>;
  startedAt: number;
}

export interface VoteResult {
  kind: 'sheriff' | 'exile';
  day: number;
  round: 1 | 2;
  ballots: { voterId: string; targetId: string | null; weight: number }[];
  tally: { targetId: string; votes: number }[];
  /** 'single' 唯一最高；'tie' 平票；'none' 无有效票 */
  outcome: 'single' | 'tie' | 'none';
  topIds: string[];
}

export type Effect =
  /** 猎人或狼王出局后开枪 */
  | { type: 'hunter'; playerId: string }
  | { type: 'badge'; playerId: string };

/** resume_speech：骑士决斗失败后（处理完警徽）继续白天发言 */
export type Continuation = 'after_dawn' | 'after_exile' | 'resume_speech';

export interface LogEntry {
  at: number;
  day: number;
  text: string;
  /** 公开日志任何时候可见；私密日志仅在游戏结束后公开 */
  public: boolean;
}

export interface GameState {
  code: string;
  /** 旧房间数据没有此字段时按 12 人局处理 */
  board?: BoardId;
  createdAt: number;
  creatorId: string;
  settings: Settings;
  status: 'lobby' | 'playing' | 'ended';
  phase: Phase;
  phaseStartedAt: number;
  /** 第 N 夜之后是第 N 天 */
  day: number;
  players: Player[];
  sheriffId: string | null;
  electionDone: boolean;
  sheriffSuggestion: { targetId: string | null } | null;
  witchPotions: { antidote: boolean; poison: boolean };
  /** 守卫上一晚守护的玩家（不能连续两晚守护同一人） */
  lastGuardTargetId?: string | null;
  /** 当前生效的魅惑对象（最近一晚魅惑的玩家），狼美人出局时殉情 */
  charmTargetId?: string | null;
  /** 骑士决斗已使用（整局一次） */
  knightDuelUsed?: boolean;
  night: NightState | null;
  seerChecks: SeerCheck[];
  /** 旧房间数据可能没有此字段 */
  nightRecords?: NightRecord[];
  dawnDeaths: string[];
  /** 首夜死讯：警长竞选结束前暂不公布、暂不结算 */
  pendingNightDeaths?: { id: string; cause: DeathCause }[] | null;
  election: ElectionState | null;
  speech: SpeechState | null;
  speechDirection: 'cw' | 'ccw' | null;
  vote: VoteState | null;
  voteResults: VoteResult[];
  /** 被放逐、正在确认出局（白痴可在此翻牌）的玩家 */
  exiledPendingId: string | null;
  effects: Effect[];
  continuation: Continuation | null;
  winner: Team | null;
  winReason: string | null;
  log: LogEntry[];
}

// ---------------- 客户端视图 ----------------

export interface PublicPlayer {
  id: string;
  seat: number;
  nickname: string;
  ready: boolean;
  alive: boolean;
  connected: boolean;
  isCreator: boolean;
  isSheriff: boolean;
  idiotRevealed: boolean;
  canVote: boolean;
  deathDay: number | null;
  /** 仅在游戏结束后或身份已公开（白痴翻牌、猎人开枪）时提供 */
  role: Role | null;
  /** 仅在游戏结束后提供 */
  deathCause: DeathCause | null;
}

export interface PrivateInfo {
  playerId: string;
  role: Role | null;
  teammates: string[];
  /** 狼人阵营：狼队友中的特殊狼（狼王、狼美人）及其身份 */
  teammateRoles: Record<string, Role>;
  /** 狼人夜间：队友当前的选择 */
  wolfVotes: Record<string, WolfVote> | null;
  seerChecks: SeerCheck[];
  seerCanAct: boolean;
  wolfCanAct: boolean;
  /** 夜间猎人状态确认步骤：系统告知当晚是否具备开枪资格 */
  hunterNight: { canAck: boolean; canShoot: boolean } | null;
  /** 守卫夜间行动 */
  guard: { canAct: boolean; lastTargetId: string | null; targetId: string | null | undefined } | null;
  /** 狼美人夜间魅惑；current 为当前生效的魅惑对象 */
  charm: { canAct: boolean; lastTargetId: string | null; targetId: string | null | undefined; current: string | null } | null;
  /** 骑士：白天发言阶段可发起决斗（整局一次） */
  knight: { canDuel: boolean; used: boolean } | null;
  witch: {
    antidote: boolean;
    poison: boolean;
    canAct: boolean;
    /** 仅在仍有资格获知时提供，否则为 undefined */
    knownKillTargetId?: string | null;
    canSave: boolean;
    done: boolean;
  } | null;
  myBallot: string | null | undefined;
  canVote: boolean;
  hunterCanShoot: boolean;
  hunterDeathCause: DeathCause | null;
}

export interface PlayerView {
  code: string;
  board: Board;
  serverNow: number;
  status: GameState['status'];
  phase: Phase;
  phaseStartedAt: number;
  day: number;
  settings: Settings;
  players: PublicPlayer[];
  sheriffId: string | null;
  sheriffSuggestion: { targetId: string | null } | null;
  dawnDeaths: string[] | null;
  election: {
    decided: string[];
    candidates: string[];
    withdrawn: string[];
    round: 1 | 2;
    mySignup: boolean | undefined;
  } | null;
  speech: SpeechState | null;
  speechDirection: 'cw' | 'ccw' | null;
  vote: { kind: VoteState['kind']; round: 1 | 2; voters: string[]; targets: string[]; voted: string[] } | null;
  voteResults: VoteResult[];
  currentEffect: Effect | null;
  exiledPendingId: string | null;
  winner: Team | null;
  winReason: string | null;
  log: LogEntry[];
  me: PrivateInfo | null;
  /** 游戏结束后公开 */
  fullReveal: {
    seerChecks: SeerCheck[];
    nightRecords: NightRecord[];
  } | null;
}
