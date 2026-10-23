// Netlify Function：所有游戏规则与身份数据只在这里（服务端）处理
import { handleApi } from '../../server/api';
import { BlobsStore, getRoomStore, setRoomStore } from '../../server/store';

if (!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) setRoomStore(new BlobsStore());

export default async (req: Request) => {
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  const route = new URL(req.url).pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: '请求格式错误' }, { status: 400 });
  }
  const { status, body: out } = await handleApi(route, body, getRoomStore());
  return Response.json(out, { status, headers: { 'Cache-Control': 'no-store' } });
};

export const config = { path: '/api/*' };
