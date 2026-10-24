// 测试工具：向房间加入 N 个机器人玩家，并按各自视图随机执行合法操作。
// 用法：node scripts/bots.mjs <房间代码> [机器人数量=填满剩余座位] [服务器地址=http://localhost:5180]
// 机器人只能通过公开 API 拿到自己的视图，与真实手机玩家完全一样。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const [code, countArg, baseArg] = process.argv.slice(2);
if (!code) {
  console.error('用法：node scripts/bots.mjs <房间代码> [数量] [地址]');
  process.exit(1);
}
const BASE = baseArg ?? 'http://localhost:5180';
const DELAY = Number(process.env.BOT_DELAY ?? 700);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];

async function post(route, body) {
  const res = await fetch(`${BASE}/api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

// 机器人令牌保存在 .bots/<房间代码>.json，脚本重启后可以接管同一批机器人（不会重复占座）
const SAVE_DIR = new URL('../.bots/', import.meta.url);
const SAVE_FILE = new URL(`${code.toUpperCase()}.json`, SAVE_DIR);
mkdirSync(SAVE_DIR, { recursive: true });

const room = await post('state', { code });
let bots = [];
if (existsSync(SAVE_FILE)) {
  const saved = JSON.parse(readFileSync(SAVE_FILE, 'utf8'));
  bots = saved.filter((b) => room.players.some((p) => p.id === b.playerId));
  if (bots.length) console.log(`接管已有的 ${bots.length} 个机器人`);
}
const COUNT = countArg && countArg !== 'auto' ? Number(countArg) - bots.length : room.board.size - room.players.length;
console.log(`${room.board.name}，当前 ${room.players.length}/${room.board.size} 人`);
for (let i = 0; i < COUNT; i++) {
  try {
    bots.push(await post('join', { code, nickname: `机器人${bots.length + 1}` }));
  } catch (e) {
    console.log('加入失败：', e.message);
    break;
  }
}
writeFileSync(SAVE_FILE, JSON.stringify(bots, null, 2));
console.log(`共 ${bots.length} 个机器人`);

function decide(v, me) {
  const alive = v.players.filter((p) => p.alive).map((p) => p.id);
  const self = v.players.find((p) => p.id === me.playerId);
  const others = alive.filter((id) => id !== me.playerId);
  switch (v.phase) {
    case 'lobby': return self.ready ? null : { type: 'ready', ready: true };
    case 'night':
      if (me.wolfCanAct) return { type: 'wolf_pick', targetId: pick(alive), lock: true };
      if (me.seerCanAct) return { type: 'seer_check', targetId: pick(alive) };
      if (me.hunterNight?.canAck) return { type: 'hunter_ack' };
      if (me.witch?.canAct) {
        const r = Math.random();
        if (r < 0.3 && me.witch.canSave) return { type: 'witch', action: 'save' };
        if (r < 0.45 && me.witch.poison) return { type: 'witch', action: 'poison', targetId: pick(alive) };
        return { type: 'witch', action: 'none' };
      }
      return null;
    case 'dawn': return { type: 'continue' };
    case 'hunter': return me.hunterCanShoot ? { type: 'hunter_shoot', targetId: pick(others) } : null;
    case 'badge': return v.currentEffect?.playerId === me.playerId ? { type: 'badge', targetId: pick(others) } : null;
    case 'exile_confirm': return v.exiledPendingId === me.playerId ? { type: 'exile_confirm' } : null;
    case 'ended': return null;
    case 'sheriff_signup': return self.alive && v.election.mySignup === undefined ? { type: 'sheriff_signup', join: Math.random() < 0.3 } : null;
    case 'sheriff_speech': case 'day_speech': case 'exile_pk_speech':
      return v.speech.order[v.speech.index] === me.playerId ? { type: 'speech_done' } : null;
    case 'speech_order': return v.sheriffId === me.playerId ? { type: 'speech_order', direction: pick(['cw', 'ccw']) } : null;
    case 'sheriff_suggest': return v.sheriffId === me.playerId ? { type: 'sheriff_suggest', targetId: pick([...alive, null]) } : null;
    case 'sheriff_vote': case 'exile_vote': {
      if (!me.canVote) return null;
      const t = v.vote.targets.filter((id) => !(v.vote.kind === 'sheriff' && id === me.playerId));
      return { type: 'vote', targetId: Math.random() < 0.9 && t.length ? pick(t) : null };
    }
    default: return null;
  }
}

// 游戏结束后默认继续等待：房主点「再来一局」后机器人会自动重新准备。设置 BOT_ONCE=1 则结束后退出。
let announced = false;
for (;;) {
  let ended = false;
  let present = 0;
  for (const b of bots) {
    try {
      const v = await post('state', { code, token: b.token });
      if (v.me) present++;
      if (v.status === 'ended') { ended = true; continue; }
      if (!v.me) continue;
      const a = decide(v, v.me);
      if (a) {
        await post('action', { code, token: b.token, action: a });
        console.log(`[${v.players.find((p) => p.id === b.playerId).seat}号] ${v.phase} → ${a.type}`);
        await sleep(DELAY);
      }
    } catch (e) {
      if (!/锁定|不可操作|不是你|还没轮到|已投票|已做出/.test(e.message)) console.log('操作失败：', e.message);
    }
  }
  if (present === 0) {
    console.log('机器人都已不在房间中，退出');
    break;
  }
  if (ended && !announced) {
    const v = await post('state', { code, token: bots[0].token });
    console.log('游戏结束：', v.winReason, process.env.BOT_ONCE ? '' : '（等待房主「再来一局」）');
    announced = true;
    if (process.env.BOT_ONCE) break;
  }
  if (!ended) announced = false;
  await sleep(ended ? 2000 : 400);
}
