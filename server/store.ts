// 房间状态存储：带版本号的乐观并发控制（compare-and-swap），保证并发提交不会重复结算
import type { GameState } from '../shared/types';

export interface Loaded {
  state: GameState;
  version: string;
}

export interface RoomStore {
  get(code: string): Promise<Loaded | null>;
  /** 仅当房间不存在时创建 */
  create(code: string, state: GameState): Promise<boolean>;
  /** 仅当版本未变化时写入；版本冲突返回 false */
  update(code: string, state: GameState, version: string): Promise<boolean>;
}

/** 本地开发 / 测试用内存存储 */
export class MemoryStore implements RoomStore {
  private rooms = new Map<string, { json: string; version: number }>();

  async get(code: string) {
    const r = this.rooms.get(code);
    return r ? { state: JSON.parse(r.json) as GameState, version: String(r.version) } : null;
  }

  async create(code: string, state: GameState) {
    if (this.rooms.has(code)) return false;
    this.rooms.set(code, { json: JSON.stringify(state), version: 1 });
    return true;
  }

  async update(code: string, state: GameState, version: string) {
    const r = this.rooms.get(code);
    if (!r || String(r.version) !== version) return false;
    this.rooms.set(code, { json: JSON.stringify(state), version: r.version + 1 });
    return true;
  }
}

/** Netlify Blobs（部署到 Netlify 时零配置可用），使用 etag 条件写入 */
export class BlobsStore implements RoomStore {
  private storePromise = import('@netlify/blobs').then(({ getStore }) =>
    getStore({ name: 'werewolf-rooms', consistency: 'strong' }));

  async get(code: string) {
    const store = await this.storePromise;
    const r = await store.getWithMetadata(code, { type: 'json', consistency: 'strong' });
    if (!r || !r.etag) return null;
    return { state: r.data as GameState, version: r.etag };
  }

  async create(code: string, state: GameState) {
    const store = await this.storePromise;
    const r = await store.setJSON(code, state, { onlyIfNew: true });
    return this.confirmWrite(code, state, r);
  }

  async update(code: string, state: GameState, version: string) {
    const store = await this.storePromise;
    const r = await store.setJSON(code, state, { onlyIfMatch: version });
    return this.confirmWrite(code, state, r);
  }

  /**
   * @netlify/blobs 的条件写入对 412 以外的任何状态（例如并发时的 429 限流、5xx）都会报告 modified: true，
   * 但真正写入成功时一定返回新的 etag。没有 etag 时读回比对，确认数据确实写入，否则按冲突处理并重试。
   */
  private async confirmWrite(code: string, state: GameState, r: { modified: boolean; etag?: string }) {
    if (!r.modified) return false;
    if (r.etag) return true;
    const store = await this.storePromise;
    const current = await store.get(code, { type: 'json', consistency: 'strong' });
    return JSON.stringify(current) === JSON.stringify(state);
  }
}

/** Supabase Postgres：rooms 表开启 RLS 且不建任何策略，客户端（anon key）无法读取；仅服务端 service role 访问 */
export class SupabaseStore implements RoomStore {
  private clientPromise: Promise<import('@supabase/supabase-js').SupabaseClient>;

  constructor(url: string, serviceKey: string) {
    this.clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }));
  }

  async get(code: string) {
    const db = await this.clientPromise;
    const { data, error } = await db.from('rooms').select('state, version').eq('code', code).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { state: data.state as GameState, version: String(data.version) } : null;
  }

  async create(code: string, state: GameState) {
    const db = await this.clientPromise;
    const { error } = await db.from('rooms').insert({ code, state, version: 1 });
    if (error) {
      if (error.code === '23505') return false;
      throw new Error(error.message);
    }
    return true;
  }

  async update(code: string, state: GameState, version: string) {
    const db = await this.clientPromise;
    const { data, error } = await db.from('rooms')
      .update({ state, version: Number(version) + 1, updated_at: new Date().toISOString() })
      .eq('code', code).eq('version', Number(version)).select('code');
    if (error) throw new Error(error.message);
    return (data?.length ?? 0) > 0;
  }
}

let singleton: RoomStore | null = null;

export function getRoomStore(): RoomStore {
  if (singleton) return singleton;
  const env = process.env;
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    singleton = new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  } else if (env.NETLIFY || env.NETLIFY_BLOBS_CONTEXT || env.STORE === 'blobs') {
    singleton = new BlobsStore();
  } else {
    singleton = new MemoryStore();
  }
  return singleton;
}

export function setRoomStore(store: RoomStore) {
  singleton = store;
}
