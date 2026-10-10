-- Markets (lib/markets.js, docs/markets/README.md): which market each
-- rider, driver, ride, offer, earning and payment row belongs to.
--
-- Additive and Nashville-preserving: every existing row, and every new row
-- that doesn't say otherwise, is 'us-nashville'. Adding a NOT NULL column
-- with a constant default is a metadata-only change in Postgres 11+ (no
-- table rewrite). Tables that don't exist in a given database are skipped.
--
-- Not done here, required before any second market goes live (readiness
-- checklist): dispatch and offer acceptance matching only drivers whose
-- market_id equals the ride's. Today no other market can create a ride
-- (the server refuses), so nothing can cross markets.

do $$
declare
  t text;
begin
  foreach t in array array['riders', 'drivers', 'rides', 'driver_offers', 'driver_earnings', 'payments', 'payouts', 'driver_payouts', 'tips'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists market_id text not null default %L', t, 'us-nashville');
      if not exists (select 1 from pg_constraint where conname = t || '_market_id_format') then
        execute format('alter table public.%I add constraint %I check (market_id ~ %L)', t, t || '_market_id_format', '^[a-z]{2}-[a-z]{2,30}$');
      end if;
    end if;
  end loop;
end $$;

create index if not exists rides_market_id_idx on public.rides (market_id, created_at desc);
create index if not exists drivers_market_id_idx on public.drivers (market_id);
