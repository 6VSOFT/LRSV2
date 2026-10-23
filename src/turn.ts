import { useEffect, useRef } from 'react';
import type { PlayerView } from '../shared/types';

/**
 * 当前是否需要我在白天公开操作（发言、投票、竞选、猎人、警徽、遗言等）。
 * 夜间行动刻意不计入：线下聚会时手机震动会让旁人听出谁是夜间角色。
 */
export function needsMyPublicAction(view: PlayerView): boolean {
  const me = view.me;
  if (!me || view.status !== 'playing') return false;
  const id = me.playerId;
  const alive = !!view.players.find((p) => p.id === id)?.alive;
  switch (view.phase) {
    case 'hunter': return me.hunterCanShoot;
    case 'badge': return view.currentEffect?.playerId === id;
    case 'exile_confirm': return view.exiledPendingId === id;
    case 'sheriff_signup': return alive && view.election?.mySignup === undefined;
    case 'sheriff_speech':
    case 'day_speech':
    case 'exile_pk_speech': return view.speech?.order[view.speech.index] === id;
    case 'speech_order':
    case 'sheriff_suggest': return view.sheriffId === id;
    case 'sheriff_vote':
    case 'exile_vote': return me.canVote;
    default: return false;
  }
}

/** 轮到自己时震动并在标签页标题提示 */
export function useTurnAlert(view: PlayerView | null) {
  const prev = useRef(false);
  const mine = view ? needsMyPublicAction(view) : false;
  useEffect(() => {
    if (mine && !prev.current) {
      try {
        navigator.vibrate?.([180, 80, 180]);
      } catch {
        /* 部分浏览器不支持 */
      }
    }
    prev.current = mine;
    document.title = mine ? '● 轮到你了 · 狼人杀法官' : '狼人杀自动法官';
  }, [mine]);
  return mine;
}

/** 游戏进行中保持屏幕常亮，避免手机休眠导致掉线 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        if (document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen');
        if (cancelled) await lock?.release();
      } catch {
        /* 用户或系统拒绝时忽略 */
      }
    };
    request();
    const onVis = () => document.visibilityState === 'visible' && request();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      lock?.release().catch(() => undefined);
    };
  }, [active]);
}
