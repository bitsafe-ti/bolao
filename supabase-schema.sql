create table if not exists public.bolao_public_state (
  id text primary key,
  data jsonb not null default '{
    "participants": [],
    "predictions": {},
    "matches": [],
    "lastResultSyncAt": ""
  }'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.bolao_public_state enable row level security;

drop policy if exists "Public read pool state" on public.bolao_public_state;
drop policy if exists "Public insert pool state" on public.bolao_public_state;
drop policy if exists "Public update pool state" on public.bolao_public_state;

create policy "Public read pool state"
on public.bolao_public_state
for select
using (true);

create policy "Public insert pool state"
on public.bolao_public_state
for insert
with check (true);

create policy "Public update pool state"
on public.bolao_public_state
for update
using (true)
with check (true);
