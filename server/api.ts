// 与运行环境无关的 API 处理器：Netlify Function 与本地 Vite 开发服务器共用
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Action, addPlayer, applyAction, createGame, GameError, parseBoardId, Rng, ROOM_DISSOLVED, tick, touch } from '../shared/engine';
import { GameState, Player } from '../shared/types';
import { buildView } from '../shared/view';
import { getRoomStore, RoomStore } from './store';

export interface ApiResult {
  status: number;
  body: unknown;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_RETRIES = 12;

/** 服务端使用加密安全的随机数洗牌与随机选择 */
export const secureRng: Rng = () => randomBytes(4).readUInt32BE(0) / 0x1_0000_0000;

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function newCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(secureRng() * CODE_ALPHABET.length)];
  return s;
}

function normCode(raw: unknown) {
  const code = String(raw ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(code)) throw new GameError('房间代码无效');
  return code;
}

function findByToken(state: GameState, token: unknown): Player | null {
  if (typeof token !== 'string' || token.length < 16) return null;
  const h = Buffer.from(hashToken(token), 'hex');
  for (const p of state.players) {
    const ph = Buffer.from(p.tokenHash, 'hex');
    if (ph.length === h.length && timingSafeEqual(ph, h)) return p;
  }
  return null;
}

/** 读取-修改-条件写入；版本冲突时重新读取并重放，确保并发请求只结算一次 */
async function mutate<T>(
  store: RoomStore, code: string,
  fn: (state: GameState, now: number) => { changed: boolean; result: T },
): Promise<T> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const loaded = await store.get(code);
    if (!loaded) throw new GameError('房间不存在');
    const now = Date.now();
    const { changed, result } = fn(loaded.state, now);
    if (!changed) return result;
    if (await store.update(code, loaded.state, loaded.version)) return result;
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 60 * (attempt + 1)));
  }
  throw new Error('服务器繁忙，请重试');
}

export async function handleApi(route: string, body: any, store: RoomStore = getRoomStore()): Promise<ApiResult> {
  try {
    body = body ?? {};
    switch (route) {
      case 'create': {
        const token = randomBytes(24).toString('hex');
        const playerId = randomBytes(6).toString('hex');
        const board = parseBoardId(body.board);
        for (let i = 0; i < 10; i++) {
          const code = newCode();
          const state = createGame(code, { id: playerId, nickname: body.nickname, tokenHash: hashToken(token) }, Date.now(), board);
          if (await store.create(code, state)) return { status: 200, body: { code, token, playerId } };
        }
        throw new Error('无法生成房间代码，请重试');
      }

      case 'join': {
        const code = normCode(body.code);
        const token = randomBytes(24).toString('hex');
        const result = await mutate(store, code, (state, now) => {
          // 同一设备已在房间中 → 直接恢复原座位，不占用新座位
          if (state.dissolved) throw new GameError(ROOM_DISSOLVED);
          const existing = findByToken(state, body.token);
          if (existing) return { changed: false, result: { code, token: body.token as string, playerId: existing.id } };
          const playerId = randomBytes(6).toString('hex');
          addPlayer(state, { id: playerId, nickname: body.nickname, tokenHash: hashToken(token) }, now);
          return { changed: true, result: { code, token, playerId } };
        });
        return { status: 200, body: result };
      }

      case 'state': {
        const code = normCode(body.code);
        const view = await mutate(store, code, (state, now) => {
          if (state.dissolved) throw new GameError(ROOM_DISSOLVED);
          const me = findByToken(state, body.token);
          const changedTick = tick(state, now, secureRng);
          const changedPresence = me ? touch(state, me.id, now) : false;
          return { changed: changedTick || changedPresence, result: buildView(state, me?.id ?? null, now) };
        });
        return { status: 200, body: view };
      }

      case 'action': {
        const code = normCode(body.code);
        const action = body.action as Action;
        if (!action || typeof action.type !== 'string') throw new GameError('无效的操作');
        const view = await mutate(store, code, (state, now) => {
          const me = findByToken(state, body.token);
          if (!me) throw new GameError('身份验证失败，请重新加入房间');
          applyAction(state, me.id, action, now, secureRng);
          // leave 之后该玩家已不在房间
          return { changed: true, result: buildView(state, state.players.some((p) => p.id === me.id) ? me.id : null, now) };
        });
        return { status: 200, body: view };
      }

      default:
        return { status: 404, body: { error: '未知接口' } };
    }
  } catch (e) {
    if (e instanceof GameError) return { status: 400, body: { error: e.message } };
    console.error(e);
    return { status: 500, body: { error: e instanceof Error ? e.message : '服务器错误' } };
  }
}
