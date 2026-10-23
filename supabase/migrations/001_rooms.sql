-- 可选：使用 Supabase Postgres 作为房间存储（设置 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY 后启用）
create table if not exists public.rooms (
  code text primary key,
  state jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 开启 RLS 且不创建任何策略：anon / authenticated 角色无法读写，
-- 只有服务端的 service_role 可以访问，玩家无法直接读取他人身份。
alter table public.rooms enable row level security;
revoke all on public.rooms from anon, authenticated;

create index if not exists rooms_updated_at_idx on public.rooms (updated_at);
