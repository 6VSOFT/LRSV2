import type { Action } from '../shared/engine';
import type { BoardId, PlayerView, Role } from '../shared/types';

export interface Session {
  code: string;
  token: string;
  playerId: string;
}

/** ?p=xxx 可在同一浏览器中模拟多台设备（本地测试用） */
function profile() {
  return new URLSearchParams(location.search).get('p') ?? '';
}

const key = (code: string) => `ww:${code.toUpperCase()}:${profile()}`;

export function loadSession(code: string): Session | null {
  try {
    const raw = localStorage.getItem(key(code));
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session) {
  try {
    localStorage.setItem(key(s.code), JSON.stringify(s));
  } catch {
    /* 隐私模式下不可用时忽略 */
  }
}

export function clearSession(code: string) {
  try {
    localStorage.removeItem(key(code));
  } catch {
    /* ignore */
  }
}

export function rememberNickname(n?: string): string {
  try {
    if (n !== undefined) localStorage.setItem('ww:nick', n);
    return localStorage.getItem('ww:nick') ?? '';
  } catch {
    return n ?? '';
  }
}

export class ApiError extends Error {}

async function post<T>(route: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('网络连接失败，请检查网络');
  }
  const data = await res.json().catch(() => ({ error: '服务器响应异常' }));
  if (!res.ok) throw new ApiError(data.error ?? '请求失败');
  return data as T;
}

export const api = {
  create: (nickname: string, board: BoardId) => post<Session>('create', { nickname, board }),
  join: (code: string, nickname: string, token?: string) => post<Session>('join', { code, nickname, token }),
  state: (code: string, token?: string) => post<PlayerView>('state', { code, token }),
  action: (s: Session, action: Action) => post<PlayerView>('action', { code: s.code, token: s.token, action }),
};

export const ROLE_INFO: Record<Role, { name: string; team: string; desc: string; color: string }> = {
  werewolf: { name: '狼人', team: '狼人阵营', color: '#e5484d', desc: '每晚与狼队友共同选择击杀一名玩家（可自刀）。屠神或屠民即获胜。' },
  wolf_beauty: { name: '狼美人', team: '狼人阵营 · 狼美人', color: '#ff5fa2', desc: '夜间与狼队友一起刀人（狼人不能刀狼美人），狼人行动后单独魅惑一名玩家，不能连续两晚魅惑同一人。狼美人出局时被魅惑者立即殉情（无遗言）；被骑士决斗出局时魅惑不生效。' },
  wolf_king: { name: '狼王', team: '狼人阵营 · 狼王', color: '#ff6b5e', desc: '夜间与狼队友一起刀人。被放逐、被狼刀（自刀）或被猎人带走时可开枪带走一名玩家；被女巫毒杀不能开枪。' },
  seer: { name: '预言家', team: '好人阵营 · 神职', color: '#8e7cff', desc: '每晚查验一名玩家，得知其是好人还是狼人。' },
  witch: { name: '女巫', team: '好人阵营 · 神职', color: '#3dd68c', desc: '一瓶解药、一瓶毒药，每晚最多用一瓶。9 人局仅首晚可自救，其他板子不能自救。用过解药后不再得知刀口。' },
  knight: { name: '骑士', team: '好人阵营 · 神职', color: '#d9a84a', desc: '白天发言阶段（投票前）可随时翻牌，与一名玩家决斗，整局一次。对方是狼人则其立即出局，跳过当天投票直接入夜；对方是好人则骑士出局，发言继续。' },
  guard: { name: '守卫', team: '好人阵营 · 神职', color: '#5b9cff', desc: '每晚守护一名玩家（可以守自己或空守）免受狼刀，不能连续两晚守同一人。与女巫解药救同一人时效果抵消，该玩家仍然死亡（同守同救）。' },
  hunter: { name: '猎人', team: '好人阵营 · 神职', color: '#f5a524', desc: '出局时可开枪带走一名玩家；被女巫毒杀不能开枪。' },
  idiot: { name: '白痴', team: '好人阵营 · 神职', color: '#2ec8d6', desc: '白天被放逐时系统自动翻牌，公布白痴身份。' },
  villager: { name: '村民', team: '好人阵营 · 平民', color: '#c9a36b', desc: '没有特殊技能，依靠发言与投票找出狼人。' },
};

export const PHASE_TITLE: Record<PlayerView['phase'], string> = {
  lobby: '等待玩家',
  night: '夜晚',
  dawn: '天亮了',
  hunter: '开枪技能',
  badge: '警徽移交',
  exile_confirm: '放逐遗言',
  sheriff_signup: '警长竞选 · 报名',
  sheriff_speech: '警长竞选 · 发言',
  sheriff_vote: '警长竞选 · 投票',
  speech_order: '警长决定发言顺序',
  day_speech: '白天发言',
  sheriff_suggest: '警长归票',
  exile_vote: '放逐投票',
  exile_pk_speech: '平票 PK 发言',
  ended: '游戏结束',
};
