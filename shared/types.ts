// 共享类型定义：服务端完整状态（GameState）与客户端可见视图（PlayerView）

export type Role = 'werewolf' | 'seer' | 'witch' | 'hunter' | 'idiot' | 'villager';
export type Team = 'wolf' | 'good';
export type DeathCause = 'wolf' | 'poison' | 'exile' | 'hunter';

export const ROLE_NAMES: Record<Role, string> = {
  werewolf: '狼人',
  seer: '预言家',
  witch: '女巫',
  hunter: '猎人',
  idiot: '白痴',
  villager: '村民',
};

export const GOD_ROLES: Role[] = ['seer', 'witch', 'hunter', 'idiot'];

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

export type BoardId = 'std12' | 'pnl9';

export interface Board {
  id: BoardId;
  name: string;
  size: number;
  roles: Role[];
  /** 一句话配置说明 */
  summary: string;
  /** 女巫首晚可以自救 */
  witchSelfSaveFirstNight: boolean;
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
};

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

/** 夜间行动严格按顺序进行：狼人 → 女巫 → 预言家 → 猎人状态确认 */
export type NightStep = 'wolf' | 'witch' | 'seer' | 'hunter';
export const NIGHT_STEPS: NightStep[] = ['wolf', 'witch', 'seer', 'hunter'];

export interface NightState {
  step: NightStep;
  stepStartedAt: number;
  wolfVotes: Record<string, WolfVote>;
  killTargetId: string | null;
  witchDone: boolean;
  witchAction: { type: 'save' | 'poison' | 'none'; targetId: string | null } | null;
  seerTargetId: string | null;
  hunterAcked: boolean;
  /** 该步骤角色已出局（或本局没有该角色）时，用随机等待时间掩盖，避免通过夜晚节奏推断身份 */
  fakeUntil: number | null;
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
  | { type: 'hunter'; playerId: string }
  | { type: 'badge'; playerId: string };

export type Continuation = 'after_dawn' | 'after_exile';

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
  night: NightState | null;
  seerChecks: SeerCheck[];
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
  /** 狼人夜间：队友当前的选择 */
  wolfVotes: Record<string, WolfVote> | null;
  seerChecks: SeerCheck[];
  seerCanAct: boolean;
  wolfCanAct: boolean;
  /** 夜间猎人状态确认步骤：系统告知当晚是否具备开枪资格 */
  hunterNight: { canAck: boolean; canShoot: boolean } | null;
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
  } | null;
}
