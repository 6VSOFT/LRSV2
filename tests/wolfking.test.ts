import { describe, expect, it } from 'vitest';
import { addPlayer, applyAction, createGame, evaluateWinner, GameError } from '../shared/engine';
import { buildView } from '../shared/view';
import { WOLF_KING_GUARD_12 } from '../shared/types';
import { Game, playRandom, shuffleRoles, T0 } from './helpers';

const expectErr = (fn: () => void, msg?: RegExp) => {
  expect(fn).toThrow(GameError);
  if (msg) expect(fn).toThrow(msg);
};

/** 座位：1 狼王，2-4 狼，5 预言家，6 女巫，7 猎人，8 守卫，9-12 村民 */
const wkg = () => new Game({ board: 'wkg12' });

/** 完整一晚：守卫守 guard → 狼刀 kill → 女巫 → 预言家查 check → 猎人确认 */
function night(g: Game, o: { guard?: number | null; kill: number; witch?: { action: 'save' | 'poison' | 'none'; target?: number }; check?: number }) {
  g.guardStep(o.guard ?? null);
  g.wolvesKill(o.kill);
  g.witchStep(o.witch);
  g.seerStep(o.check ?? 2);
  g.hunterStep();
}

/** 首夜结束后：跳过竞选 → 公布首夜信息 */
function firstDawn(g: Game) {
  g.skipElection();
  expect(g.state.phase).toBe('dawn');
}

/** 白天全员发言后把 target 放逐 */
function exile(g: Game, target: number) {
  g.finishSpeeches();
  g.voteAll({}, target);
  expect(g.state.exiledPendingId).toBe(g.id(target));
  g.confirmExile();
}

describe('狼王守卫：房间与发牌', () => {
  it('12 人局身份配置正确，首夜从守卫开始', () => {
    const s = createGame('R', { id: 'a1', nickname: '甲', tokenHash: 'x' }, T0, 'wkg12');
    for (let i = 2; i <= 12; i++) addPlayer(s, { id: `a${i}`, nickname: `n${i}`, tokenHash: 'x' }, T0);
    for (let i = 1; i <= 12; i++) applyAction(s, `a${i}`, { type: 'ready', ready: true }, T0, Math.random);
    applyAction(s, 'a1', { type: 'start' }, T0, Math.random);
    expect(s.players.map((p) => p.role).sort()).toEqual(WOLF_KING_GUARD_12.slice().sort());
    expect(s.night!.step).toBe('guard');
  });

  it('没有守卫的板子不经过守卫步骤', () => {
    expect(new Game().state.night!.step).toBe('wolf');
    expect(new Game({ board: 'pnl9' }).state.night!.step).toBe('wolf');
  });

  it('狼人能看到狼王队友；狼王也参与刀人', () => {
    const g = wkg();
    const v = buildView(g.state, g.id(2), g.now).me!;
    expect(v.teammates.sort()).toEqual(['p1', 'p3', 'p4']);
    expect(v.teammateRoles).toEqual({ p1: 'wolf_king' });
    expect(buildView(g.state, g.id(1), g.now).me!.teammateRoles).toEqual({});
    // 好人看不到任何狼队友信息
    expect(buildView(g.state, g.id(9), g.now).me!.teammateRoles).toEqual({});
    g.guardStep(null);
    expect(buildView(g.state, g.id(1), g.now).me!.wolfCanAct).toBe(true);
  });
});

describe('守卫', () => {
  it('守卫行动前狼人不能刀人；守卫看到自己的守护面板', () => {
    const g = wkg();
    expectErr(() => g.act(1, { type: 'wolf_pick', targetId: g.id(9), lock: true }), /不是你的行动时间/);
    expect(buildView(g.state, g.id(8), g.now).me!.guard!.canAct).toBe(true);
    expect(buildView(g.state, g.id(9), g.now).me!.guard).toBeNull();
  });

  it('守中刀口则平安夜', () => {
    const g = wkg();
    night(g, { guard: 9, kill: 9 });
    firstDawn(g);
    expect(g.state.dawnDeaths).toEqual([]);
    expect(g.p(9).alive).toBe(true);
  });

  it('守卫可以守自己', () => {
    const g = wkg();
    night(g, { guard: 8, kill: 8 });
    firstDawn(g);
    expect(g.p(8).alive).toBe(true);
  });

  it('同守同救：守卫与解药救同一人，该玩家仍然死亡，解药消耗', () => {
    const g = wkg();
    night(g, { guard: 9, kill: 9, witch: { action: 'save' } });
    firstDawn(g);
    expect(g.state.dawnDeaths).toEqual(['p9']);
    expect(g.p(9).alive).toBe(false);
    expect(g.state.witchPotions.antidote).toBe(false);
    expect(g.state.nightRecords![0].guard).toEqual({ guardId: 'p8', targetId: 'p9' });
  });

  it('守护不能挡毒药', () => {
    const g = wkg();
    night(g, { guard: 10, kill: 9, witch: { action: 'poison', target: 10 } });
    firstDawn(g);
    expect(g.state.dawnDeaths.sort()).toEqual(['p10', 'p9']);
  });

  it('不能连续两晚守护同一人，空守后可以再守', () => {
    const g = wkg();
    night(g, { guard: 9, kill: 10 });
    firstDawn(g);
    g.act(1, { type: 'continue' });
    exile(g, 12);
    expect(g.state.night!.step).toBe('guard');
    expect(buildView(g.state, g.id(8), g.now).me!.guard!.lastTargetId).toBe('p9');
    expectErr(() => g.act(8, { type: 'guard', targetId: g.id(9) }), /连续两晚/);
    g.act(8, { type: 'guard', targetId: null });
    expect(g.state.night!.step).toBe('wolf');
    expect(g.state.night!.guardTargetId).toBeNull();
  });

  it('守卫出局后守卫步骤用随机等待伪装', () => {
    const g = wkg();
    night(g, { kill: 8 });
    firstDawn(g);
    g.act(1, { type: 'continue' });
    exile(g, 12);
    expect(g.state.night!.step).toBe('guard');
    expect(g.state.night!.fakeUntil).not.toBeNull();
    expectErr(() => g.act(1, { type: 'wolf_pick', targetId: g.id(9), lock: true }));
    g.wait(30_000);
    expect(g.state.night!.step).toBe('wolf');
    expect(g.state.nightRecords).toHaveLength(1);
  });
});

describe('狼王', () => {
  it('预言家查验狼王结果为狼人', () => {
    const g = wkg();
    night(g, { kill: 9, check: 1 });
    expect(g.state.seerChecks[0]).toMatchObject({ targetId: 'p1', isWolf: true });
  });

  it('被放逐后可以开枪带人，身份公开', () => {
    const g = wkg();
    night(g, { kill: 9 });
    firstDawn(g);
    g.act(1, { type: 'continue' });
    exile(g, 1);
    expect(g.state.phase).toBe('hunter');
    expect(g.state.effects[0]).toEqual({ type: 'hunter', playerId: 'p1' });
    expect(buildView(g.state, g.id(5), g.now).players[0].role).toBe('wolf_king');
    expect(buildView(g.state, g.id(1), g.now).me!.hunterCanShoot).toBe(true);
    g.act(1, { type: 'hunter_shoot', targetId: g.id(5) });
    expect(g.p(5).alive).toBe(false);
    expect(g.p(5).deathCause).toBe('wolf_king');
    expect(g.state.phase).toBe('night');
  });

  it('狼王带走猎人，猎人仍可开枪', () => {
    const g = wkg();
    night(g, { kill: 9 });
    firstDawn(g);
    g.act(1, { type: 'continue' });
    exile(g, 1);
    g.act(1, { type: 'hunter_shoot', targetId: g.id(7) });
    expect(g.state.phase).toBe('hunter');
    expect(g.state.effects[0]).toEqual({ type: 'hunter', playerId: 'p7' });
    g.act(7, { type: 'hunter_shoot', targetId: g.id(2) });
    expect(g.p(2).alive).toBe(false);
  });

  it('夜间自刀出局可以开枪', () => {
    const g = wkg();
    night(g, { kill: 1 });
    firstDawn(g);
    expect(g.p(1).alive).toBe(false);
    g.act(1, { type: 'continue' });
    expect(g.state.phase).toBe('hunter');
    expect(g.state.effects[0].playerId).toBe('p1');
  });

  it('被女巫毒杀不能开枪', () => {
    const g = wkg();
    night(g, { kill: 9, witch: { action: 'poison', target: 1 } });
    firstDawn(g);
    expect(g.p(1).deathCause).toBe('poison');
    g.act(1, { type: 'continue' });
    expect(g.state.phase).not.toBe('hunter');
    expect(buildView(g.state, g.id(1), g.now).me!.hunterDeathCause).toBe('poison');
  });
});

describe('狼王守卫：胜负', () => {
  it('狼王与普狼全部出局才算好人胜利；守卫计入神职', () => {
    const g = wkg();
    const kill = (...seats: number[]) => seats.forEach((s) => (g.p(s).alive = false));
    kill(2, 3, 4);
    expect(evaluateWinner(g.state)).toBeNull();
    kill(1);
    expect(evaluateWinner(g.state)!.winner).toBe('good');

    const h = wkg();
    [5, 6, 7].forEach((s) => (h.p(s).alive = false));
    expect(evaluateWinner(h.state)).toBeNull();
    h.p(8).alive = false;
    expect(evaluateWinner(h.state)!.reason).toMatch(/屠神/);
  });

  it('200 局随机对局都能正常结束', () => {
    let seed = 7;
    const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 200; i++) {
      const g = wkg();
      g.rng = rng;
      const roles = shuffleRoles(WOLF_KING_GUARD_12, rng);
      g.state.players.forEach((p, k) => (p.role = roles[k]));
      playRandom(g, rng);
      expect(g.state.status).toBe('ended');
      const view = buildView(g.state, g.id(1), g.now);
      expect(view.fullReveal!.nightRecords.every((r) => r.guard !== undefined)).toBe(true);
    }
  });
});
