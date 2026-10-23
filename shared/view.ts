// 按玩家身份裁剪状态：服务端只把该玩家有权知道的信息发给客户端
import { getBoard, isConnected, witchKnowsKill, witchMaySelfSave } from './engine';
import { GameState, PlayerView, PrivateInfo, PublicPlayer } from './types';

export function buildView(state: GameState, viewerId: string | null, now: number): PlayerView {
  const ended = state.status === 'ended';
  const players: PublicPlayer[] = state.players.map((p) => ({
    id: p.id,
    seat: p.seat,
    nickname: p.nickname,
    ready: p.ready,
    alive: p.alive,
    connected: isConnected(p, now),
    isCreator: p.id === state.creatorId,
    isSheriff: p.id === state.sheriffId,
    idiotRevealed: p.role === 'idiot' && p.revealed,
    canVote: p.canVote,
    deathDay: p.deathDay,
    role: ended || p.revealed ? p.role : null,
    deathCause: ended ? p.deathCause : null,
  }));

  const el = state.election;
  const inVotePhase = state.phase === 'sheriff_vote' || state.phase === 'exile_vote';
  const showDawn = state.phase === 'dawn' || state.phase === 'hunter' || state.phase === 'badge'
    || state.phase === 'sheriff_signup' || state.phase === 'speech_order' || ended;

  return {
    code: state.code,
    board: getBoard(state),
    serverNow: now,
    status: state.status,
    phase: state.phase,
    phaseStartedAt: state.phaseStartedAt,
    day: state.day,
    settings: state.settings,
    players,
    sheriffId: state.sheriffId,
    sheriffSuggestion: state.sheriffSuggestion,
    dawnDeaths: showDawn ? state.dawnDeaths : null,
    election: el ? {
      decided: Object.keys(el.signup),
      // 报名阶段未结束前不公开谁上警，避免跟风
      candidates: state.phase === 'sheriff_signup' ? [] : el.candidates,
      withdrawn: el.withdrawn,
      round: el.round,
      mySignup: viewerId && viewerId in el.signup ? el.signup[viewerId] : undefined,
    } : null,
    speech: state.speech,
    speechDirection: state.speechDirection,
    vote: state.vote && inVotePhase ? {
      kind: state.vote.kind,
      round: state.vote.round,
      voters: state.vote.voters,
      targets: state.vote.targets,
      voted: Object.keys(state.vote.ballots),
    } : null,
    voteResults: state.voteResults,
    currentEffect: state.phase === 'hunter' || state.phase === 'badge' ? state.effects[0] ?? null : null,
    exiledPendingId: state.exiledPendingId,
    winner: state.winner,
    winReason: state.winReason,
    log: ended ? state.log : state.log.filter((l) => l.public),
    me: viewerId ? buildPrivate(state, viewerId) : null,
    fullReveal: ended ? { seerChecks: state.seerChecks } : null,
  };
}

function buildPrivate(state: GameState, viewerId: string): PrivateInfo | null {
  const me = state.players.find((p) => p.id === viewerId);
  if (!me) return null;
  const night = state.phase === 'night' ? state.night : null;
  const isWolf = me.role === 'werewolf';

  const info: PrivateInfo = {
    playerId: me.id,
    role: me.role,
    teammates: isWolf ? state.players.filter((p) => p.role === 'werewolf' && p.id !== me.id).map((p) => p.id) : [],
    wolfVotes: isWolf && night?.step === 'wolf_seer' ? night.wolfVotes : null,
    seerChecks: me.role === 'seer' ? state.seerChecks : [],
    seerCanAct: me.role === 'seer' && me.alive && night?.step === 'wolf_seer' && !night.seerTargetId,
    wolfCanAct: isWolf && me.alive && night?.step === 'wolf_seer' && !night.wolfVotes[me.id]?.locked,
    witch: null,
    myBallot: state.vote && viewerId in state.vote.ballots ? state.vote.ballots[viewerId] : undefined,
    canVote: !!state.vote && state.vote.voters.includes(viewerId) && !(viewerId in state.vote.ballots)
      && (state.phase === 'sheriff_vote' || state.phase === 'exile_vote'),
    hunterCanShoot: false,
    hunterDeathCause: null,
  };

  if (me.role === 'witch') {
    const witchTurn = !!night && night.step === 'witch' && me.alive;
    const knows = witchTurn && witchKnowsKill(state);
    info.witch = {
      antidote: state.witchPotions.antidote,
      poison: state.witchPotions.poison,
      canAct: witchTurn && !night!.witchDone,
      knownKillTargetId: knows ? night!.killTargetId : undefined,
      canSave: witchTurn && !night!.witchDone && state.witchPotions.antidote
        && !!night!.killTargetId && (night!.killTargetId !== me.id || witchMaySelfSave(state)),
      done: !!night?.witchDone && witchTurn,
    };
  }

  if (me.role === 'hunter') {
    info.hunterDeathCause = me.deathCause;
    info.hunterCanShoot = state.phase === 'hunter' && state.effects[0]?.type === 'hunter' && state.effects[0].playerId === me.id;
  }
  return info;
}
