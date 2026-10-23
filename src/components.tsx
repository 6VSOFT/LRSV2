import { ReactNode, useEffect, useState } from 'react';
import type { PlayerView, PublicPlayer, Role } from '../shared/types';
import { ROLE_INFO } from './lib';

export function RoleImage({ role, size = 120 }: { role: Role | 'back'; size?: number }) {
  const src = role === 'back' ? '/roles/card-back.svg' : `/roles/${role}.svg`;
  return <img className="role-img" src={src} width={size} height={Math.round(size * 1.3)} alt={role === 'back' ? '身份牌背面' : ROLE_INFO[role].name} />;
}

export function RoleCard({ role, extra }: { role: Role; extra?: ReactNode }) {
  const [shown, setShown] = useState(false);
  const info = ROLE_INFO[role];
  return (
    <div className="card role-card">
      <button className="role-flip" onClick={() => setShown((s) => !s)} aria-label={shown ? '隐藏身份' : '查看身份'}>
        <RoleImage role={shown ? role : 'back'} size={150} />
      </button>
      {shown ? (
        <div className="role-text">
          <div className="role-name" style={{ color: info.color }}>{info.name}</div>
          <div className="muted small">{info.team}</div>
          <p className="small">{info.desc}</p>
          {extra}
        </div>
      ) : (
        <div className="role-text">
          <div className="role-name">我的身份</div>
          <p className="muted small">点击卡牌查看，再次点击隐藏。请勿让他人看到屏幕。</p>
        </div>
      )}
    </div>
  );
}

export interface SeatBadge {
  text: string;
  tone?: 'red' | 'gold' | 'blue' | 'green' | 'gray';
}

export function SeatGrid(props: {
  view: PlayerView;
  selectable?: string[];
  selected?: string | null;
  onSelect?: (id: string) => void;
  highlight?: string[];
  badges?: Record<string, SeatBadge[]>;
}) {
  const { view, selectable, selected, onSelect, highlight = [], badges = {} } = props;
  const meId = view.me?.playerId;
  const size = view.board.size;
  const seats: (PublicPlayer | null)[] = Array.from({ length: size }, (_, i) => view.players.find((p) => p.seat === i + 1) ?? null);
  return (
    <div className={`seat-grid ${size % 4 === 0 ? '' : 'three'}`}>
      {seats.map((p, i) => {
        if (!p) return <div key={i} className="seat empty"><span className="seat-no">{i + 1}</span><span className="muted small">空位</span></div>;
        const can = !!selectable?.includes(p.id);
        const cls = ['seat', !p.alive && 'dead', can && 'selectable', selected === p.id && 'selected',
          highlight.includes(p.id) && 'highlight', p.id === meId && 'me'].filter(Boolean).join(' ');
        return (
          <button key={p.id} className={cls} disabled={!can} onClick={() => can && onSelect?.(p.id)}>
            <span className="seat-no">{p.seat}</span>
            <span className="seat-name">{p.nickname}</span>
            <span className="seat-tags">
              {p.isSheriff && <span className="tag gold">警长</span>}
              {p.id === meId && <span className="tag blue">我</span>}
              {!p.alive && <span className="tag gray">出局</span>}
              {p.role && view.status !== 'ended' && <span className="tag red">{ROLE_INFO[p.role].name}</span>}
              {!p.connected && <span className="tag gray">离线</span>}
              {(badges[p.id] ?? []).map((b, k) => <span key={k} className={`tag ${b.tone ?? 'blue'}`}>{b.text}</span>)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">{children}</div>
    </div>
  );
}

/** 关键操作二次确认 */
export function ConfirmButton(props: {
  label: string;
  confirmText: ReactNode;
  onConfirm: () => Promise<unknown> | void;
  disabled?: boolean;
  tone?: 'primary' | 'danger' | 'ghost';
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button className={`btn ${props.tone ?? 'primary'}`} disabled={props.disabled || busy} onClick={() => setOpen(true)}>
        {busy ? '提交中…' : props.label}
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <div className="modal-text">{props.confirmText}</div>
          <div className="row">
            <button className="btn ghost" onClick={() => setOpen(false)}>取消</button>
            <button
              className={`btn ${props.tone === 'danger' ? 'danger' : 'primary'}`}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setOpen(false);
                try {
                  await props.onConfirm();
                } finally {
                  setBusy(false);
                }
              }}
            >确认</button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function Countdown({ startedAt, seconds, offset }: { startedAt: number; seconds: number; offset: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((startedAt + seconds * 1000 - (now + offset)) / 1000));
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  return <span className={`countdown ${left === 0 ? 'over' : left <= 15 ? 'warn' : ''}`}>{left === 0 ? '时间到' : `${mm}:${ss}`}</span>;
}

export function Locked({ text = '已锁定' }: { text?: string }) {
  return <div className="locked">🔒 {text}</div>;
}
