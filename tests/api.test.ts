import { describe, expect, it } from 'vitest';
import { handleApi } from '../server/api';
import { MemoryStore } from '../server/store';
import type { GameState, PlayerView } from '../shared/types';

type S = { code: string; token: string; playerId: string };

async function call(store: MemoryStore, route: string, body: unknown) {
  return handleApi(route, body, store);
}

async function setupRoom(store: MemoryStore) {
  const c = await call(store, 'create', { nickname: '房主' });
  expect(c.status).toBe(200);
  const host = c.body as S;
  const players: S[] = [host];
  for (let i = 2; i <= 12; i++) {
    const j = await call(store, 'join', { code: host.code, nickname: `玩家${i}` });
    expect(j.status).toBe(200);
    players.push(j.body as S);
  }
  return players;
}

async function act(store: MemoryStore, s: S, action: unknown) {
  return call(store, 'action', { code: s.code, token: s.token, action });
}

async function raw(store: MemoryStore, code: string): Promise<GameState> {
  return (await store.get(code))!.state;
}

describe('API：房间与访问控制', () => {
  it('第 13 人被拒绝；同一设备重复加入不会占用新座位', async () => {
    const store = new MemoryStore();
    const ps = await setupRoom(store);
    const r13 = await call(store, 'join', { code: ps[0].code, nickname: '第13人' });
    expect(r13.status).toBe(400);
    expect((r13.body as any).error).toMatch(/已满/);
    const again = await call(store, 'join', { code: ps[0].code, nickname: '随便', token: ps[3].token });
    expect((again.body as S).playerId).toBe(ps[3].playerId);
    expect((await raw(store, ps[0].code)).players.length).toBe(12);
  });

  it('伪造令牌无法操作；令牌以哈希形式存储', async () => {
    const store = new MemoryStore();
    const ps = await setupRoom(store);
    const bad = await call(store, 'action', { code: ps[0].code, token: 'x'.repeat(48), action: { type: 'start' } });
    expect(bad.status).toBe(400);
    const st = await raw(store, ps[0].code);
    expect(JSON.stringify(st)).not.toContain(ps[0].token);
  });

  it('开始后每位玩家只能拿到自己的身份；无令牌请求拿不到任何身份', async () => {
    const store = new MemoryStore();
    const ps = await setupRoom(store);
    for (const p of ps) await act(store, p, { type: 'ready', ready: true });
    const nonHost = await act(store, ps[1], { type: 'start' });
    expect(nonHost.status).toBe(400);
    const started = await act(store, ps[0], { type: 'start' });
    expect(started.status).toBe(200);
    const st = await raw(store, ps[0].code);
    for (const p of ps) {
      const v = (await call(store, 'state', { code: p.code, token: p.token })).body as PlayerView;
      const mine = st.players.find((x) => x.id === p.playerId)!;
      expect(v.me!.role).toBe(mine.role);
      expect(v.players.every((x) => x.role === null)).toBe(true);
      const text = JSON.stringify(v);
      // 整个响应里只出现自己的身份
      expect(text.match(/"role":"[a-z]+"/g)).toEqual([`"role":"${mine.role}"`]);
      if (mine.role !== 'werewolf') expect(v.me!.teammates).toEqual([]);
      else expect(v.me!.teammates.length).toBe(3);
      expect(text).not.toContain('tokenHash');
    }
    const anon = (await call(store, 'state', { code: ps[0].code })).body as PlayerView;
    expect(anon.me).toBeNull();
    // board 是公开的板子配置，除此之外不能出现任何身份
    expect(JSON.stringify({ ...anon, board: null })).not.toMatch(/"role":"|werewolf|seer|witch|hunter|villager/);
  });
});

describe('API：并发与重复提交', () => {
  it('同时提交的投票全部被正确计入且只结算一次；重复投票被拒绝', async () => {
    const store = new MemoryStore();
    const ps = await setupRoom(store);
    for (const p of ps) await act(store, p, { type: 'ready', ready: true });
    await act(store, ps[0], { type: 'start' });
    const byId = (id: string) => ps.find((p) => p.playerId === id)!;
    let st = await raw(store, ps[0].code);
    const villager = st.players.find((p) => p.role === 'villager')!;
    const wolves = st.players.filter((p) => p.role === 'werewolf');
    const seer = st.players.find((p) => p.role === 'seer')!;
    const witch = st.players.find((p) => p.role === 'witch')!;

    // 4 狼并发锁定 + 重复点击
    const wolfReqs = wolves.flatMap((w) => [
      act(store, byId(w.id), { type: 'wolf_pick', targetId: villager.id, lock: true }),
      act(store, byId(w.id), { type: 'wolf_pick', targetId: villager.id, lock: true }),
    ]);
    const wolfRes = await Promise.all(wolfReqs);
    expect(wolfRes.filter((r) => r.status === 200).length).toBe(4);
    // 女巫重复提交救人：解药只消耗一次
    const w1 = await Promise.all([
      act(store, byId(witch.id), { type: 'witch', action: 'save' }),
      act(store, byId(witch.id), { type: 'witch', action: 'save' }),
    ]);
    expect(w1.filter((r) => r.status === 200).length).toBe(1);
    await act(store, byId(seer.id), { type: 'seer_check', targetId: villager.id });
    // 猎人重复确认，只推进一次
    const hunter = st.players.find((p) => p.role === 'hunter')!;
    const h = await Promise.all([1, 2].map(() => act(store, byId(hunter.id), { type: 'hunter_ack' })));
    expect(h.filter((r) => r.status === 200).length).toBe(1);
    st = await raw(store, ps[0].code);
    expect(st.phase).toBe('dawn');
    expect(st.dawnDeaths).toEqual([]);
    expect(st.witchPotions.antidote).toBe(false);

    // 多人同时点继续，只推进一次
    await Promise.all(ps.slice(0, 5).map((p) => act(store, p, { type: 'continue' })));
    st = await raw(store, ps[0].code);
    expect(st.phase).toBe('sheriff_signup');
    await Promise.all(ps.map((p) => act(store, p, { type: 'sheriff_signup', join: false })));
    st = await raw(store, ps[0].code);
    expect(st.phase).toBe('day_speech');
    while ((st = await raw(store, ps[0].code)).phase === 'day_speech') {
      await act(store, byId(st.speech!.order[st.speech!.index]), { type: 'speech_done' });
    }
    expect(st.phase).toBe('exile_vote');
    const target = wolves[0].id;
    const votes = await Promise.all(ps.flatMap((p) => [
      act(store, p, { type: 'vote', targetId: target }),
      act(store, p, { type: 'vote', targetId: target }),
    ]));
    expect(votes.filter((r) => r.status === 200).length).toBe(12);
    st = await raw(store, ps[0].code);
    expect(st.voteResults.length).toBe(1);
    expect(st.voteResults[0].tally).toEqual([{ targetId: target, votes: 12 }]);
    expect(st.phase).toBe('exile_confirm');
    // 被放逐者重复点击确认，只结算一次
    const confirms = await Promise.all([1, 2, 3].map(() => act(store, byId(target), { type: 'exile_confirm' })));
    expect(confirms.filter((r) => r.status === 200).length).toBe(1);
    st = await raw(store, ps[0].code);
    expect(st.players.find((p) => p.id === target)!.alive).toBe(false);
    expect(st.phase).toBe('night');
    expect(st.day).toBe(2);

    // 已出局玩家不能行动
    const deadWolf = byId(target);
    const r = await act(store, deadWolf, { type: 'wolf_pick', targetId: villager.id, lock: true });
    expect(r.status).toBe(400);
  });
});
