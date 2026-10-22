-- Supaplex (https://werzawerz.github.io/superplex/) cloud saves, in the Stunts project's database.
-- One row per synced player, found only by its secret sync code: the table stores the code's
-- SHA-256, never the code. No direct table access for the web client (RLS on, no policies);
-- it goes through the two functions below, which need the code. Payload is size capped.
-- Applied 2026-10-22. The security advisor's "RLS enabled, no policy" and "anon can execute
-- SECURITY DEFINER function" notices for these objects are this design, on purpose.

create table if not exists public.supaplex_saves (
  id text primary key check (char_length(id) = 64),  -- hex sha256 of the sync code
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.supaplex_saves enable row level security;
revoke all on public.supaplex_saves from anon, authenticated;

create or replace function public.supaplex_load(code text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select data from public.supaplex_saves
  where id = encode(sha256(convert_to(upper(code), 'UTF8')), 'hex');
$$;

create or replace function public.supaplex_save(code text, payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if code is null or code !~ '^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$' then
    raise exception 'invalid sync code';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' or pg_column_size(payload) > 8000 then
    raise exception 'invalid save';
  end if;
  insert into public.supaplex_saves (id, data, updated_at)
  values (encode(sha256(convert_to(code, 'UTF8')), 'hex'), payload, now())
  on conflict (id) do update set data = excluded.data, updated_at = now();
end;
$$;

revoke all on function public.supaplex_load(text) from public;
revoke all on function public.supaplex_save(text, jsonb) from public;
grant execute on function public.supaplex_load(text) to anon, authenticated;
grant execute on function public.supaplex_save(text, jsonb) to anon, authenticated;
