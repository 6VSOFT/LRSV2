import { describe, expect, it } from 'vitest';
import { evaluateWinner, GameError } from '../shared/engine';
import { buildView } from '../shared/view';
import { WOLF_BEAUTY_KNIGHT_12 } from '../shared/types';
import { Game, playRandom, shuffleRoles } from './helpers';

const expectErr = (fn: () => void, msg?: RegExp) => {
  expect(fn).toThrow(GameError);
  if (msg) expect(fn).toThrow(msg);
};

/** 座位：1 狼美人，2-4 狼，5 预言家，6 女巫，7 骑士，8 守卫，9-12 村民 */
const wbk = () => new Game({ board: 'wbk12' });

/** 完整一晚：守卫 → 狼刀 kill → 狼美人魅惑 charm → 女巫 → 预言家 */
function night(g: Game, o: { guard?: number | null; kill: number; charm?: number | null; witch?: { action: 'save' | 'poison' | 'none'; target?: number }; check?: number }) {
  g.guardStep(o.guard ?? null);
  g.wolvesKill(o.kill);
  g.charmStep(o.charm ?? null);
  g.witchStep(o.witch);
  g.seerStep(o.check ?? 2);
}

/** 首夜后跳过竞选、公布首夜信息并继续，进入白天发言 */
function toDay(g: Game) {
  g.skipElection();
  g.act(1, { type: 'continue' });
  expect(g.state.phase).toBe('day_speech');
}

function exile(g: Game, target: number) {
  g.finishSpeeches();
  g.voteAll({}, target);
  g.confirmExile();
}

describe('狼美人骑士：房间与夜晚顺序', () => {
  it('身份配置正确；夜间顺序 守卫 → 狼人 → 狼美人 → 女巫 → 预言家，没有猎人步骤', () => {
    const g = wbk();
    expect(g.state.players.map((p) => p.role).sort()).toEqual(WOLF_BEAUTY_KNIGHT_12.slice().sort());
    const steps: string[] = [];
    const record = () => steps.push(g.state.night!.step);
    record(); g.guardStep(null);
    record(); g.wolvesKill(9);
    record(); g.charmStep(10);
    record(); g.act(6, { type: 'witch', action: 'none' });
    record(); g.seerStep(2);
    expect(steps).toEqual(['guard', 'wolf', 'charm', 'witch', 'seer']);
    expect(g.state.phase).toBe('sheriff_signup');
  });

  it('狼人不能刀狼美人；狼队友能看到谁是狼美人', () => {
    const g = wbk();
    g.guardStep(null);
    expectErr(() => g.act(2, { type: 'wolf_pick', targetId: g.id(1), lock: true }), /狼美人/);
    expectErr(() => g.act(1, { type: 'wolf_pick', targetId: g.id(1), lock: true }), /狼美人/);
    expect(buildView(g.state, g.id(2), g.now).me!.teammateRoles).toEqual({ p1: 'wolf_beauty' });
  });

  it('魅惑：狼人行动前不能魅惑；不能魅惑自己；不能连续两晚魅惑同一人', () => {
    const g = wbk();
    expectErr(() => g.act(1, { type: 'charm', targetId: g.id(9) }), /不是你的行动时间/);
    g.guardStep(null);
    g.wolvesKill(12);
    expect(buildView(g.state, g.id(1), g.now).me!.charm!.canAct).toBe(true);
    expect(buildView(g.state, g.id(2), g.now).me!.charm).toBeNull();
    expectErr(() => g.act(1, { type: 'charm', targetId: g.id(1) }), /自己/);
    g.charmStep(9);
    g.witchStep();
    g.seerStep(2);
    toDay(g);
    expect(g.state.charmTargetId).toBe('p9');
    exile(g, 11);
    g.guardStep(null);
    g.wolvesKill(10);
    expectErr(() => g.act(1, { type: 'charm', targetId: g.id(9) }), /连续两晚/);
    g.charmStep(5);
    expect(g.state.night!.step).toBe('witch');
  });

  it('预言家查验狼美人为狼人', () => {
    const g = wbk();
    night(g, { kill: 9, check: 1 });
    expect(g.state.seerChecks[0]).toMatchObject({ targetId: 'p1', isWolf: true });
  });
});

describe('狼美人殉情', () => {
  it('狼美人被放逐：遗言后出局，被魅惑者殉情（无遗言）', () => {
    const g = wbk();
    night(g, { kill: 9, charm: 5 });
    toDay(g);
    g.finishSpeeches();
    g.voteAll({}, 1);
    expect(g.state.exiledPendingId).toBe('p1');
    g.confirmExile();
    expect(g.p(1).alive).toBe(false);
    expect(g.p(5).alive).toBe(false);
    expect(g.p(5).deathCause).toBe('charm');
    expect(g.state.log.some((l) => l.public && l.text.includes('殉情'))).toBe(true);
    expect(g.state.phase).toBe('night');
  });

  it('狼美人当晚被毒杀：当晚魅惑的玩家一同出局', () => {
    const g = wbk();
    night(g, { kill: 9, charm: 10, witch: { action: 'poison', target: 1 } });
    g.skipElection();
    expect(g.state.dawnDeaths.sort()).toEqual(['p1', 'p10', 'p9']);
    expect(g.p(10).deathCause).toBe('charm');
  });

  it('守卫挡不住殉情；狼美人不魅惑时无人殉情', () => {
    const g = wbk();
    night(g, { kill: 9, charm: 10, guard: 10, witch: { action: 'poison', target: 1 } });
    g.skipElection();
    expect(g.p(10).alive).toBe(false);

    const h = wbk();
    night(h, { kill: 9, charm: null, witch: { action: 'poison', target: 1 } });
    h.skipElection();
    expect(h.state.dawnDeaths.sort()).toEqual(['p1', 'p9']);
  });
});

describe('骑士决斗', () => {
  it('决斗狼人：狼人出局，跳过投票直接入夜；骑士身份公开', () => {
    const g = wbk();
    night(g, { kill: 9 });
    toDay(g);
    expect(buildView(g.state, g.id(7), g.now).me!.knight).toEqual({ canDuel: true, used: false });
    g.act(7, { type: 'duel', targetId: g.id(2) });
    expect(g.p(2).alive).toBe(false);
    expect(g.p(2).deathCause).toBe('duel');
    expect(g.p(7).revealed).toBe(true);
    expect(g.state.phase).toBe('night');
    expect(g.state.day).toBe(2);
    expect(g.state.voteResults).toHaveLength(0);
  });

  it('决斗狼美人：魅惑不生效，被魅惑者不殉情', () => {
    const g = wbk();
    night(g, { kill: 9, charm: 5 });
    toDay(g);
    g.act(7, { type: 'duel', targetId: g.id(1) });
    expect(g.p(1).alive).toBe(false);
    expect(g.p(5).alive).toBe(true);
    expect(g.state.phase).toBe('night');
  });

  it('决斗好人：骑士出局，发言继续，之后正常投票；技能只能用一次', () => {
    const g = wbk();
    night(g, { kill: 9 });
    toDay(g);
    g.act(7, { type: 'duel', targetId: g.id(10) });
    expect(g.p(7).alive).toBe(false);
    expect(g.p(10).alive).toBe(true);
    expect(g.state.phase).toBe('day_speech');
    expectErr(() => g.act(7, { type: 'duel', targetId: g.id(2) }));
    g.finishSpeeches();
    expect(g.state.phase).toBe('exile_vote');
    expect(g.state.vote!.voters).not.toContain('p7');
  });

  it('决斗失败的骑士是警长：先移交警徽，再继续发言', () => {
    const g = wbk();
    night(g, { kill: 9 });
    for (const p of g.state.players.filter((x) => x.alive)) g.act(p.seat, { type: 'sheriff_signup', join: p.seat === 7 });
    expect(g.state.sheriffId).toBe('p7');
    g.act(1, { type: 'continue' });
    g.act(7, { type: 'speech_order', direction: 'cw' });
    g.act(7, { type: 'duel', targetId: g.id(10) });
    expect(g.state.phase).toBe('badge');
    g.act(7, { type: 'badge', targetId: g.id(11) });
    expect(g.state.sheriffId).toBe('p11');
    expect(g.state.phase).toBe('day_speech');
  });

  it('只能在白天发言阶段决斗；非骑士不能决斗', () => {
    const g = wbk();
    night(g, { kill: 9 });
    expectErr(() => g.act(7, { type: 'duel', targetId: g.id(2) }), /白天发言/);
    toDay(g);
    expectErr(() => g.act(5, { type: 'duel', targetId: g.id(2) }), /骑士/);
    expectErr(() => g.act(7, { type: 'duel', targetId: g.id(7) }));
    g.finishSpeeches();
    expectErr(() => g.act(7, { type: 'duel', targetId: g.id(2) }), /白天发言/);
  });

  it('决斗最后一只狼：好人立即获胜', () => {
    const g = wbk();
    night(g, { kill: 9 });
    toDay(g);
    [1, 2, 3].forEach((s) => (g.p(s).alive = false));
    g.act(7, { type: 'duel', targetId: g.id(4) });
    expect(g.state.status).toBe('ended');
    expect(g.state.winner).toBe('good');
  });
});

describe('狼美人骑士：胜负与随机对局', () => {
  it('骑士、守卫计入神职（屠神）', () => {
    const g = wbk();
    [5, 6, 8].forEach((s) => (g.p(s).alive = false));
    expect(evaluateWinner(g.state)).toBeNull();
    g.p(7).alive = false;
    expect(evaluateWinner(g.state)!.reason).toMatch(/屠神/);
  });

  it('200 局随机对局都能正常结束', () => {
    let seed = 11;
    const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 200; i++) {
      const g = wbk();
      g.rng = rng;
      const roles = shuffleRoles(WOLF_BEAUTY_KNIGHT_12, rng);
      g.state.players.forEach((p, k) => (p.role = roles[k]));
      playRandom(g, rng);
      expect(g.state.status).toBe('ended');
      const lovers = g.state.players.filter((p) => p.deathCause === 'charm');
      const beauty = g.state.players.find((p) => p.role === 'wolf_beauty')!;
      if (lovers.length) expect(beauty.alive).toBe(false);
      expect(lovers.length).toBeLessThanOrEqual(1);
    }
  });
});
