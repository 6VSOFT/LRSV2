import { describe, expect, it } from 'vitest';
import { addPlayer, applyAction, createGame, GameError } from '../shared/engine';
import { buildView } from '../shared/view';
import { STANDARD_9 } from '../shared/types';
import { handleApi } from '../server/api';
import { MemoryStore } from '../server/store';
import { Game, playRandom, shuffleRoles, T0 } from './helpers';

const expectErr = (fn: () => void, msg?: RegExp) => {
  expect(fn).toThrow(GameError);
  if (msg) expect(fn).toThrow(msg);
};

/** 狼人统一刀 kill，停在女巫行动前 */
function toWitchStep(g: Game, kill: number) {
  g.wolvesKill(kill);
  expect(g.state.night!.step).toBe('witch');
}

/** 女巫之后：预言家查验 + 猎人确认，完成夜晚 */
function finishNight(g: Game, check = 1) {
  g.seerStep(check);
  g.hunterStep();
}

describe('9 人局：房间与发牌', () => {
  it('满 9 人后拒绝第 10 人；9 人到齐才能开始', () => {
    const s = createGame('R', { id: 'a1', nickname: '甲', tokenHash: 'x' }, T0, 'pnl9');
    for (let i = 2; i <= 9; i++) addPlayer(s, { id: `a${i}`, nickname: `n${i}`, tokenHash: 'x' }, T0);
    expectErr(() => addPlayer(s, { id: 'a10', nickname: 'n10', tokenHash: 'x' }, T0), /9 人/);
    expectErr(() => applyAction(s, 'a2', { type: 'seat', seat: 10 }, T0, Math.random), /座位号/);
    for (let i = 1; i <= 9; i++) applyAction(s, `a${i}`, { type: 'ready', ready: true }, T0, Math.random);
    applyAction(s, 'a1', { type: 'start' }, T0, Math.random);
    expect(s.players.map((p) => p.role).sort()).toEqual(STANDARD_9.slice().sort());
    expect(s.players.filter((p) => p.role === 'werewolf').length).toBe(3);
    expect(s.players.some((p) => p.role === 'idiot')).toBe(false);
  });

  it('视图包含板子信息；狼人能看到 2 名狼队友', () => {
    const g = new Game({ board: 'pnl9' });
    const v = buildView(g.state, g.id(1), g.now);
    expect(v.board.id).toBe('pnl9');
    expect(v.board.size).toBe(9);
    expect(v.me!.teammates.sort()).toEqual(['p2', 'p3']);
  });

  it('API 按选择的板子创建房间，未知板子被拒绝', async () => {
    const store = new MemoryStore();
    const r = await handleApi('create', { nickname: '房主', board: 'pnl9' }, store);
    expect(r.status).toBe(200);
    const code = (r.body as any).code;
    expect((await store.get(code))!.state.board).toBe('pnl9');
    expect((await handleApi('create', { nickname: '房主', board: 'xx' }, store)).status).toBe(400);
    const d = await handleApi('create', { nickname: '房主' }, store);
    expect((await store.get((d.body as any).code))!.state.board).toBe('std12');
  });
});

describe('9 人局：女巫首晚可以自救', () => {
  it('首晚女巫被刀可以用解药自救', () => {
    const g = new Game({ board: 'pnl9' });
    toWitchStep(g, 5);
    const w = buildView(g.state, g.id(5), g.now).me!.witch!;
    expect(w.knownKillTargetId).toBe('p5');
    expect(w.canSave).toBe(true);
    g.act(5, { type: 'witch', action: 'save' });
    finishNight(g);
    g.dawn();
    expect(g.state.phase).toBe('dawn');
    expect(g.state.dawnDeaths).toEqual([]);
    expect(g.p(5).alive).toBe(true);
  });

  it('第二晚起女巫不能自救', () => {
    const g = new Game({ board: 'pnl9' });
    toWitchStep(g, 7);
    g.act(5, { type: 'witch', action: 'none' }); // 首晚不用药，保留解药
    finishNight(g);
    g.skipElection();
    g.act(1, { type: 'continue' });
    g.finishSpeeches();
    g.voteAll({}, null);
    expect(g.state.phase).toBe('night');
    expect(g.state.day).toBe(2);
    toWitchStep(g, 5);
    expect(buildView(g.state, g.id(5), g.now).me!.witch!.canSave).toBe(false);
    expectErr(() => g.act(5, { type: 'witch', action: 'save' }), /只有首晚/);
  });

  it('12 人局女巫首晚也不能自救', () => {
    const g = new Game();
    toWitchStep(g, 6);
    expectErr(() => g.act(6, { type: 'witch', action: 'save' }), /不能自救/);
  });
});

describe('9 人局：首夜信息在警长竞选结束后公布', () => {
  it('首夜被刀者在竞选期间仍显示存活，竞选结束后才公布', () => {
    const g = new Game({ board: 'pnl9' });
    g.night(7, 1);
    expect(g.state.phase).toBe('sheriff_signup');
    expect(buildView(g.state, g.id(8), g.now).players.find((p) => p.seat === 7)!.alive).toBe(true);
    g.skipElection();
    expect(g.state.phase).toBe('dawn');
    expect(g.state.dawnDeaths).toEqual(['p7']);
    expect(g.p(7).alive).toBe(false);
  });
});

describe('9 人局：屠边胜负', () => {
  it('屠神：预言家、女巫、猎人全部出局狼人胜', () => {
    const g = new Game({ board: 'pnl9' });
    g.p(4).alive = false;
    g.p(5).alive = false;
    g.night(6, 1); // 女巫已死，刀猎人
    g.dawn();
    expect(g.state.winner).toBe('wolf');
    expect(g.state.winReason).toContain('屠神');
  });

  it('屠民：3 名村民全部出局狼人胜', () => {
    const g = new Game({ board: 'pnl9' });
    g.p(7).alive = false;
    g.p(8).alive = false;
    g.night(9, 1);
    g.dawn();
    expect(g.state.winner).toBe('wolf');
    expect(g.state.winReason).toContain('屠民');
  });

  it('3 狼全部出局好人胜', () => {
    const g = new Game({ board: 'pnl9' });
    g.p(1).alive = false;
    g.p(2).alive = false;
    toWitchStep(g, 7);
    g.act(5, { type: 'witch', action: 'poison', targetId: g.id(3) });
    finishNight(g, 3);
    g.dawn();
    expect(g.state.winner).toBe('good');
  });
});

describe('9 人局：完整对局模拟', () => {
  it('随机进行 200 局都能正常结束', () => {
    for (let seed = 1; seed <= 200; seed++) {
      let x = seed * 7919 + 104729;
      const rng = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
      const g = new Game({ board: 'pnl9' });
      g.rng = rng;
      const roles = shuffleRoles(STANDARD_9, rng);
      g.state.players.forEach((p, i) => (p.role = roles[i]));
      playRandom(g, rng);
      expect(g.state.status).toBe('ended');
      expect(g.state.winner).not.toBeNull();
    }
  });
});
