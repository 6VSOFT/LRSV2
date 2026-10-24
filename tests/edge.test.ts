import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addPlayer, applyAction, createGame, GameError, OFFLINE_MS, SHERIFF_BONUS_SECONDS, speechSecondsFor,
} from '../shared/engine';
import { buildView } from '../shared/view';
import { needsMyPublicAction } from '../src/turn';
import { buildRecordText } from '../src/record';
import { handleApi } from '../server/api';
import { MemoryStore } from '../server/store';
import { Game, T0 } from './helpers';

const expectErr = (fn: () => void, msg?: RegExp) => {
  expect(fn).toThrow(GameError);
  if (msg) expect(fn).toThrow(msg);
};

function endGame(g: Game) {
  g.state.players.filter((p) => p.role === 'werewolf').forEach((p) => (p.alive = false));
  g.night(9, 10);
  g.dawn();
  expect(g.state.status).toBe('ended');
}

describe('等待室', () => {
  it('只有房主能改设置，改设置会重置准备；座位被占时不能换', () => {
    const s = createGame('R', { id: 'a1', nickname: '甲', tokenHash: 'x' }, T0);
    addPlayer(s, { id: 'a2', nickname: '乙', tokenHash: 'x' }, T0);
    applyAction(s, 'a2', { type: 'ready', ready: true }, T0, Math.random);
    expectErr(() => applyAction(s, 'a2', { type: 'settings', settings: { speechSeconds: 60 } }, T0, Math.random), /创建者/);
    applyAction(s, 'a1', { type: 'settings', settings: { speechSeconds: 60 } }, T0, Math.random);
    expect(s.settings.speechSeconds).toBe(60);
    expect(s.players.every((p) => !p.ready)).toBe(true);
    expectErr(() => applyAction(s, 'a2', { type: 'seat', seat: 1 }, T0, Math.random), /有人/);
    applyAction(s, 'a2', { type: 'seat', seat: 7 }, T0, Math.random);
    expect(s.players.find((p) => p.id === 'a2')!.seat).toBe(7);
  });

  it('房主离开后由座位最小的玩家接任房主', () => {
    const s = createGame('R', { id: 'a1', nickname: '甲', tokenHash: 'x' }, T0);
    addPlayer(s, { id: 'a2', nickname: '乙', tokenHash: 'x' }, T0);
    addPlayer(s, { id: 'a3', nickname: '丙', tokenHash: 'x' }, T0);
    applyAction(s, 'a1', { type: 'leave' }, T0, Math.random);
    expect(s.creatorId).toBe('a2');
    expect(s.players.length).toBe(2);
  });

  it('游戏开始后不能换座、离开或改设置', () => {
    const g = new Game();
    expectErr(() => g.act(1, { type: 'seat', seat: 5 }));
    expectErr(() => g.act(1, { type: 'leave' }));
    expectErr(() => g.act(1, { type: 'settings', settings: { speechSeconds: 60 } }));
  });
});

describe('再来一局', () => {
  it('只有房主、只有游戏结束后可以重开；重开后保留玩家、清空身份记录，可以再次开始', () => {
    const g = new Game();
    expectErr(() => g.act(1, { type: 'restart' }), /尚未结束/);
    endGame(g);
    expectErr(() => g.act(2, { type: 'restart' }), /创建者/);
    g.act(1, { type: 'restart' });
    const s = g.state;
    expect(s.status).toBe('lobby');
    expect(s.players.length).toBe(12);
    expect(s.players.every((p) => p.role === null && p.alive && !p.ready && !p.revealed)).toBe(true);
    expect(s.log).toEqual([]);
    expect(s.voteResults).toEqual([]);
    expect(s.seerChecks).toEqual([]);
    expect(s.witchPotions).toEqual({ antidote: true, poison: true });
    for (let i = 1; i <= 12; i++) g.act(i, { type: 'ready', ready: true });
    g.act(1, { type: 'start' });
    expect(s.status).toBe('playing');
    expect(s.phase).toBe('night');
  });

  it('游戏结束后其他操作一律被拒绝', () => {
    const g = new Game();
    endGame(g);
    expectErr(() => g.act(1, { type: 'continue' }), /结束/);
    expectErr(() => g.act(5, { type: 'vote', targetId: 'p1' }), /结束/);
  });
});

describe('发言与断线', () => {
  it('当前发言者在线时不能被跳过；离线超过阈值后其他人可以跳过', () => {
    const g = new Game();
    g.night(9, 1, { action: 'save' });
    g.skipElection();
    g.act(1, { type: 'continue' });
    const sp = g.state.speech!;
    const cur = g.state.players.find((p) => p.id === sp.order[sp.index])!;
    const other = g.state.players.find((p) => p.id !== cur.id)!;
    expectErr(() => g.act(other.seat, { type: 'speech_done' }), /还没轮到/);
    expectErr(() => g.act(other.seat, { type: 'speech_skip' }), /断线/);
    cur.lastSeen = g.now - OFFLINE_MS - 1000;
    g.act(other.seat, { type: 'speech_skip' });
    expect(g.state.speech!.index).toBe(1);
    expect(g.state.log.at(-1)!.text).toContain('断线');
  });

  it('离线玩家在视图中显示为离线，系统不会替其投票', () => {
    const g = new Game();
    g.p(4).lastSeen = g.now - OFFLINE_MS - 1;
    const v = buildView(g.state, g.id(9), g.now);
    expect(v.players.find((p) => p.seat === 4)!.connected).toBe(false);
    expect(v.players.find((p) => p.seat === 9)!.connected).toBe(true);
  });

  it('出局玩家也可以在天亮时点继续，但不能投票或发言', () => {
    const g = new Game();
    g.night(9, 1);
    g.dawn();
    expect(g.p(9).alive).toBe(false);
    g.act(9, { type: 'continue' });
    expect(g.state.phase).toBe('day_speech');
    expect(g.state.speech!.order).not.toContain('p9');
    g.finishSpeeches();
    expectErr(() => g.act(9, { type: 'vote', targetId: g.id(1) }), /出局/);
  });
});

describe('发言倒计时', () => {
  it('新房间默认 90 秒，警长 120 秒', () => {
    const s = createGame('R', { id: 'a1', nickname: '甲', tokenHash: 'x' }, T0);
    expect(s.settings.speechSeconds).toBe(90);
    expect(speechSecondsFor(s.settings, 'a1', 'a1')).toBe(120);
  });

  it('警长发言比其他玩家多 30 秒', () => {
    const settings = { idiotFlipSurvives: false, speechSeconds: 120 };
    expect(speechSecondsFor(settings, 'p3', 'p3')).toBe(150);
    expect(speechSecondsFor(settings, 'p3', 'p4')).toBe(120);
    expect(speechSecondsFor(settings, null, 'p4')).toBe(120);
    expect(speechSecondsFor({ ...settings, speechSeconds: 60 }, 'p3', 'p3')).toBe(60 + SHERIFF_BONUS_SECONDS);
  });
});

describe('轮到你提醒', () => {
  it('夜间行动不触发提醒（避免震动暴露身份），白天投票/发言会触发', () => {
    const g = new Game();
    for (const seat of [1, 5, 6, 9]) expect(needsMyPublicAction(buildView(g.state, g.id(seat), g.now))).toBe(false);
    g.night(9, 1, { action: 'save' });
    expect(needsMyPublicAction(buildView(g.state, g.id(3), g.now))).toBe(true); // 上警报名
    g.skipElection();
    g.act(1, { type: 'continue' });
    g.finishSpeeches();
    expect(needsMyPublicAction(buildView(g.state, g.id(3), g.now))).toBe(true); // 投票
    g.act(3, { type: 'vote', targetId: null });
    expect(needsMyPublicAction(buildView(g.state, g.id(3), g.now))).toBe(false);
  });
});

describe('夜间记录（结果页）', () => {
  it('记录每晚狼人投票与刀口、女巫用药、猎人开枪资格；结束前不公开', () => {
    const g = new Game();
    g.rng = () => 0;
    // 第 1 夜：两狼刀 9、两狼刀 10（平票，rng=0 选 9 号）；女巫救人
    for (const s of [1, 2]) g.act(s, { type: 'wolf_pick', targetId: g.id(9), lock: true });
    for (const s of [3, 4]) g.act(s, { type: 'wolf_pick', targetId: g.id(10), lock: true });
    g.witchStep({ action: 'save' });
    g.seerStep(1);
    g.hunterStep();
    expect(buildView(g.state, g.id(9), g.now).fullReveal).toBeNull();
    g.dawn();
    g.act(1, { type: 'continue' });
    g.finishSpeeches();
    g.voteAll({}, null);
    // 第 2 夜：女巫毒猎人
    g.wolvesKill(11);
    g.witchStep({ action: 'poison', target: 7 });
    g.seerStep(2);
    g.hunterStep();
    const r = g.state.nightRecords!;
    expect(r[0]).toEqual({
      night: 1,
      wolfVotes: [
        { wolfId: 'p1', targetId: 'p9' }, { wolfId: 'p2', targetId: 'p9' },
        { wolfId: 'p3', targetId: 'p10' }, { wolfId: 'p4', targetId: 'p10' },
      ],
      killTargetId: 'p9',
      witch: { type: 'save', targetId: 'p9' },
      hunter: { hunterId: 'p7', canShoot: true },
    });
    expect(r[1].witch).toEqual({ type: 'poison', targetId: 'p7' });
    expect(r[1].hunter).toEqual({ hunterId: 'p7', canShoot: false });
    // 女巫、猎人已出局的夜晚记为 null
    g.p(6).alive = false;
    g.act(1, { type: 'continue' });
    g.finishSpeeches();
    g.voteAll({}, null);
    g.night(12, 3);
    expect(g.state.nightRecords![2].witch).toBeNull();
    expect(g.state.nightRecords![2].hunter).toBeNull();
    // 结束后公开
    endGameNow(g);
    expect(buildView(g.state, g.id(9), g.now).fullReveal!.nightRecords.length).toBe(4); // 含结束那一晚
  });
});

describe('复制游戏记录', () => {
  it('进行中只包含公开信息；结束后包含身份、夜间记录、投票与完整日志', () => {
    const g = new Game();
    g.night(9, 1);
    const during = buildRecordText(buildView(g.state, g.id(2), g.now));
    expect(during).toContain('【公开记录】');
    expect(during).not.toMatch(/【身份】|女巫用|毒杀|解药|刀口|锁定击杀|：狼人|查验/);
    g.dawn();
    g.act(1, { type: 'continue' });
    g.finishSpeeches();
    g.voteAll({}, 10);
    g.confirmExile();
    endGameNow(g);
    const text = buildRecordText(buildView(g.state, g.id(2), g.now));
    for (const s of ['结果：', '【身份】', '【预言家查验】', '【女巫用药】', '【猎人技能】', '【狼人刀人】', '【投票记录】', '【完整日志】']) {
      expect(text).toContain(s);
    }
    expect(text).toContain('1号 玩家1：狼人');
    expect(text).toContain('第 1 夜：刀口 9号 玩家9（1号→9号，2号→9号，3号→9号，4号→9号）');
    // 结果卡片的复制：同样的摘要，不含日志
    const summary = buildRecordText(buildView(g.state, g.id(2), g.now), { includeLog: false });
    expect(summary).toContain('【狼人刀人】');
    expect(summary).toContain('【投票记录】');
    expect(summary).not.toContain('【完整日志】');
  });
});

function endGameNow(g: Game) {
  g.state.players.filter((p) => p.role === 'werewolf').forEach((p) => (p.alive = false));
  if (g.state.phase === 'dawn') {
    g.act(1, { type: 'continue' });
    g.finishSpeeches();
    g.voteAll({}, null);
  }
  // 狼人已全部出局：按步骤推进（女巫、猎人已出局时靠伪装等待）
  for (let i = 0; i < 10 && g.state.phase === 'night'; i++) {
    const step = g.state.night!.step;
    if (step === 'witch' && g.p(6).alive) g.witchStep();
    else if (step === 'seer' && g.p(5).alive) g.seerStep(5);
    else if (step === 'hunter' && g.p(7).alive) g.hunterStep();
    else g.wait(60_000);
  }
  g.dawn();
  expect(g.state.status).toBe('ended');
}

describe('版本兼容', () => {
  it('旧版本保存的夜晚（狼人与预言家同时行动）升级后自动转换为新顺序，不会卡住', () => {
    const g = new Game();
    const night = g.state.night as any;
    night.step = 'wolf_seer';
    delete night.hunterAcked;
    delete night.fakeUntil;
    night.seerFakeUntil = null;
    g.wait(1000);
    expect(g.state.night!.step).toBe('wolf');
    g.night(9, 1);
    g.dawn();
    expect(g.state.phase).toBe('dawn');
    expect(g.state.dawnDeaths).toEqual(['p9']);
  });
});

describe('API：服务端计时推进', () => {
  afterEach(() => vi.useRealTimers());

  it('女巫、预言家、猎人都已出局时，夜晚靠任意玩家轮询按伪装时间逐步推进', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const store = new MemoryStore();
    const host = (await handleApi('create', { nickname: '房主' }, store)).body as any;
    const ps = [host];
    for (let i = 2; i <= 12; i++) ps.push((await handleApi('join', { code: host.code, nickname: `p${i}` }, store)).body);
    for (const p of ps) await handleApi('action', { code: host.code, token: p.token, action: { type: 'ready', ready: true } }, store);
    await handleApi('action', { code: host.code, token: host.token, action: { type: 'start' } }, store);

    // 直接修改存储模拟：女巫、预言家、猎人都已出局
    const loaded = (await store.get(host.code))!;
    const st = loaded.state;
    st.players.forEach((p) => { if (p.role === 'seer' || p.role === 'witch' || p.role === 'hunter') p.alive = false; });
    await store.update(host.code, st, loaded.version);

    const byId = (id: string) => ps.find((p: any) => p.playerId === id);
    const victim = st.players.find((p) => p.role === 'villager')!;
    for (const w of st.players.filter((p) => p.role === 'werewolf')) {
      const r = await handleApi('action', { code: host.code, token: byId(w.id).token, action: { type: 'wolf_pick', targetId: victim.id, lock: true } }, store);
      expect(r.status).toBe(200);
    }
    const stepAt = async (ms: number) => {
      vi.setSystemTime(T0 + ms);
      await handleApi('state', { code: host.code, token: host.token }, store);
      return (await store.get(host.code))!.state;
    };
    expect((await stepAt(0)).night!.step).toBe('witch');
    expect((await stepAt(17_000)).night!.step).toBe('seer');
    expect((await stepAt(34_000)).night!.step).toBe('hunter');
    vi.setSystemTime(T0 + 44_000);
    const v = (await handleApi('state', { code: host.code }, store)).body as any;
    // 首夜结束 → 先竞选警长，死讯暂不公布，被刀者在视图中仍为存活
    expect(v.phase).toBe('sheriff_signup');
    expect(v.dawnDeaths).toEqual([]);
    expect(v.players.find((p: any) => p.id === victim.id).alive).toBe(true);
  });

  it('游戏结束后的操作请求返回错误', async () => {
    const store = new MemoryStore();
    const host = (await handleApi('create', { nickname: '房主' }, store)).body as any;
    const loaded = (await store.get(host.code))!;
    loaded.state.status = 'ended';
    loaded.state.phase = 'ended';
    await store.update(host.code, loaded.state, loaded.version);
    const r = await handleApi('action', { code: host.code, token: host.token, action: { type: 'ready', ready: true } }, store);
    expect(r.status).toBe(400);
  });

  it('非法请求：未知接口、错误房间代码、缺少操作', async () => {
    const store = new MemoryStore();
    expect((await handleApi('hack', {}, store)).status).toBe(404);
    expect((await handleApi('state', { code: '../x' }, store)).status).toBe(400);
    expect((await handleApi('state', { code: 'ZZZZZZ' }, store)).status).toBe(400);
    const host = (await handleApi('create', { nickname: '房主' }, store)).body as any;
    expect((await handleApi('action', { code: host.code, token: host.token }, store)).status).toBe(400);
    expect((await handleApi('create', { nickname: '   ' }, store)).status).toBe(400);
    expect((await handleApi('create', { nickname: '一二三四五六七八九十一二三' }, store)).status).toBe(400);
  });
});

describe('解散房间', () => {
  it('只有房主能解散；解散后任何操作、加入、查询都返回「房间已解散」', async () => {
    const store = new MemoryStore();
    const host = (await handleApi('create', { nickname: '房主' }, store)).body as any;
    const guest = (await handleApi('join', { code: host.code, nickname: '客人' }, store)).body as any;
    const notHost = await handleApi('action', { code: host.code, token: guest.token, action: { type: 'dissolve' } }, store);
    expect(notHost.status).toBe(400);
    expect((notHost.body as any).error).toMatch(/房主/);
    expect((await handleApi('action', { code: host.code, token: host.token, action: { type: 'dissolve' } }, store)).status).toBe(200);
    for (const r of [
      await handleApi('state', { code: host.code, token: guest.token }, store),
      await handleApi('join', { code: host.code, nickname: '新人' }, store),
      await handleApi('action', { code: host.code, token: host.token, action: { type: 'ready', ready: true } }, store),
    ]) {
      expect(r.status).toBe(400);
      expect((r.body as any).error).toBe('房间已解散');
    }
  });

  it('游戏进行中房主也可以解散', () => {
    const g = new Game();
    g.act(1, { type: 'dissolve' });
    expect(g.state.dissolved).toBe(true);
    expect(() => g.act(1, { type: 'wolf_pick', targetId: g.id(9), lock: true })).toThrow(/房间已解散/);
  });
});
