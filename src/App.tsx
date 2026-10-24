import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { SHERIFF_BONUS_SECONDS, type Action } from '../shared/engine';
import { type Board, type BoardId, BOARDS, DEFAULT_BOARD, type PlayerView } from '../shared/types';
import { ConfirmButton, CopyButton, RoleCard, RoleImage, SeatGrid } from './components';
import { useTurnAlert, useWakeLock } from './turn';
import { buildRecordText } from './record';
import { api, ApiError, clearSession, loadSession, PHASE_TITLE, rememberNickname, saveSession, Session } from './lib';
import {
  BadgePanel, DawnPanel, EndPanel, ExilePanel, HunterPanel, NightPanel, PrivateNotes, SheriffSignupPanel,
  SpeechOrderPanel, SpeechPanel, SuggestPanel, VotePanel, VoteResultCard,
} from './phases';

function roomCodeFromPath(): string | null {
  const m = location.pathname.match(/^\/r\/([A-Za-z0-9]{4,8})\/?$/);
  return m ? m[1].toUpperCase() : null;
}

function go(path: string) {
  const q = new URLSearchParams(location.search).get('p');
  history.pushState(null, '', path + (q ? `?p=${encodeURIComponent(q)}` : ''));
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export default function App() {
  const [code, setCode] = useState(roomCodeFromPath());
  useEffect(() => {
    const on = () => setCode(roomCodeFromPath());
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return code ? <RoomPage key={code} code={code} /> : <Home />;
}

// ---------------- 首页 ----------------

function Home() {
  const [nickname, setNickname] = useState(rememberNickname());
  const [joinCode, setJoinCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [board, setBoard] = useState<BoardId>(DEFAULT_BOARD);

  const create = async () => {
    setErr('');
    setBusy(true);
    try {
      rememberNickname(nickname.trim());
      const s = await api.create(nickname, board);
      saveSession(s);
      go(`/r/${s.code}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '创建失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page home">
      <header className="hero">
        <img src="/roles/icon.svg" width={88} height={88} alt="" className="hero-icon" />
        <h1>狼人杀自动法官</h1>
        <p className="muted">预女猎白 12 人 · 预女猎 9 人 · 无需真人法官 · 无需身份牌</p>
      </header>
      <section className="card">
        <label className="field">
          <span>你的昵称</span>
          <input value={nickname} maxLength={12} placeholder="最多 12 个字" onChange={(e) => setNickname(e.target.value)} />
        </label>
        <button className="btn primary" disabled={busy || !nickname.trim()} onClick={create}>创建房间 · {BOARDS[board].name}</button>
      </section>
      <section className="card">
        <label className="field">
          <span>房间代码</span>
          <input value={joinCode} maxLength={8} placeholder="例如 K7M2QX" autoCapitalize="characters"
            onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
        </label>
        <button className="btn" disabled={joinCode.length < 4} onClick={() => go(`/r/${joinCode}`)}>加入房间</button>
      </section>
      {err && <div className="error">{err}</div>}
      <div className="small muted board-title">选择板子（创建房间时使用）</div>
      <div className="board-list" role="radiogroup" aria-label="选择板子">
        {(['std12', 'pnl9'] as const).map((id) => <BoardOption key={id} board={BOARDS[id]} selected={board === id} onSelect={() => setBoard(id)} />)}
      </div>
      {Array.from({ length: 5 }, (_, i) => (
        <section key={i} className="card coming-soon" aria-disabled="true">
          <span className="coming-icon">🔒</span>
          <span>新板子即将上线</span>
        </section>
      ))}
    </main>
  );
}

function BoardOption({ board, selected, onSelect }: { board: Board; selected: boolean; onSelect: () => void }) {
  const roleTypes = [...new Set(board.roles)];
  return (
    <button className={`card board-option ${selected ? 'on' : ''}`} role="radio" aria-checked={selected} onClick={onSelect}>
      <div className="board-head">
        <span className="board-name">{board.name}</span>
        <span className={`board-check ${selected ? 'on' : ''}`}>{selected ? '✓ 已选择' : '选择'}</span>
      </div>
      <div className="roles-strip">
        {roleTypes.map((r) => <RoleImage key={r} role={r} size={42} />)}
      </div>
      <div className="tiny muted">{board.summary} ｜ 屠边规则</div>
      <div className="tiny gold">{board.witchSelfSaveFirstNight ? '女巫仅首晚可以自救' : '女巫全程不可自救'}</div>
    </button>
  );
}

// ---------------- 房间 ----------------

function JoinForm({ code, view, onJoined }: { code: string; view: PlayerView | null; onJoined: (s: Session) => void }) {
  const [nickname, setNickname] = useState(rememberNickname());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const size = view?.board.size ?? 12;
  const full = (view?.players.length ?? 0) >= size;
  const started = view && view.status !== 'lobby';
  return (
    <main className="page">
      <header className="topbar"><button className="link" onClick={() => go('/')}>‹ 首页</button><span>房间 {code}</span><span /></header>
      <section className="card">
        <h2>加入房间 {code}</h2>
        {view && <p className="small gold">{view.board.name}：{view.board.summary}</p>}
        {started ? <p className="error">游戏已经开始，无法加入。若你是房间玩家，请使用原设备打开。</p>
          : full ? <p className="error">房间已满（{size} 人）。</p> : (
            <>
              <p className="muted small">当前 {view?.players.length ?? 0}/{size} 人</p>
              <label className="field">
                <span>你的昵称</span>
                <input value={nickname} maxLength={12} onChange={(e) => setNickname(e.target.value)} />
              </label>
              <button className="btn primary" disabled={busy || !nickname.trim()} onClick={async () => {
                setBusy(true);
                setErr('');
                try {
                  rememberNickname(nickname.trim());
                  const s = await api.join(code, nickname);
                  saveSession(s);
                  onJoined(s);
                } catch (e) {
                  setErr(e instanceof Error ? e.message : '加入失败');
                } finally {
                  setBusy(false);
                }
              }}>加入</button>
            </>
          )}
        {err && <div className="error">{err}</div>}
      </section>
      {view && <SeatGrid view={view} />}
    </main>
  );
}

function useRoom(code: string) {
  const [session, setSession] = useState<Session | null>(() => loadSession(code));
  const [view, setView] = useState<PlayerView | null>(null);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [offset, setOffset] = useState(0);
  const seq = useRef(0);

  const accept = useCallback((v: PlayerView, n: number) => {
    if (n < seq.current) return; // 丢弃过期响应
    seq.current = n;
    setOffset(v.serverNow - Date.now());
    setView(v);
    setOffline(false);
  }, []);

  const refresh = useCallback(async () => {
    const n = ++seq.current;
    try {
      const v = await api.state(code, session?.token);
      accept(v, n);
      // 令牌失效（例如已离开房间）
      if (session && !v.me) {
        clearSession(code);
        setSession(null);
      }
    } catch (e) {
      if (e instanceof ApiError && e.message === '房间不存在') setError('房间不存在');
      else setOffline(true);
    }
  }, [code, session, accept]);

  useEffect(() => {
    refresh();
    let timer: number;
    const loop = () => {
      timer = window.setTimeout(async () => {
        if (document.visibilityState === 'visible') await refresh();
        loop();
      }, 1500);
    };
    loop();
    const onVis = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refresh]);

  const act = useCallback(async (a: Action) => {
    if (!session) return;
    const n = ++seq.current;
    try {
      accept(await api.action(session, a), n);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
      refresh();
      throw e;
    }
  }, [session, accept, refresh]);

  return { session, setSession, view, error, setError, offline, offset, act };
}

function RoomPage({ code }: { code: string }) {
  const { session, setSession, view, error, setError, offline, offset, act } = useRoom(code);
  const myTurn = useTurnAlert(view);
  useWakeLock(view?.status === 'playing');

  if (error === '房间不存在') {
    return (
      <main className="page">
        <section className="card center"><h2>房间 {code} 不存在</h2><button className="btn primary" onClick={() => go('/')}>返回首页</button></section>
      </main>
    );
  }
  if (!session || (view && !view.me)) return <JoinForm code={code} view={view} onJoined={setSession} />;
  if (!view) return <main className="page center"><div className="spinner" /><p className="muted">连接中…</p></main>;

  const me = view.players.find((p) => p.id === view.me?.playerId);
  const aliveCount = view.players.filter((p) => p.alive).length;
  return (
    <main className="page">
      <header className="topbar">
        <button className="link" onClick={() => go('/')}>‹</button>
        <div className="center">
          <div className="phase-title">{PHASE_TITLE[view.phase]}</div>
          <div className="tiny muted">房间 {view.code}{view.status !== 'lobby' && ` · 第 ${view.day} ${view.phase === 'night' ? '夜' : '天'} · 存活 ${aliveCount}/${view.board.size}`}</div>
        </div>
        <div className="me-chip">{me ? `${me.seat}号` : ''}{me && !me.alive ? '·出局' : ''}</div>
      </header>
      {offline && <div className="banner warn">网络连接中断，正在重连…</div>}
      {myTurn && <div className="banner turn">👉 轮到你操作了</div>}
      {error && <div className="banner error" onClick={() => setError('')}>{error}（点击关闭）</div>}

      {view.status === 'lobby' ? (
        <Lobby view={view} act={act} code={code} />
      ) : (
        <>
          {view.me?.role && view.status === 'playing' && (
            <RoleCard
              role={view.me.role}
              extra={view.me.role === 'werewolf' && (
                <div className="teammates">
                  🐺 狼队友：{view.me.teammates.length
                    ? view.me.teammates.map((id) => {
                      const p = view.players.find((x) => x.id === id)!;
                      return <span key={id} className={`tag red ${p.alive ? '' : 'gone'}`}>{p.seat}号{p.alive ? '' : '·出局'}</span>;
                    })
                    : '无'}
                </div>
              )}
            />
          )}
          {view.status === 'playing' && <PrivateNotes view={view} />}
          <PhasePanel view={view} act={act} offset={offset} />
          {view.status === 'playing' && view.phase !== 'night' && !['sheriff_vote', 'exile_vote'].includes(view.phase) && view.voteResults.length > 0
            && view.voteResults.at(-1)!.day === view.day && (
            <section className="card"><h3>最近投票结果</h3><VoteResultCard view={view} result={view.voteResults.at(-1)!} /></section>
          )}
          {view.status === 'playing' && !['day_speech', 'sheriff_speech', 'exile_pk_speech', 'sheriff_vote', 'exile_vote', 'hunter', 'badge', 'sheriff_suggest'].includes(view.phase) && view.phase !== 'night' && (
            <section className="card"><h3>玩家状态</h3><SeatGrid view={view} /></section>
          )}
          <GameLog view={view} />
          {view.status === 'ended' && (
            <div className="actions">
              {me?.isCreator ? (
                <ConfirmButton
                  label="再来一局（同一房间）"
                  confirmText="确认开始新一局？所有玩家回到等待室并重新准备，本局结果将被清空。"
                  onConfirm={() => act({ type: 'restart' })}
                />
              ) : (
                <p className="small muted center">房主可以在同一房间开始新一局，你无需重新加入。</p>
              )}
              <button className="btn ghost" onClick={() => go('/')}>返回首页</button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

function PhasePanel(props: { view: PlayerView; act: (a: Action) => Promise<unknown>; offset: number }) {
  switch (props.view.phase) {
    case 'night': return <NightPanel {...props} />;
    case 'dawn': return <DawnPanel {...props} />;
    case 'hunter': return <HunterPanel {...props} />;
    case 'badge': return <BadgePanel {...props} />;
    case 'exile_confirm': return <ExilePanel {...props} />;
    case 'sheriff_signup': return <SheriffSignupPanel {...props} />;
    case 'sheriff_speech':
    case 'day_speech':
    case 'exile_pk_speech': return <SpeechPanel {...props} />;
    case 'speech_order': return <SpeechOrderPanel {...props} />;
    case 'sheriff_suggest': return <SuggestPanel {...props} />;
    case 'sheriff_vote':
    case 'exile_vote': return <VotePanel {...props} />;
    case 'ended': return <EndPanel view={props.view} />;
    default: return null;
  }
}

function GameLog({ view }: { view: PlayerView }) {
  const [open, setOpen] = useState(view.status === 'ended');
  const entries = view.log.slice().reverse();
  return (
    <section className="card">
      <div className="log-head">
        <button className="link block" onClick={() => setOpen((o) => !o)}>
          {view.status === 'ended' ? '完整游戏记录' : '公开记录'} {open ? '▲' : '▼'}
        </button>
        <CopyButton getText={() => buildRecordText(view)} ariaLabel="复制游戏记录到剪贴板" />
      </div>
      {!open && entries[0] && <div className="small muted">{entries[0].text}</div>}
      {open && (
        <ol className="log">
          {entries.map((l, i) => <li key={i} className={l.public ? '' : 'private'}>{l.text}</li>)}
        </ol>
      )}
    </section>
  );
}

// ---------------- 等待室 ----------------

function Lobby({ view, act, code }: { view: PlayerView; act: (a: Action) => Promise<unknown>; code: string }) {
  const me = view.players.find((p) => p.id === view.me?.playerId)!;
  const isCreator = me?.isCreator;
  const url = `${location.origin}/r/${code}`;
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: '#0b0d18', light: '#ffffff' } }).then(setQr).catch(() => setQr(''));
  }, [url]);
  const readyCount = view.players.filter((p) => p.ready).length;
  const size = view.board.size;
  const hasIdiot = view.board.roles.includes('idiot');
  const canStart = view.players.length === size && readyCount === size;
  const freeSeats = Array.from({ length: size }, (_, i) => i + 1).filter((s) => !view.players.some((p) => p.seat === s));

  return (
    <>
      <section className="card center">
        <div className="board-badge">{view.board.name}</div>
        <div className="small muted">房间代码</div>
        <div className="room-code">{code}</div>
        {qr && <img className="qr" src={qr} alt="加入房间二维码" width={180} height={180} />}
        <div className="row">
          <button className="btn ghost" onClick={async () => {
            try {
              if (navigator.share) await navigator.share({ title: '狼人杀房间', text: `加入狼人杀房间 ${code}`, url });
              else { await navigator.clipboard.writeText(url); setCopied(true); }
            } catch { /* 用户取消分享 */ }
          }}>{copied ? '已复制链接' : '分享 / 复制链接'}</button>
        </div>
      </section>
      <section className="card">
        <h3>玩家 {view.players.length}/{size} · 已准备 {readyCount}/{size}</h3>
        <SeatGrid
          view={view}
          badges={Object.fromEntries(view.players.map((p) => [p.id, [p.ready ? { text: '已准备', tone: 'green' as const } : { text: '未准备', tone: 'gray' as const }, ...(p.isCreator ? [{ text: '房主', tone: 'gold' as const }] : [])]]))}
        />
        {freeSeats.length > 0 && (
          <div className="seat-switch small">
            换到空座位：{freeSeats.map((s) => <button key={s} className="chip" onClick={() => act({ type: 'seat', seat: s }).catch(() => undefined)}>{s}号</button>)}
          </div>
        )}
        <div className="actions">
          <button className={`btn ${me.ready ? 'ghost' : 'primary'}`} onClick={() => act({ type: 'ready', ready: !me.ready }).catch(() => undefined)}>
            {me.ready ? '取消准备' : '准备'}
          </button>
          {isCreator && (
            <ConfirmButton
              label={canStart ? '开始游戏' : `开始游戏（需 ${size} 人全部准备）`}
              disabled={!canStart}
              confirmText="确认开始游戏？系统将随机发放身份并进入第一夜。"
              onConfirm={() => act({ type: 'start' })}
            />
          )}
          <ConfirmButton tone="ghost" label="离开房间" confirmText="确认离开房间？" onConfirm={async () => {
            await act({ type: 'leave' });
            clearSession(code);
            go('/');
          }} />
        </div>
      </section>
      <section className="card small">
        <h3>本局规则</h3>
        <ul className="rules">
          <li>{view.board.name}：{view.board.summary}，屠边胜负。</li>
          <li>女巫{view.board.witchSelfSaveFirstNight ? '仅首晚可以自救' : '不可自救'}，同一晚不能双药；用过解药后不再得知刀口。</li>
          <li>猎人被狼刀或被放逐可开枪，被毒杀不能开枪。</li>
          <li>首日竞选警长；警长归票时 1.5 票。</li>
          {hasIdiot && <li>
            白痴被放逐时自动翻牌：{view.settings.idiotFlipSurvives ? '翻牌免死，但失去投票权（经典规则）' : '公布身份后仍然出局（本项目默认）'}
            {isCreator && (
              <button className="chip" onClick={() => act({ type: 'settings', settings: { idiotFlipSurvives: !view.settings.idiotFlipSurvives } }).catch(() => undefined)}>切换</button>
            )}
          </li>}
          <li>
            发言倒计时 {view.settings.speechSeconds} 秒，警长 {view.settings.speechSeconds + SHERIFF_BONUS_SECONDS} 秒（仅提示）
            {isCreator && [60, 90, 120, 180].map((s) => (
              <button key={s} className={`chip ${view.settings.speechSeconds === s ? 'on' : ''}`} onClick={() => act({ type: 'settings', settings: { speechSeconds: s } }).catch(() => undefined)}>{s}s</button>
            ))}
          </li>
        </ul>
        {isCreator && <p className="tiny muted">修改设置会重置所有人的准备状态。房主只能开始游戏，不能查看身份或操控结果。</p>}
      </section>
    </>
  );
}
