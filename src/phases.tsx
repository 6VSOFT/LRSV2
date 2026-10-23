import { useState } from 'react';
import type { Action } from '../shared/engine';
import type { PlayerView, VoteResult } from '../shared/types';
import { ConfirmButton, Countdown, Locked, RoleImage, SeatBadge, SeatGrid } from './components';
import { ROLE_INFO } from './lib';

export interface PanelProps {
  view: PlayerView;
  act: (a: Action) => Promise<unknown>;
  offset: number;
}

export function label(view: PlayerView, id: string | null | undefined) {
  const p = view.players.find((x) => x.id === id);
  return p ? `${p.seat}号 ${p.nickname}` : '无';
}

function aliveIds(view: PlayerView) {
  return view.players.filter((p) => p.alive).map((p) => p.id);
}

function meAlive(view: PlayerView) {
  return !!view.players.find((p) => p.id === view.me?.playerId)?.alive;
}

/** 选择目标 + 确认的通用组件 */
function TargetPicker(props: {
  view: PlayerView;
  candidates: string[];
  confirmLabel: string;
  confirmText: (id: string) => string;
  onConfirm: (id: string) => Promise<unknown>;
  badges?: Record<string, SeatBadge[]>;
  highlight?: string[];
  extra?: React.ReactNode;
  onSelect?: (id: string) => void;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const valid = sel && props.candidates.includes(sel) ? sel : null;
  return (
    <>
      <SeatGrid
        view={props.view}
        selectable={props.candidates}
        selected={valid}
        onSelect={(id) => { setSel(id); props.onSelect?.(id); }}
        badges={props.badges}
        highlight={props.highlight}
      />
      <div className="actions">
        <div className="muted small center">{valid ? `已选择：${label(props.view, valid)}` : '点击上方座位选择目标'}</div>
        <ConfirmButton
          label={props.confirmLabel}
          disabled={!valid}
          confirmText={valid ? props.confirmText(valid) : ''}
          onConfirm={() => props.onConfirm(valid!)}
        />
        {props.extra}
      </div>
    </>
  );
}

// ---------------- 夜晚 ----------------

export function NightPanel({ view, act }: PanelProps) {
  const me = view.me!;
  const alive = aliveIds(view);

  if (me.role === 'werewolf' && me.wolfVotes) {
    const badges: Record<string, SeatBadge[]> = {};
    for (const [wolfId, v] of Object.entries(me.wolfVotes)) {
      const seat = view.players.find((p) => p.id === wolfId)?.seat;
      (badges[v.targetId] ??= []).push({ text: `${seat}号${v.locked ? '🔒' : '?'}`, tone: 'red' });
    }
    const myVote = me.wolfVotes[me.playerId];
    return (
      <section className="card night">
        <h2>🐺 狼人请睁眼</h2>
        <p className="small">狼队友：{me.teammates.map((id) => label(view, id)).join('、') || '无'}。共同选择今晚的击杀目标（可以自刀）。票数最多者为刀口，平票随机。</p>
        {me.wolfCanAct ? (
          <TargetPicker
            view={view}
            candidates={alive}
            badges={badges}
            highlight={[me.playerId, ...me.teammates]}
            confirmLabel="锁定刀口"
            confirmText={(id) => `确认击杀 ${label(view, id)}？锁定后不能修改。`}
            onSelect={(id) => act({ type: 'wolf_pick', targetId: id, lock: false }).catch(() => undefined)}
            onConfirm={(id) => act({ type: 'wolf_pick', targetId: id, lock: true })}
          />
        ) : (
          <>
            <SeatGrid view={view} badges={badges} highlight={[me.playerId, ...me.teammates]} />
            <Locked text={myVote ? `你已锁定：${label(view, myVote.targetId)}，等待队友…` : '等待中…'} />
          </>
        )}
      </section>
    );
  }

  if (me.role === 'seer' && me.seerCanAct) {
    return (
      <section className="card night">
        <h2>🔮 预言家请睁眼</h2>
        <p className="small">选择一名存活玩家查验其阵营（可以查验自己）。</p>
        <TargetPicker
          view={view}
          candidates={alive}
          confirmLabel="查验"
          confirmText={(id) => `确认查验 ${label(view, id)}？每晚只能查验一次。`}
          onConfirm={(id) => act({ type: 'seer_check', targetId: id })}
        />
        <SeerHistory view={view} />
      </section>
    );
  }

  if (me.role === 'witch' && me.witch?.canAct) {
    return <WitchPanel view={view} act={act} offset={0} />;
  }

  const lastCheck = me.role === 'seer' ? me.seerChecks.find((c) => c.night === view.day) : null;
  return (
    <section className="card night center">
      <div className="moon">🌙</div>
      <h2>天黑请闭眼</h2>
      <p className="muted">第 {view.day} 夜进行中，系统正在等待夜间角色行动。</p>
      {lastCheck && (
        <div className={`result ${lastCheck.isWolf ? 'bad' : 'good'}`}>
          今晚查验：{label(view, lastCheck.targetId)} 是 <b>{lastCheck.isWolf ? '狼人' : '好人'}</b>
        </div>
      )}
      {me.role === 'seer' && <SeerHistory view={view} />}
      {me.role === 'witch' && me.witch && (
        <p className="small muted">{me.witch.done ? '今晚已行动（已锁定）。' : ''}解药 {me.witch.antidote ? '1' : '0'} · 毒药 {me.witch.poison ? '1' : '0'}</p>
      )}
      {!meAlive(view) && <p className="small muted">你已出局，请保持安静。</p>}
    </section>
  );
}

function SeerHistory({ view }: { view: PlayerView }) {
  const checks = view.me?.seerChecks ?? [];
  if (checks.length === 0) return null;
  return (
    <div className="history">
      <div className="small muted">查验记录</div>
      {checks.map((c) => (
        <div key={c.night} className="small">第 {c.night} 夜：{label(view, c.targetId)} — <b className={c.isWolf ? 'red' : 'green'}>{c.isWolf ? '狼人' : '好人'}</b></div>
      ))}
    </div>
  );
}

function WitchPanel({ view, act }: PanelProps) {
  const w = view.me!.witch!;
  const [mode, setMode] = useState<'menu' | 'poison'>('menu');
  const knows = w.knownKillTargetId !== undefined;
  return (
    <section className="card night">
      <h2>🧪 女巫请睁眼</h2>
      <p className="small">解药 {w.antidote ? '×1' : '已用'} · 毒药 {w.poison ? '×1' : '已用'} · 每晚最多使用一瓶</p>
      <div className="result neutral">
        {knows
          ? w.knownKillTargetId ? <>今晚被狼人击杀的是：<b>{label(view, w.knownKillTargetId)}</b></> : '今晚没有人被狼人击杀'
          : '你已使用过解药，无法得知今晚刀口'}
      </div>
      {knows && w.knownKillTargetId === view.me!.playerId && w.antidote && <p className="small red">女巫不能自救。</p>}
      {mode === 'menu' ? (
        <div className="actions">
          <ConfirmButton
            label="使用解药救人"
            disabled={!w.canSave}
            confirmText={`确认对 ${label(view, w.knownKillTargetId)} 使用解药？解药整局只能用一次，且今晚不能再用毒药。`}
            onConfirm={() => act({ type: 'witch', action: 'save' })}
          />
          <button className="btn danger" disabled={!w.poison} onClick={() => setMode('poison')}>使用毒药…</button>
          <ConfirmButton
            tone="ghost"
            label="今晚不使用药剂"
            confirmText="确认今晚不使用任何药剂？"
            onConfirm={() => act({ type: 'witch', action: 'none' })}
          />
        </div>
      ) : (
        <TargetPicker
          view={view}
          candidates={aliveIds(view)}
          confirmLabel="毒杀"
          confirmText={(id) => `确认毒杀 ${label(view, id)}？毒药整局只能用一次，且今晚不能再用解药。`}
          onConfirm={(id) => act({ type: 'witch', action: 'poison', targetId: id })}
          extra={<button className="btn ghost" onClick={() => setMode('menu')}>返回</button>}
        />
      )}
    </section>
  );
}

// ---------------- 天亮 / 技能 ----------------

export function DawnPanel({ view, act }: PanelProps) {
  const deaths = view.dawnDeaths ?? [];
  return (
    <section className="card center">
      <div className="moon">☀️</div>
      <h2>第 {view.day} 天 · 天亮了</h2>
      {deaths.length === 0 ? (
        <div className="result good">昨晚是平安夜</div>
      ) : (
        <div className="result bad">昨晚出局：{deaths.map((id) => label(view, id)).join('、')}</div>
      )}
      <p className="small muted">出局玩家可以线下发表遗言。确认所有人已知晓后，任意玩家点击继续。</p>
      <button className="btn primary" onClick={() => act({ type: 'continue' }).catch(() => undefined)}>继续</button>
    </section>
  );
}

export function HunterPanel({ view, act }: PanelProps) {
  const e = view.currentEffect;
  const mine = view.me?.hunterCanShoot;
  if (!mine) {
    return (
      <section className="card center">
        <h2>🔫 猎人发动技能</h2>
        <p>{label(view, e?.playerId)} 是猎人，正在决定是否开枪…</p>
      </section>
    );
  }
  return (
    <section className="card">
      <h2>🔫 你是猎人，可以开枪</h2>
      <p className="small">选择一名存活玩家带走，或选择不开枪。</p>
      <TargetPicker
        view={view}
        candidates={aliveIds(view)}
        confirmLabel="开枪"
        confirmText={(id) => `确认开枪带走 ${label(view, id)}？`}
        onConfirm={(id) => act({ type: 'hunter_shoot', targetId: id })}
        extra={<ConfirmButton tone="ghost" label="不开枪" confirmText="确认放弃开枪？" onConfirm={() => act({ type: 'hunter_shoot', targetId: null })} />}
      />
    </section>
  );
}

export function BadgePanel({ view, act }: PanelProps) {
  const e = view.currentEffect;
  if (e?.playerId !== view.me?.playerId) {
    return (
      <section className="card center">
        <h2>🎖️ 警徽移交</h2>
        <p>警长 {label(view, e?.playerId)} 已出局，正在决定移交或撕毁警徽…</p>
      </section>
    );
  }
  return (
    <section className="card">
      <h2>🎖️ 移交警徽</h2>
      <p className="small">你已出局。选择一名存活玩家继承警徽，或撕毁警徽（本局不再有警长）。</p>
      <TargetPicker
        view={view}
        candidates={aliveIds(view)}
        confirmLabel="移交警徽"
        confirmText={(id) => `确认将警徽移交给 ${label(view, id)}？`}
        onConfirm={(id) => act({ type: 'badge', targetId: id })}
        extra={<ConfirmButton tone="danger" label="撕毁警徽" confirmText="确认撕毁警徽？本局将不再有警长。" onConfirm={() => act({ type: 'badge', targetId: null })} />}
      />
    </section>
  );
}

export function IdiotPanel({ view, act }: PanelProps) {
  if (view.idiotPendingId !== view.me?.playerId) {
    return (
      <section className="card center">
        <h2>放逐结算中</h2>
        <p>{label(view, view.idiotPendingId)} 被放逐，等待其确认…</p>
      </section>
    );
  }
  return (
    <section className="card center">
      <RoleImage role="idiot" size={110} />
      <h2>你被放逐了</h2>
      <p className="small">你是白痴，可以选择翻牌公布身份。
        {view.settings.idiotFlipSurvives ? '翻牌后免于出局，但失去投票权。' : '按本局规则，翻牌后仍然出局。'}</p>
      <div className="actions">
        <ConfirmButton label="翻牌（公布白痴身份）" confirmText="确认翻牌公布你的白痴身份？" onConfirm={() => act({ type: 'idiot_flip', flip: true })} />
        <ConfirmButton tone="ghost" label="不翻牌，直接出局" confirmText="确认不翻牌并出局？" onConfirm={() => act({ type: 'idiot_flip', flip: false })} />
      </div>
    </section>
  );
}

// ---------------- 警长竞选 ----------------

export function SheriffSignupPanel({ view, act }: PanelProps) {
  const el = view.election!;
  const alive = aliveIds(view);
  const pending = alive.filter((id) => !el.decided.includes(id));
  return (
    <section className="card">
      <h2>🎖️ 警长竞选</h2>
      <p className="small">警长拥有归票时 1.5 票的放逐投票权，并决定白天发言顺序。是否上警？</p>
      {!meAlive(view) ? (
        <p className="muted">你已出局，不能参与竞选。</p>
      ) : el.mySignup === undefined ? (
        <div className="row">
          <ConfirmButton label="上警" confirmText="确认上警竞选警长？" onConfirm={() => act({ type: 'sheriff_signup', join: true })} />
          <ConfirmButton tone="ghost" label="不上警" confirmText="确认不上警？" onConfirm={() => act({ type: 'sheriff_signup', join: false })} />
        </div>
      ) : (
        <Locked text={`你已选择：${el.mySignup ? '上警' : '不上警'}`} />
      )}
      <p className="small muted">等待 {pending.length} 人选择：{pending.map((id) => view.players.find((p) => p.id === id)?.seat + '号').join(' ')}</p>
    </section>
  );
}

export function SpeechPanel({ view, act, offset }: PanelProps) {
  const sp = view.speech!;
  const current = sp.order[sp.index];
  const cur = view.players.find((p) => p.id === current);
  const isMe = current === view.me?.playerId;
  const el = view.election;
  const amCandidate = el && sp.purpose === 'sheriff' && el.candidates.includes(view.me?.playerId ?? '') && !el.withdrawn.includes(view.me!.playerId);
  const title = { sheriff: '警上发言', sheriff_pk: '警长竞选 PK 发言', day: '白天发言', exile_pk: '放逐 PK 发言' }[sp.purpose];
  const badges: Record<string, SeatBadge[]> = {};
  sp.order.forEach((id, i) => (badges[id] = [{ text: i < sp.index ? '已发言' : i === sp.index ? '发言中' : `#${i + 1}`, tone: i === sp.index ? 'gold' : 'gray' }]));
  el?.withdrawn.forEach((id) => (badges[id] = [{ text: '退水', tone: 'gray' }]));
  return (
    <section className="card">
      <h2>🗣️ {title}</h2>
      {view.speechDirection && <p className="small muted">警长选择{view.speechDirection === 'cw' ? '顺时针' : '逆时针'}发言</p>}
      <div className={`speaker ${isMe ? 'mine' : ''}`}>
        <div>
          <div className="small muted">当前发言</div>
          <div className="big">{label(view, current)}</div>
        </div>
        <Countdown startedAt={sp.startedAt} seconds={view.settings.speechSeconds} offset={offset} />
      </div>
      <SeatGrid view={view} highlight={[current]} badges={badges} />
      <div className="actions">
        {isMe && <button className="btn primary" onClick={() => act({ type: 'speech_done' }).catch(() => undefined)}>发言完毕</button>}
        {amCandidate && (
          <ConfirmButton tone="danger" label="退水（退出竞选）" confirmText="确认退水？退水后不能参与本次警长投票。" onConfirm={() => act({ type: 'sheriff_withdraw' })} />
        )}
        {cur && !cur.connected && !isMe && (
          <ConfirmButton tone="ghost" label="跳过（发言者已离线）" confirmText={`${label(view, current)} 已离线，确认跳过其发言？`} onConfirm={() => act({ type: 'speech_skip' })} />
        )}
      </div>
      <p className="small muted center">倒计时仅作提示，时间到不会自动淘汰。</p>
    </section>
  );
}

export function SpeechOrderPanel({ view, act }: PanelProps) {
  if (view.sheriffId !== view.me?.playerId) {
    return <section className="card center"><h2>等待警长</h2><p>警长 {label(view, view.sheriffId)} 正在选择发言顺序…</p></section>;
  }
  return (
    <section className="card center">
      <h2>🎖️ 选择发言顺序</h2>
      <p className="small">从你的下一位开始，你最后发言。</p>
      <div className="row">
        <button className="btn primary" onClick={() => act({ type: 'speech_order', direction: 'cw' }).catch(() => undefined)}>顺时针（号码递增）</button>
        <button className="btn primary" onClick={() => act({ type: 'speech_order', direction: 'ccw' }).catch(() => undefined)}>逆时针（号码递减）</button>
      </div>
    </section>
  );
}

export function SuggestPanel({ view, act }: PanelProps) {
  if (view.sheriffId !== view.me?.playerId) {
    return <section className="card center"><h2>警长归票</h2><p>警长 {label(view, view.sheriffId)} 正在决定是否归票…</p></section>;
  }
  return (
    <section className="card">
      <h2>🎖️ 警长归票</h2>
      <p className="small">归票：公开建议放逐对象，本轮你的票按 1.5 票计算；不归票则按 1 票计算。归票不强制他人。</p>
      <TargetPicker
        view={view}
        candidates={aliveIds(view)}
        confirmLabel="归票"
        confirmText={(id) => `确认归票 ${label(view, id)}？`}
        onConfirm={(id) => act({ type: 'sheriff_suggest', targetId: id })}
        extra={<ConfirmButton tone="ghost" label="不归票" confirmText="确认不归票？本轮你的票按 1 票计算。" onConfirm={() => act({ type: 'sheriff_suggest', targetId: null })} />}
      />
    </section>
  );
}

// ---------------- 投票 ----------------

export function VotePanel({ view, act }: PanelProps) {
  const v = view.vote!;
  const me = view.me!;
  const isSheriffVote = v.kind === 'sheriff';
  const waiting = v.voters.filter((id) => !v.voted.includes(id));
  const candidates = v.targets.filter((id) => !(isSheriffVote && id === me.playerId));
  const badges: Record<string, SeatBadge[]> = {};
  v.voted.forEach((id) => (badges[id] = [{ text: '已投', tone: 'green' }]));
  const title = isSheriffVote ? '警长投票' : '放逐投票';
  const weight = !isSheriffVote && view.sheriffId === me.playerId && view.sheriffSuggestion?.targetId ? 1.5 : 1;
  return (
    <section className="card">
      <h2>🗳️ {title}{v.round === 2 ? '（平票重投）' : ''}</h2>
      {!isSheriffVote && view.sheriffSuggestion?.targetId && <p className="small gold">警长归票：{label(view, view.sheriffSuggestion.targetId)}</p>}
      <p className="small muted">候选：{v.targets.map((id) => view.players.find((p) => p.id === id)?.seat + '号').join(' ')}。所有人投完后统一公布结果。</p>
      {me.canVote ? (
        <TargetPicker
          view={view}
          candidates={candidates}
          badges={badges}
          confirmLabel={`投票${weight === 1.5 ? '（1.5 票）' : ''}`}
          confirmText={(id) => `确认投票给 ${label(view, id)}？投出后不能修改。`}
          onConfirm={(id) => act({ type: 'vote', targetId: id })}
          extra={<ConfirmButton tone="ghost" label="弃票" confirmText="确认弃票？" onConfirm={() => act({ type: 'vote', targetId: null })} />}
        />
      ) : (
        <>
          <SeatGrid view={view} badges={badges} />
          <Locked text={me.myBallot !== undefined ? `你已投票：${me.myBallot ? label(view, me.myBallot) : '弃票'}` : '你本轮没有投票权'} />
        </>
      )}
      <p className="small muted">等待 {waiting.length} 人投票</p>
    </section>
  );
}

export function VoteResultCard({ view, result }: { view: PlayerView; result: VoteResult }) {
  const seat = (id: string | null) => (id ? view.players.find((p) => p.id === id)?.seat + '号' : '弃票');
  return (
    <div className="vote-result">
      <div className="small muted">
        第 {result.day} 天 {result.kind === 'sheriff' ? '警长投票' : '放逐投票'}{result.round === 2 ? '（重投）' : ''} ·{' '}
        {result.outcome === 'single' ? `${seat(result.topIds[0])} 得票最多` : result.outcome === 'tie' ? '平票' : '无有效票'}
      </div>
      {result.tally.map((t) => (
        <div key={t.targetId} className="tally-row">
          <span>{label(view, t.targetId)}</span>
          <b>{t.votes} 票</b>
          <span className="small muted">← {result.ballots.filter((b) => b.targetId === t.targetId).map((b) => seat(b.voterId) + (b.weight !== 1 ? `(${b.weight})` : '')).join(' ')}</span>
        </div>
      ))}
      {result.ballots.some((b) => !b.targetId) && (
        <div className="small muted">弃票：{result.ballots.filter((b) => !b.targetId).map((b) => seat(b.voterId)).join(' ')}</div>
      )}
    </div>
  );
}

// ---------------- 结束 ----------------

export function EndPanel({ view }: { view: PlayerView }) {
  const wolfWin = view.winner === 'wolf';
  return (
    <section className="card">
      <div className={`winner ${wolfWin ? 'wolf' : 'good'}`}>
        <div className="big">{wolfWin ? '🐺 狼人阵营胜利' : '🌟 好人阵营胜利'}</div>
        <div className="small">{view.winReason}</div>
      </div>
      <h3>身份公开</h3>
      <div className="reveal-grid">
        {view.players.map((p) => (
          <div key={p.id} className={`reveal ${p.alive ? '' : 'dead'}`}>
            {p.role && <RoleImage role={p.role} size={64} />}
            <div className="small"><b>{p.seat}号</b> {p.nickname}</div>
            <div className="small" style={{ color: p.role ? ROLE_INFO[p.role].color : undefined }}>{p.role ? ROLE_INFO[p.role].name : ''}{p.isSheriff ? ' · 警长' : ''}</div>
            <div className="tiny muted">{p.alive ? '存活' : `第${p.deathDay}天 ${causeLabel(p.deathCause)}`}</div>
          </div>
        ))}
      </div>
      {view.fullReveal && view.fullReveal.seerChecks.length > 0 && (
        <>
          <h3>预言家查验</h3>
          {view.fullReveal.seerChecks.map((c) => (
            <div key={c.night} className="small">第 {c.night} 夜：{label(view, c.targetId)} — {c.isWolf ? '狼人' : '好人'}</div>
          ))}
        </>
      )}
      {view.voteResults.length > 0 && (
        <>
          <h3>投票记录</h3>
          {view.voteResults.map((r, i) => <VoteResultCard key={i} view={view} result={r} />)}
        </>
      )}
    </section>
  );
}

function causeLabel(c: string | null) {
  return { wolf: '被狼刀', poison: '被毒杀', exile: '被放逐', hunter: '被枪杀' }[c ?? ''] ?? '出局';
}
