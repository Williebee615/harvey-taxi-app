-- Driver hours limit (docs/driver-hours.md, lib/driverHours.js).
--
-- One row per stretch a driver was online. A trigger on drivers.online
-- opens a row when a driver goes online and closes it when they go
-- offline, whichever code path changes the flag (the app, the web
-- dashboard, the hours sweep, account deletion, an admin). The server sums
-- these rows to enforce "up to 12 hours online, then 6 hours of rest".
--
-- Server-only, like every recent table: RLS on, no policies, and no
-- anon/authenticated privileges. driver_id is not a foreign key, matching
-- driver_push_tokens: driver rows are anonymized, never deleted.
--
-- Status: applied to production 2026-10-04 13:17 UTC.

create table if not exists public.driver_online_sessions (
  id bigint generated always as identity primary key,
  driver_id text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  check (ended_at is null or ended_at >= started_at)
);

create index if not exists driver_online_sessions_driver_idx
  on public.driver_online_sessions (driver_id, started_at desc);

-- At most one open stretch per driver.
create unique index if not exists driver_online_sessions_one_open
  on public.driver_online_sessions (driver_id)
  where ended_at is null;

alter table public.driver_online_sessions enable row level security;
revoke all on table public.driver_online_sessions from anon, authenticated;

create or replace function public.track_driver_online_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.online, false) and (tg_op = 'INSERT' or not coalesce(old.online, false)) then
    insert into public.driver_online_sessions (driver_id, started_at)
    values (new.id::text, now())
    on conflict (driver_id) where ended_at is null do nothing;
  elsif tg_op = 'UPDATE' and coalesce(old.online, false) and not coalesce(new.online, false) then
    update public.driver_online_sessions
       set ended_at = now()
     where driver_id = new.id::text
       and ended_at is null;
  end if;
  return new;
end;
$$;

revoke all on function public.track_driver_online_session() from public, anon, authenticated;

create or replace trigger drivers_track_online_session
  after insert or update of online on public.drivers
  for each row execute function public.track_driver_online_session();

-- Drivers already online when this is applied: count from now.
insert into public.driver_online_sessions (driver_id, started_at)
select d.id::text, now()
  from public.drivers d
 where d.online = true
   and d.id is not null
on conflict (driver_id) where ended_at is null do nothing;
