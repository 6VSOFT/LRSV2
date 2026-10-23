import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { Action } from '../shared/engine';
import type { PlayerView } from '../shared/types';
import { ConfirmButton, RoleCard, RoleImage, SeatGrid } from './components';
import { api, ApiError, clearSession, loadSession, PHASE_TITLE, rememberNickname, saveSession, Session } from './lib';
import {
  BadgePanel, DawnPanel, EndPanel, HunterPanel, IdiotPanel, label, NightPanel, SheriffSignupPanel,
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

  const create = async () => {
    setErr('');
    setBusy(true);
    try {
      rememberNickname(nickname.trim());
      const s = await api.create(nickname);
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
        <p className="muted">12 人预女猎白 · 无需真人法官 · 无需身份牌</p>
      </header>
      <section className="card">
        <label className="field">
          <span>你的昵称</span>
          <input value={nickname} maxLength={12} placeholder="最多 12 个字" onChange={(e) => setNickname(e.target.value)} />
        </label>
        <button className="btn primary" disabled={busy || !nickname.trim()} onClick={create}>创建房间</button>
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
      <section className="roles-strip">
        {(['werewolf', 'seer', 'witch', 'hunter', 'idiot', 'villager'] as const).map((r) => <RoleImage key={r} role={r} size={52} />)}
      </section>
      <p className="tiny muted center">4 狼人 · 预言家 · 女巫 · 猎人 · 白痴 · 4 村民 ｜ 屠边规则</p>
    </main>
  );
}

// ---------------- 房间 ----------------

function JoinForm({ code, view, onJoined }: { code: string; view: PlayerView | null; onJoined: (s: Session) => void }) {
  const [nickname, setNickname] = useState(rememberNickname());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const full = (view?.players.length ?? 0) >= 12;
  const started = view && view.status !== 'lobby';
  return (
    <main className="page">
      <header className="topbar"><button className="link" onClick={() => go('/')}>‹ 首页</button><span>房间 {code}</span><span /></header>
      <section className="card">
        <h2>加入房间 {code}</h2>
        {started ? <p className="error">游戏已经开始，无法加入。若你是房间玩家，请使用原设备打开。</p>
          : full ? <p className="error">房间已满（12 人）。</p> : (
            <>
              <p className="muted small">当前 {view?.players.length ?? 0}/12 人</p>
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
          <div className="tiny muted">房间 {view.code}{view.status !== 'lobby' && ` · 第 ${view.day} ${view.phase === 'night' ? '夜' : '天'} · 存活 ${aliveCount}/12`}</div>
        </div>
        <div className="me-chip">{me ? `${me.seat}号` : ''}{me && !me.alive ? '·出局' : ''}</div>
      </header>
      {offline && <div className="banner warn">网络连接中断，正在重连…</div>}
      {error && <div className="banner error" onClick={() => setError('')}>{error}（点击关闭）</div>}

      {view.status === 'lobby' ? (
        <Lobby view={view} act={act} code={code} />
      ) : (
        <>
          {view.me?.role && view.status === 'playing' && <RoleCard role={view.me.role} />}
          {view.me?.role === 'werewolf' && view.status === 'playing' && (
            <div className="card slim small">🐺 狼队友：{view.me.teammates.map((id) => label(view, id)).join('、')}</div>
          )}
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
            <div className="actions"><button className="btn primary" onClick={() => go('/')}>返回首页，开新房间</button></div>
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
    case 'idiot': return <IdiotPanel {...props} />;
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
      <button className="link block" onClick={() => setOpen((o) => !o)}>
        {view.status === 'ended' ? '完整游戏记录' : '公开记录'} {open ? '▲' : '▼'}
      </button>
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
  const canStart = view.players.length === 12 && readyCount === 12;
  const freeSeats = Array.from({ length: 12 }, (_, i) => i + 1).filter((s) => !view.players.some((p) => p.seat === s));

  return (
    <>
      <section className="card center">
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
        <h3>玩家 {view.players.length}/12 · 已准备 {readyCount}/12</h3>
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
              label={canStart ? '开始游戏' : `开始游戏（需 12 人全部准备）`}
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
          <li>4 狼人 · 预言家 · 女巫 · 猎人 · 白痴 · 4 村民，屠边胜负。</li>
          <li>女巫不可自救，同一晚不能双药；用过解药后不再得知刀口。</li>
          <li>猎人被狼刀或被放逐可开枪，被毒杀不能开枪。</li>
          <li>首日竞选警长；警长归票时 1.5 票。</li>
          <li>
            白痴被放逐翻牌：{view.settings.idiotFlipSurvives ? '翻牌免死，但失去投票权（经典规则）' : '翻牌公布身份后仍然出局（本项目默认）'}
            {isCreator && (
              <button className="chip" onClick={() => act({ type: 'settings', settings: { idiotFlipSurvives: !view.settings.idiotFlipSurvives } }).catch(() => undefined)}>切换</button>
            )}
          </li>
          <li>
            发言倒计时 {view.settings.speechSeconds} 秒（仅提示）
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
