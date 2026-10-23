import { describe, expect, it } from 'vitest';
import { addPlayer, applyAction, createGame, evaluateWinner, GameError, speechOrderFrom } from '../shared/engine';
import { buildView } from '../shared/view';
import { STANDARD_12 } from '../shared/types';
import { Game, T0 } from './helpers';

const expectErr = (fn: () => void, msg?: RegExp) => {
  expect(fn).toThrow(GameError);
  if (msg) expect(fn).toThrow(msg);
};

/** 第一夜平安夜后，推进到首日放逐投票（无警长） */
function toFirstExileVote(g: Game) {
  g.night(9, 1, { action: 'save' }); // 9 号被刀被救
  g.act(1, { type: 'continue' });
  g.skipElection();
  g.finishSpeeches();
  expect(g.state.phase).toBe('exile_vote');
}

describe('房间与身份分配', () => {
  it('第 13 名玩家无法加入，昵称不可重复', () => {
    const s = createGame('R', { id: 'a1', nickname: '甲', tokenHash: 'x' }, T0);
    expectErr(() => addPlayer(s, { id: 'a2', nickname: '甲', tokenHash: 'x' }, T0), /昵称/);
    for (let i = 2; i <= 12; i++) addPlayer(s, { id: `a${i}`, nickname: `n${i}`, tokenHash: 'x' }, T0);
    expect(s.players.map((p) => p.seat)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expectErr(() => addPlayer(s, { id: 'a13', nickname: 'n13', tokenHash: 'x' }, T0), /已满/);
  });

  it('人数不足或未准备不能开始，且只有创建者能开始', () => {
    const s = createGame('R', { id: 'a1', nickname: '甲', tokenHash: 'x' }, T0);
    expectErr(() => applyAction(s, 'a1', { type: 'start' }, T0, Math.random), /12/);
    for (let i = 2; i <= 12; i++) addPlayer(s, { id: `a${i}`, nickname: `n${i}`, tokenHash: 'x' }, T0);
    expectErr(() => applyAction(s, 'a1', { type: 'start' }, T0, Math.random), /未准备/);
    for (let i = 1; i <= 12; i++) applyAction(s, `a${i}`, { type: 'ready', ready: true }, T0, Math.random);
    expectErr(() => applyAction(s, 'a2', { type: 'start' }, T0, Math.random), /创建者/);
    applyAction(s, 'a1', { type: 'start' }, T0, Math.random);
    expect(s.status).toBe('playing');
    expect(s.phase).toBe('night');
  });

  it('随机分配 4 狼 4 神 4 民', () => {
    for (let k = 0; k < 20; k++) {
      const s = createGame('R', { id: 'a1', nickname: '甲', tokenHash: 'x' }, T0);
      for (let i = 2; i <= 12; i++) addPlayer(s, { id: `a${i}`, nickname: `n${i}`, tokenHash: 'x' }, T0);
      for (let i = 1; i <= 12; i++) applyAction(s, `a${i}`, { type: 'ready', ready: true }, T0, Math.random);
      applyAction(s, 'a1', { type: 'start' }, T0, Math.random);
      expect(s.players.map((p) => p.role).sort()).toEqual(STANDARD_12.slice().sort());
    }
  });

  it('游戏开始后不能再加入', () => {
    const g = new Game();
    expectErr(() => addPlayer(g.state, { id: 'x', nickname: 'x', tokenHash: 'x' }, T0), /已开始/);
  });
});

describe('信息保密（视图裁剪）', () => {
  it('非狼人看不到任何他人身份；狼人只看到狼队友', () => {
    const g = new Game();
    const v = buildView(g.state, g.id(9), g.now);
    expect(v.players.every((p) => p.role === null)).toBe(true);
    expect(v.me!.role).toBe('villager');
    expect(v.me!.teammates).toEqual([]);
    expect(v.log.every((l) => l.public)).toBe(true);
    expect(JSON.stringify(v)).not.toContain('werewolf');

    const wv = buildView(g.state, g.id(1), g.now);
    expect(wv.me!.teammates.sort()).toEqual(['p2', 'p3', 'p4']);
    expect(wv.players.every((p) => p.role === null)).toBe(true);
  });

  it('夜间刀口只有狼人（和有资格的女巫）可见，查验结果只有预言家可见', () => {
    const g = new Game();
    for (const s of [1, 2, 3, 4]) g.act(s, { type: 'wolf_pick', targetId: g.id(10), lock: true });
    g.act(5, { type: 'seer_check', targetId: g.id(2) });
    const villagerView = JSON.stringify(buildView(g.state, g.id(9), g.now));
    expect(villagerView).not.toContain('wolfVotes":{');
    expect(buildView(g.state, g.id(9), g.now).me!.seerChecks).toEqual([]);
    expect(buildView(g.state, g.id(5), g.now).me!.seerChecks).toEqual([{ night: 1, targetId: 'p2', isWolf: true }]);
    const witch = buildView(g.state, g.id(6), g.now).me!.witch!;
    expect(witch.knownKillTargetId).toBe('p10');
    expect(buildView(g.state, g.id(7), g.now).me!.witch).toBeNull();
    // 公共阶段不暴露夜间子步骤
    expect(JSON.stringify(buildView(g.state, g.id(9), g.now))).not.toContain('"step"');
  });

  it('游戏结束后公开完整身份与记录', () => {
    const g = new Game();
    g.state.players.filter((p) => p.role === 'werewolf').forEach((p) => (p.alive = false));
    g.night(9, 10); // 结算时狼人已全灭
    expect(g.state.status).toBe('ended');
    const v = buildView(g.state, g.id(9), g.now);
    expect(v.players.every((p) => p.role !== null)).toBe(true);
    expect(v.log.some((l) => !l.public)).toBe(true);
  });
});

describe('狼人行动', () => {
  it('票数最多者为刀口，锁定后不能修改', () => {
    const g = new Game();
    g.act(1, { type: 'wolf_pick', targetId: g.id(9), lock: true });
    expectErr(() => g.act(1, { type: 'wolf_pick', targetId: g.id(10), lock: true }), /锁定/);
    g.act(2, { type: 'wolf_pick', targetId: g.id(10), lock: false });
    g.act(2, { type: 'wolf_pick', targetId: g.id(9), lock: true });
    g.act(3, { type: 'wolf_pick', targetId: g.id(10), lock: true });
    g.act(4, { type: 'wolf_pick', targetId: g.id(9), lock: true });
    g.act(5, { type: 'seer_check', targetId: g.id(9) });
    expect(g.state.night!.killTargetId).toBe('p9');
  });

  it('平票时随机选刀口；可以自刀', () => {
    const g = new Game();
    g.rng = () => 0.99;
    g.act(1, { type: 'wolf_pick', targetId: g.id(1), lock: true });
    g.act(2, { type: 'wolf_pick', targetId: g.id(1), lock: true });
    g.act(3, { type: 'wolf_pick', targetId: g.id(10), lock: true });
    g.act(4, { type: 'wolf_pick', targetId: g.id(10), lock: true });
    g.act(5, { type: 'seer_check', targetId: g.id(9) });
    expect(g.state.night!.killTargetId).toBe('p10');

    const g2 = new Game();
    g2.rng = () => 0;
    for (const s of [1, 2]) g2.act(s, { type: 'wolf_pick', targetId: g2.id(1), lock: true });
    for (const s of [3, 4]) g2.act(s, { type: 'wolf_pick', targetId: g2.id(10), lock: true });
    g2.act(5, { type: 'seer_check', targetId: g2.id(9) });
    expect(g2.state.night!.killTargetId).toBe('p1');
  });

  it('非狼人不能刀人，不能刀死人', () => {
    const g = new Game();
    expectErr(() => g.act(9, { type: 'wolf_pick', targetId: g.id(10), lock: true }), /狼人/);
    g.p(10).alive = false;
    expectErr(() => g.act(1, { type: 'wolf_pick', targetId: g.id(10), lock: true }), /出局/);
  });
});

describe('预言家', () => {
  it('每晚只能查验 1 人，只返回好人/狼人', () => {
    const g = new Game();
    g.act(5, { type: 'seer_check', targetId: g.id(6) });
    expectErr(() => g.act(5, { type: 'seer_check', targetId: g.id(1) }), /已查验/);
    expect(g.state.seerChecks).toEqual([{ night: 1, targetId: 'p6', isWolf: false }]);
    const view = buildView(g.state, g.id(5), g.now);
    expect(view.players.find((p) => p.id === 'p6')!.role).toBeNull();
  });

  it('可以查验自己；非预言家不能查验', () => {
    const g = new Game();
    expectErr(() => g.act(9, { type: 'seer_check', targetId: g.id(1) }), /预言家/);
    g.act(5, { type: 'seer_check', targetId: g.id(5) });
    expect(g.state.seerChecks[0].isWolf).toBe(false);
  });
});

describe('女巫', () => {
  it('解药救人抵消刀口 → 平安夜', () => {
    const g = new Game();
    g.night(9, 1, { action: 'save' });
    expect(g.state.phase).toBe('dawn');
    expect(g.state.dawnDeaths).toEqual([]);
    expect(g.state.witchPotions.antidote).toBe(false);
  });

  it('女巫不能自救', () => {
    const g = new Game();
    for (const s of [1, 2, 3, 4]) g.act(s, { type: 'wolf_pick', targetId: g.id(6), lock: true });
    g.act(5, { type: 'seer_check', targetId: g.id(1) });
    expect(buildView(g.state, g.id(6), g.now).me!.witch!.canSave).toBe(false);
    expectErr(() => g.act(6, { type: 'witch', action: 'save' }), /自救/);
  });

  it('同一晚不能双药；药剂只能用一次', () => {
    const g = new Game();
    for (const s of [1, 2, 3, 4]) g.act(s, { type: 'wolf_pick', targetId: g.id(9), lock: true });
    g.act(5, { type: 'seer_check', targetId: g.id(1) });
    g.act(6, { type: 'witch', action: 'poison', targetId: g.id(1) });
    expectErr(() => g.act(6, { type: 'witch', action: 'save' }));
    expect(g.state.dawnDeaths.sort()).toEqual(['p1', 'p9']);
    // 第二晚毒药已用完
    g.act(1, { type: 'continue' });
    g.skipElection();
    g.finishSpeeches();
    g.voteAll({}, null);
    expect(g.state.phase).toBe('night');
    for (const s of [2, 3, 4]) g.act(s, { type: 'wolf_pick', targetId: g.id(10), lock: true });
    g.act(5, { type: 'seer_check', targetId: g.id(2) });
    expectErr(() => g.act(6, { type: 'witch', action: 'poison', targetId: g.id(2) }), /毒药已用完/);
  });

  it('使用解药后，后续夜晚不再获知刀口；解药不能再用', () => {
    const g = new Game();
    toFirstExileVote(g);
    g.voteAll({}, null); // 全部弃票
    for (const s of [1, 2, 3, 4]) g.act(s, { type: 'wolf_pick', targetId: g.id(10), lock: true });
    g.act(5, { type: 'seer_check', targetId: g.id(2) });
    const w = buildView(g.state, g.id(6), g.now).me!.witch!;
    expect(w.canAct).toBe(true);
    expect(w.knownKillTargetId).toBeUndefined();
    expect(w.canSave).toBe(false);
    expectErr(() => g.act(6, { type: 'witch', action: 'save' }), /解药已用完/);
  });

  it('同时被刀和被毒只死一次', () => {
    const g = new Game();
    for (const s of [1, 2, 3, 4]) g.act(s, { type: 'wolf_pick', targetId: g.id(9), lock: true });
    g.act(5, { type: 'seer_check', targetId: g.id(1) });
    g.act(6, { type: 'witch', action: 'poison', targetId: g.id(9) });
    expect(g.state.dawnDeaths).toEqual(['p9']);
    expect(g.p(9).deathCause).toBe('poison');
  });

  it('结算结果与提交顺序无关（女巫先于预言家之后都一样）', () => {
    const a = new Game();
    a.act(5, { type: 'seer_check', targetId: a.id(1) });
    for (const s of [4, 3, 2, 1]) a.act(s, { type: 'wolf_pick', targetId: a.id(11), lock: true });
    a.act(6, { type: 'witch', action: 'none' });
    const b = new Game();
    b.night(11, 1);
    expect(a.state.dawnDeaths).toEqual(b.state.dawnDeaths);
  });

  it('已死亡角色的夜晚步骤自动用伪装等待跳过', () => {
    const g = new Game();
    g.p(5).alive = false; // 预言家已死（模拟）
    g.p(6).alive = false; // 女巫已死
    // 需要重新开始夜晚，伪装计时在夜晚开始时设置
    g.state.night!.seerFakeUntil = g.now + 5000;
    for (const s of [1, 2, 3, 4]) g.act(s, { type: 'wolf_pick', targetId: g.id(9), lock: true });
    expect(g.state.night!.step).toBe('wolf_seer');
    g.wait(5000);
    expect(g.state.night!.step).toBe('witch');
    g.wait(20_000);
    expect(g.state.phase).toBe('dawn');
    expect(g.state.dawnDeaths).toEqual(['p9']);
  });
});

describe('猎人', () => {
  it('被狼人击杀可以开枪', () => {
    const g = new Game();
    g.night(7, 1);
    g.act(1, { type: 'continue' });
    expect(g.state.phase).toBe('hunter');
    expect(buildView(g.state, g.id(7), g.now).me!.hunterCanShoot).toBe(true);
    expectErr(() => g.act(9, { type: 'hunter_shoot', targetId: g.id(1) }), /不是你的/);
    g.act(7, { type: 'hunter_shoot', targetId: g.id(1) });
    expect(g.p(1).alive).toBe(false);
    expect(g.p(1).deathCause).toBe('hunter');
    expect(g.state.phase).toBe('sheriff_signup');
  });

  it('被女巫毒杀不能开枪（自动跳过）', () => {
    const g = new Game();
    g.night(9, 1, { action: 'poison', target: 7 });
    g.act(1, { type: 'continue' });
    expect(g.state.phase).toBe('sheriff_signup');
    expectErr(() => g.act(7, { type: 'hunter_shoot', targetId: g.id(1) }));
  });

  it('白天被放逐可以开枪，也可以选择不开枪', () => {
    const g = new Game();
    toFirstExileVote(g);
    g.voteAll({}, 7);
    g.confirmExile();
    expect(g.state.phase).toBe('hunter');
    g.act(7, { type: 'hunter_shoot', targetId: null });
    expect(g.state.phase).toBe('night');
    expect(g.state.day).toBe(2);
  });

  it('猎人开枪带走警长 → 警长移交警徽', () => {
    const g = new Game();
    g.night(7, 1);
    g.state.sheriffId = g.id(10); // 模拟已有警长
    g.state.electionDone = true;
    g.act(1, { type: 'continue' });
    g.act(7, { type: 'hunter_shoot', targetId: g.id(10) });
    expect(g.state.phase).toBe('badge');
    g.act(10, { type: 'badge', targetId: g.id(11) });
    expect(g.state.sheriffId).toBe('p11');
    expect(g.state.phase).toBe('speech_order');
  });
});

describe('白痴', () => {
  it('默认规则：被放逐时自动翻牌公布身份，遗言后出局', () => {
    const g = new Game();
    toFirstExileVote(g);
    g.voteAll({}, 8);
    expect(g.state.phase).toBe('exile_confirm');
    expect(g.p(8).revealed).toBe(true);
    expect(buildView(g.state, g.id(9), g.now).players.find((p) => p.seat === 8)!.role).toBe('idiot');
    expect(g.state.log.some((l) => l.public && l.text.includes('自动翻牌'))).toBe(true);
    expectErr(() => g.act(9, { type: 'exile_confirm' }));
    g.act(8, { type: 'exile_confirm' });
    expect(g.p(8).alive).toBe(false);
    expect(g.state.phase).toBe('night');
  });

  it('非白痴被放逐：不翻牌，身份不公开，遗言确认后出局', () => {
    const g = new Game();
    toFirstExileVote(g);
    g.voteAll({}, 10);
    expect(g.state.phase).toBe('exile_confirm');
    expect(g.p(10).revealed).toBe(false);
    expect(buildView(g.state, g.id(9), g.now).players.find((p) => p.seat === 10)!.role).toBeNull();
    g.act(10, { type: 'exile_confirm' });
    expect(g.p(10).alive).toBe(false);
  });

  it('经典规则选项：自动翻牌后免于出局但失去投票权，且不能再被放逐', () => {
    const g = new Game({ idiotFlipSurvives: true });
    toFirstExileVote(g);
    g.voteAll({}, 8);
    expect(g.state.phase).toBe('night');
    expect(g.p(8).revealed).toBe(true);
    expect(g.p(8).alive).toBe(true);
    expect(g.p(8).canVote).toBe(false);
    g.night(9, 2);
    g.act(1, { type: 'continue' });
    g.finishSpeeches();
    expect(g.state.vote!.voters).not.toContain('p8');
    expect(g.state.vote!.targets).not.toContain('p8');
    expectErr(() => g.act(8, { type: 'vote', targetId: g.id(1) }), /投票权/);
  });

  it('白痴被狼刀时正常出局，没有翻牌阶段', () => {
    const g = new Game();
    g.night(8, 1);
    expect(g.p(8).alive).toBe(false);
    g.act(1, { type: 'continue' });
    expect(g.state.phase).toBe('sheriff_signup');
  });
});

describe('警长竞选与投票权重', () => {
  function elect(g: Game, sheriff: number) {
    g.night(9, 1, { action: 'save' });
    g.act(1, { type: 'continue' });
    for (const p of g.state.players) g.act(p.seat, { type: 'sheriff_signup', join: p.seat === sheriff || p.seat === 12 });
    expect(g.state.phase).toBe('sheriff_speech');
    g.finishSpeeches();
    expect(g.state.phase).toBe('sheriff_vote');
    // 候选人不能投给自己
    expectErr(() => g.act(sheriff, { type: 'vote', targetId: g.id(sheriff) }), /自己/);
    g.voteAll({ 12: sheriff, [sheriff]: 12 }, sheriff);
    expect(g.state.sheriffId).toBe(g.id(sheriff));
    expect(g.state.phase).toBe('speech_order');
  }

  it('当选警长后决定发言顺序（顺时针/逆时针，警长最后）', () => {
    const g = new Game();
    elect(g, 3);
    expect(speechOrderFrom(g.state, g.id(3), 'cw').map((id) => g.state.players.find((p) => p.id === id)!.seat))
      .toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]);
    expect(speechOrderFrom(g.state, g.id(3), 'ccw').map((id) => g.state.players.find((p) => p.id === id)!.seat))
      .toEqual([2, 1, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    expectErr(() => g.act(4, { type: 'speech_order', direction: 'cw' }), /警长/);
    g.act(3, { type: 'speech_order', direction: 'cw' });
    expect(g.state.speech!.order[0]).toBe('p4');
  });

  it('归票时警长 1.5 票，不归票 1 票', () => {
    const g = new Game();
    elect(g, 9);
    g.act(9, { type: 'speech_order', direction: 'cw' });
    g.finishSpeeches();
    expect(g.state.phase).toBe('sheriff_suggest');
    g.act(9, { type: 'sheriff_suggest', targetId: g.id(1) });
    // 5 票投 1 号（含警长 1.5）= 5.5，6 票投 2 号 = 6 → 2 号出局
    g.voteAll({ 9: 1, 10: 1, 11: 1, 12: 1, 5: 1, 1: 2, 2: 2, 3: 2, 4: 2, 6: 2, 7: 2, 8: null });
    const r = g.state.voteResults.at(-1)!;
    expect(r.tally).toEqual([{ targetId: 'p1', votes: 5.5 }, { targetId: 'p2', votes: 6 }]);
    g.confirmExile();
    expect(g.p(2).alive).toBe(false);
  });

  it('不归票时警长 1 票，可能平票', () => {
    const g = new Game();
    elect(g, 9);
    g.act(9, { type: 'speech_order', direction: 'ccw' });
    g.finishSpeeches();
    g.act(9, { type: 'sheriff_suggest', targetId: null });
    g.voteAll({ 9: 1, 10: 1, 11: 1, 12: 1, 5: 1, 6: 1, 1: 2, 2: 2, 3: 2, 4: 2, 7: 2, 8: 2 });
    const r = g.state.voteResults.at(-1)!;
    expect(r.outcome).toBe('tie');
    expect(g.state.phase).toBe('exile_pk_speech');
  });

  it('警长出局可移交警徽或撕毁', () => {
    const g = new Game();
    elect(g, 9);
    g.act(9, { type: 'speech_order', direction: 'cw' });
    g.finishSpeeches();
    g.act(9, { type: 'sheriff_suggest', targetId: null });
    g.voteAll({}, 9);
    g.confirmExile();
    expect(g.state.phase).toBe('badge');
    expectErr(() => g.act(9, { type: 'badge', targetId: g.id(9) }));
    g.act(9, { type: 'badge', targetId: null });
    expect(g.state.sheriffId).toBeNull();
    expect(g.state.phase).toBe('night');
  });

  it('退水玩家不参与投票；全部退水则无警长', () => {
    const g = new Game();
    g.night(9, 1, { action: 'save' });
    g.act(1, { type: 'continue' });
    for (const p of g.state.players) g.act(p.seat, { type: 'sheriff_signup', join: [1, 2, 3].includes(p.seat) });
    const first = g.state.speech!.order[0];
    const firstSeat = g.state.players.find((p) => p.id === first)!.seat;
    g.act(firstSeat, { type: 'sheriff_withdraw' });
    g.finishSpeeches();
    expect(g.state.vote!.voters).not.toContain(first);
    expect(g.state.vote!.targets).not.toContain(first);
  });

  it('竞选平票 → PK → 平票玩家外的人重投 → 再平票无警长', () => {
    const g = new Game();
    g.night(9, 1, { action: 'save' });
    g.act(1, { type: 'continue' });
    for (const p of g.state.players) g.act(p.seat, { type: 'sheriff_signup', join: [1, 2, 3].includes(p.seat) });
    g.finishSpeeches();
    // 1 和 2 平票
    g.voteAll({ 1: 2, 2: 1, 3: 1, 4: 2, 5: 1, 6: 2, 7: 1, 8: 2, 9: 3 }, null);
    expect(g.state.phase).toBe('sheriff_speech');
    expect(g.state.speech!.purpose).toBe('sheriff_pk');
    g.finishSpeeches();
    expect(g.state.vote!.round).toBe(2);
    expect(g.state.vote!.voters).not.toContain('p1');
    expect(g.state.vote!.voters).not.toContain('p2');
    expect(g.state.vote!.voters).toContain('p3');
    g.voteAll({ 3: 1, 4: 2, 5: 1, 6: 2 }, null);
    expect(g.state.sheriffId).toBeNull();
    expect(g.state.electionDone).toBe(true);
    expect(g.state.phase).toBe('day_speech');
  });
});

describe('放逐投票', () => {
  it('投票前看不到他人选择，重复投票被拒绝，死人不能投票', () => {
    const g = new Game();
    g.night(9, 1);
    g.act(1, { type: 'continue' });
    g.skipElection();
    g.finishSpeeches();
    g.act(1, { type: 'vote', targetId: g.id(10) });
    expectErr(() => g.act(1, { type: 'vote', targetId: g.id(11) }), /已投票/);
    expectErr(() => g.act(9, { type: 'vote', targetId: g.id(11) }), /出局/);
    const v = buildView(g.state, g.id(2), g.now);
    expect(v.vote!.voted).toEqual(['p1']);
    expect(JSON.stringify(v)).not.toContain('ballots');
    expect(v.me!.myBallot).toBeUndefined();
  });

  it('允许投给自己；平票 PK 后再次平票无人出局', () => {
    const g = new Game();
    toFirstExileVote(g);
    g.voteAll({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 2 });
    expect(g.state.phase).toBe('exile_pk_speech');
    g.finishSpeeches();
    expect(g.state.vote!.round).toBe(2);
    expect(g.state.vote!.targets).toEqual(['p1', 'p2']);
    g.voteAll({ 3: 1, 4: 1, 5: 1, 6: 2, 7: 2, 8: 2, 9: null, 10: null, 11: 1, 12: 2 });
    expect(g.state.phase).toBe('night');
    expect(g.alive().length).toBe(12);
  });

  it('全部弃票无人出局', () => {
    const g = new Game();
    toFirstExileVote(g);
    g.voteAll({}, null);
    expect(g.alive().length).toBe(12);
    expect(g.state.phase).toBe('night');
  });
});

describe('屠边胜负判定', () => {
  it('屠神：4 神全部出局狼人胜', () => {
    const g = new Game();
    [5, 6, 8].forEach((s) => (g.p(s).alive = false));
    g.night(7, 1);
    expect(g.state.status).toBe('ended');
    expect(g.state.winner).toBe('wolf');
    expect(g.state.winReason).toContain('屠神');
    // 游戏结束后不能再操作，也没有猎人开枪
    expectErr(() => g.act(7, { type: 'hunter_shoot', targetId: g.id(1) }), /结束/);
  });

  it('屠民：4 民全部出局狼人胜', () => {
    const g = new Game();
    [9, 10, 11].forEach((s) => (g.p(s).alive = false));
    toFirstExileVoteNoSave(g);
    g.voteAll({}, 12);
    g.confirmExile();
    expect(g.state.winner).toBe('wolf');
    expect(g.state.winReason).toContain('屠民');
  });

  it('狼人全灭好人胜（猎人开枪带走最后一狼）', () => {
    const g = new Game();
    [1, 2, 3].forEach((s) => (g.p(s).alive = false));
    g.night(7, 4);
    g.act(5, { type: 'continue' });
    g.act(7, { type: 'hunter_shoot', targetId: g.id(4) });
    expect(g.state.winner).toBe('good');
    expect(g.state.phase).toBe('ended');
  });

  it('同时达成时以狼人全灭优先（好人胜）', () => {
    const g = new Game();
    g.state.players.forEach((p) => {
      if (p.role !== 'werewolf') p.alive = p.seat === 9;
    });
    g.state.players.filter((p) => p.role === 'werewolf').forEach((p) => (p.alive = false));
    expect(evaluateWinner(g.state)!.winner).toBe('good');
  });
});

function toFirstExileVoteNoSave(g: Game) {
  g.night(5, 1, { action: 'save' }); // 救下预言家
  g.act(1, { type: 'continue' });
  g.skipElection();
  g.finishSpeeches();
}

describe('完整对局模拟', () => {
  it('随机进行 200 局都能正常结束，且状态始终合法', () => {
    for (let seed = 1; seed <= 200; seed++) {
      let x = seed * 9301 + 49297;
      const rng = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
      const g = new Game({ idiotFlipSurvives: seed % 2 === 0 });
      g.rng = rng;
      g.state.players.forEach((p, i) => (p.role = shuffleRoles(rng)[i]));
      playRandom(g, rng);
      expect(g.state.status).toBe('ended');
      expect(g.state.winner).not.toBeNull();
      const dead = g.state.players.filter((p) => !p.alive);
      expect(dead.every((p) => p.deathCause && p.deathDay)).toBe(true);
    }
  });
});

function shuffleRoles(rng: () => number) {
  const a = STANDARD_12.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** 每一步由合法玩家随机做出合法操作，直到游戏结束 */
function playRandom(g: Game, rng: () => number) {
  for (let step = 0; step < 2000 && g.state.status === 'playing'; step++) {
    const s = g.state;
    const alive = s.players.filter((p) => p.alive);
    const aliveIds = alive.map((p) => p.id);
    const seatOf = (id: string) => s.players.find((p) => p.id === id)!.seat;
    switch (s.phase) {
      case 'night': {
        const n = s.night!;
        if (n.step === 'wolf_seer') {
          const wolf = alive.find((p) => p.role === 'werewolf' && !n.wolfVotes[p.id]?.locked);
          if (wolf) { g.act(wolf.seat, { type: 'wolf_pick', targetId: pick(aliveIds, rng), lock: true }); break; }
          const seer = alive.find((p) => p.role === 'seer');
          if (seer && !n.seerTargetId) { g.act(seer.seat, { type: 'seer_check', targetId: pick(aliveIds, rng) }); break; }
          g.wait(30_000);
        } else {
          const witch = alive.find((p) => p.role === 'witch');
          if (!witch) { g.wait(30_000); break; }
          const r = rng();
          if (r < 0.3 && s.witchPotions.antidote && n.killTargetId && n.killTargetId !== witch.id) g.act(witch.seat, { type: 'witch', action: 'save' });
          else if (r < 0.5 && s.witchPotions.poison) g.act(witch.seat, { type: 'witch', action: 'poison', targetId: pick(aliveIds, rng) });
          else g.act(witch.seat, { type: 'witch', action: 'none' });
        }
        break;
      }
      case 'dawn': g.act(1, { type: 'continue' }); break;
      case 'hunter': {
        const e = s.effects[0];
        const targets = aliveIds.filter((id) => id !== e.playerId);
        g.act(seatOf(e.playerId), { type: 'hunter_shoot', targetId: rng() < 0.8 ? pick(targets, rng) : null });
        break;
      }
      case 'badge': {
        const e = s.effects[0];
        const targets = aliveIds.filter((id) => id !== e.playerId);
        g.act(seatOf(e.playerId), { type: 'badge', targetId: rng() < 0.7 ? pick(targets, rng) : null });
        break;
      }
      case 'exile_confirm': g.act(seatOf(s.exiledPendingId!), { type: 'exile_confirm' }); break;
      case 'sheriff_signup': {
        const p = alive.find((x) => !(x.id in s.election!.signup))!;
        g.act(p.seat, { type: 'sheriff_signup', join: rng() < 0.3 });
        break;
      }
      case 'sheriff_speech': case 'day_speech': case 'exile_pk_speech': {
        const cur = s.speech!.order[s.speech!.index];
        const el = s.election;
        if (s.speech!.purpose === 'sheriff' && el && rng() < 0.1) {
          const c = el.candidates.find((id) => !el.withdrawn.includes(id));
          if (c) { g.act(seatOf(c), { type: 'sheriff_withdraw' }); break; }
        }
        g.act(seatOf(cur), { type: 'speech_done' });
        break;
      }
      case 'speech_order': g.act(seatOf(s.sheriffId!), { type: 'speech_order', direction: rng() < 0.5 ? 'cw' : 'ccw' }); break;
      case 'sheriff_suggest': g.act(seatOf(s.sheriffId!), { type: 'sheriff_suggest', targetId: rng() < 0.7 ? pick(aliveIds, rng) : null }); break;
      case 'sheriff_vote': case 'exile_vote': {
        const v = s.vote!;
        const voter = v.voters.find((id) => !(id in v.ballots))!;
        const targets = v.targets.filter((id) => !(v.kind === 'sheriff' && id === voter));
        g.act(seatOf(voter), { type: 'vote', targetId: rng() < 0.9 && targets.length ? pick(targets, rng) : null });
        break;
      }
      default: throw new Error('unexpected phase ' + s.phase);
    }
  }
}
