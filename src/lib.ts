import type { Action } from '../shared/engine';
import type { PlayerView, Role } from '../shared/types';

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
  create: (nickname: string) => post<Session>('create', { nickname }),
  join: (code: string, nickname: string, token?: string) => post<Session>('join', { code, nickname, token }),
  state: (code: string, token?: string) => post<PlayerView>('state', { code, token }),
  action: (s: Session, action: Action) => post<PlayerView>('action', { code: s.code, token: s.token, action }),
};

export const ROLE_INFO: Record<Role, { name: string; team: string; desc: string; color: string }> = {
  werewolf: { name: '狼人', team: '狼人阵营', color: '#e5484d', desc: '每晚与狼队友共同选择击杀一名玩家（可自刀）。屠神或屠民即获胜。' },
  seer: { name: '预言家', team: '好人阵营 · 神职', color: '#8e7cff', desc: '每晚查验一名玩家，得知其是好人还是狼人。' },
  witch: { name: '女巫', team: '好人阵营 · 神职', color: '#3dd68c', desc: '一瓶解药、一瓶毒药，每晚最多用一瓶，不能自救。用过解药后不再得知刀口。' },
  hunter: { name: '猎人', team: '好人阵营 · 神职', color: '#f5a524', desc: '被狼人击杀或被放逐时可开枪带走一名玩家；被毒杀不能开枪。' },
  idiot: { name: '白痴', team: '好人阵营 · 神职', color: '#2ec8d6', desc: '白天被放逐时系统自动翻牌，公布白痴身份。' },
  villager: { name: '村民', team: '好人阵营 · 平民', color: '#c9a36b', desc: '没有特殊技能，依靠发言与投票找出狼人。' },
};

export const PHASE_TITLE: Record<PlayerView['phase'], string> = {
  lobby: '等待玩家',
  night: '夜晚',
  dawn: '天亮了',
  hunter: '猎人技能',
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
