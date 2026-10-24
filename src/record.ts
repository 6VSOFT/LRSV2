import type { NightRecord, PlayerView, VoteResult } from '../shared/types';
import { ROLE_INFO } from './lib';

const CAUSE: Record<string, string> = { wolf: '被狼刀', poison: '被毒杀', exile: '被放逐', hunter: '被猎人带走' };

/**
 * 生成可复制的纯文本游戏记录：游戏结束后包含全部身份与夜间记录，进行中只包含公开信息。
 * includeLog=false 时只输出结果摘要（结果页卡片用）。
 */
export function buildRecordText(view: PlayerView, { includeLog = true }: { includeLog?: boolean } = {}): string {
  const seat = (id: string | null | undefined) => {
    const p = view.players.find((x) => x.id === id);
    return p ? `${p.seat}号 ${p.nickname}` : '无';
  };
  const no = (id: string | null | undefined) => `${view.players.find((x) => x.id === id)?.seat ?? '?'}号`;
  const lines: string[] = [];
  lines.push('狼人杀自动法官 · 游戏记录');
  lines.push(`房间 ${view.code} · ${view.board.name}（${view.board.summary}）`);
  if (view.status === 'ended' && view.winReason) lines.push(`结果：${view.winReason}`);

  if (view.status === 'ended') {
    lines.push('', '【身份】');
    for (const p of view.players) {
      const role = p.role ? ROLE_INFO[p.role].name : '?';
      const fate = p.alive ? '存活' : `第${p.deathDay}天 ${CAUSE[p.deathCause ?? ''] ?? '出局'}`;
      lines.push(`${p.seat}号 ${p.nickname}：${role}${p.isSheriff ? ' · 警长' : ''} · ${fate}`);
    }
    const reveal = view.fullReveal;
    if (reveal?.seerChecks.length) {
      lines.push('', '【预言家查验】');
      for (const c of reveal.seerChecks) lines.push(`第 ${c.night} 夜：${seat(c.targetId)} — ${c.isWolf ? '狼人' : '好人'}`);
    }
    const records = reveal?.nightRecords ?? [];
    if (records.length) {
      if (view.board.roles.includes('witch')) {
        lines.push('', '【女巫用药】');
        for (const r of records) lines.push(`第 ${r.night} 夜：${witchLine(r, seat)}`);
      }
      if (view.board.roles.includes('hunter')) {
        lines.push('', '【猎人技能】');
        for (const r of records) lines.push(`第 ${r.night} 夜：${hunterLine(r, seat)}`);
      }
      lines.push('', '【狼人刀人】');
      for (const r of records) {
        const votes = r.wolfVotes.map((v) => `${no(v.wolfId)}→${no(v.targetId)}`).join('，');
        lines.push(`第 ${r.night} 夜：刀口 ${seat(r.killTargetId)}${votes ? `（${votes}）` : ''}`);
      }
    }
  }

  if (view.voteResults.length) {
    lines.push('', '【投票记录】');
    for (const r of view.voteResults) lines.push(voteLine(r, seat, no));
  }

  if (includeLog) {
    lines.push('', view.status === 'ended' ? '【完整日志】' : '【公开记录】');
    view.log.forEach((l, i) => lines.push(`${i + 1}. ${l.text}`));
  }
  return lines.join('\n');
}

function witchLine(r: NightRecord, seat: (id: string | null) => string) {
  if (!r.witch) return '女巫已出局';
  if (r.witch.type === 'save') return `使用解药救了 ${seat(r.witch.targetId)}`;
  if (r.witch.type === 'poison') return `使用毒药毒杀 ${seat(r.witch.targetId)}`;
  return '未使用药剂';
}

function hunterLine(r: NightRecord, seat: (id: string | null) => string) {
  if (!r.hunter) return '猎人已出局';
  return r.hunter.canShoot ? `${seat(r.hunter.hunterId)} 可以发动技能` : `${seat(r.hunter.hunterId)} 不能发动技能（被女巫毒杀）`;
}

function voteLine(r: VoteResult, seat: (id: string | null) => string, no: (id: string | null) => string) {
  const title = `第 ${r.day} 天 ${r.kind === 'sheriff' ? '警长投票' : '放逐投票'}${r.round === 2 ? '（重投）' : ''}`;
  const tally = r.tally.map((t) => {
    const from = r.ballots.filter((b) => b.targetId === t.targetId).map((b) => no(b.voterId) + (b.weight !== 1 ? `×${b.weight}` : ''));
    return `${seat(t.targetId)} ${t.votes} 票 ← ${from.join(' ')}`;
  });
  const abstain = r.ballots.filter((b) => !b.targetId).map((b) => no(b.voterId));
  return [title + '：', ...tally.map((t) => `  ${t}`), ...(abstain.length ? [`  弃票：${abstain.join(' ')}`] : [])].join('\n');
}

/** 复制到剪贴板；不支持 Clipboard API（如非 HTTPS 的局域网地址）时退回 execCommand */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 退回旧方法 */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
