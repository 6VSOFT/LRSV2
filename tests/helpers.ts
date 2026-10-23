import { Action, addPlayer, applyAction, createGame, Rng, tick } from '../shared/engine';
import { GameState, Role } from '../shared/types';

/** 默认座位身份：1-4 狼，5 预言家，6 女巫，7 猎人，8 白痴，9-12 村民 */
export const SEAT_ROLES: Role[] = [
  'werewolf', 'werewolf', 'werewolf', 'werewolf',
  'seer', 'witch', 'hunter', 'idiot',
  'villager', 'villager', 'villager', 'villager',
];

export const T0 = 1_000_000;

export class Game {
  state: GameState;
  now = T0;
  rng: Rng = () => 0;

  constructor(opts: { idiotFlipSurvives?: boolean } = {}) {
    this.state = createGame('TEST', { id: 'p1', nickname: '玩家1', tokenHash: 'h1' }, this.now);
    for (let i = 2; i <= 12; i++) addPlayer(this.state, { id: `p${i}`, nickname: `玩家${i}`, tokenHash: `h${i}` }, this.now);
    if (opts.idiotFlipSurvives) this.act(1, { type: 'settings', settings: { idiotFlipSurvives: true } });
    for (let i = 1; i <= 12; i++) this.act(i, { type: 'ready', ready: true });
    this.act(1, { type: 'start' });
    // 固定身份，便于测试
    this.state.players.forEach((p, i) => (p.role = SEAT_ROLES[i]));
  }

  id(seat: number) {
    return `p${seat}`;
  }

  p(seat: number) {
    return this.state.players.find((x) => x.seat === seat)!;
  }

  act(seat: number, action: Action) {
    this.now += 1000;
    applyAction(this.state, `p${seat}`, action, this.now, this.rng);
  }

  alive() {
    return this.state.players.filter((p) => p.alive).map((p) => p.seat);
  }

  /** 完成一整晚：狼人统一刀 kill；预言家查验 check；女巫行动 */
  night(kill: number, check: number, witch: { action: 'save' | 'poison' | 'none'; target?: number } = { action: 'none' }) {
    for (const w of this.state.players.filter((p) => p.alive && p.role === 'werewolf')) {
      this.act(w.seat, { type: 'wolf_pick', targetId: this.id(kill), lock: true });
    }
    const seer = this.state.players.find((p) => p.role === 'seer')!;
    if (seer.alive) this.act(seer.seat, { type: 'seer_check', targetId: this.id(check) });
    else this.wait(30_000);
    const witchP = this.state.players.find((p) => p.role === 'witch')!;
    if (witchP.alive) {
      this.act(witchP.seat, { type: 'witch', action: witch.action, targetId: witch.target ? this.id(witch.target) : null });
    } else {
      this.wait(30_000);
    }
  }

  wait(ms: number) {
    this.now += ms;
    tick(this.state, this.now, this.rng);
  }

  /** 让当前发言阶段所有人依次发言完毕 */
  finishSpeeches() {
    let guard = 0;
    while (this.state.speech && ['day_speech', 'sheriff_speech', 'exile_pk_speech'].includes(this.state.phase)) {
      const sp = this.state.speech;
      const cur = this.state.players.find((p) => p.id === sp.order[sp.index])!;
      this.act(cur.seat, { type: 'speech_done' });
      if (++guard > 50) throw new Error('speech loop');
    }
  }

  /** 所有有投票权的人按 map 投票（seat -> target seat 或 null），未列出者投给 fallback */
  voteAll(map: Record<number, number | null>, fallback: number | null = null) {
    const v = this.state.vote!;
    for (const voterId of v.voters.slice()) {
      const seat = this.state.players.find((p) => p.id === voterId)!.seat;
      const t = seat in map ? map[seat] : fallback;
      this.act(seat, { type: 'vote', targetId: t == null ? null : this.id(t) });
    }
  }

  /** 首日：所有人不上警 */
  skipElection() {
    for (const p of this.state.players.filter((x) => x.alive)) this.act(p.seat, { type: 'sheriff_signup', join: false });
  }
}
