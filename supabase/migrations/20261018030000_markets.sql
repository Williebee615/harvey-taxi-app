-- Markets (owner decision 2026-10-18: "Add the 'market' field to stores,
-- orders, and approvals now ... supports the regional-manager and
-- city-switch model"). Every store and order belongs to one market (a
-- city). Nashville is the only market; lib/markets.js lists them.
-- Approvals (refund proposals) arrive with step 3c and carry the order's
-- market. Existing rows become Nashville.

alter table public.merchants add column if not exists market text not null default 'nashville';
alter table public.merchants drop constraint if exists merchants_market_check;
alter table public.merchants add constraint merchants_market_check check (market ~ '^[a-z][a-z0-9_]{1,39}$');

alter table public.orders add column if not exists market text not null default 'nashville';
alter table public.orders drop constraint if exists orders_market_check;
alter table public.orders add constraint orders_market_check check (market ~ '^[a-z][a-z0-9_]{1,39}$');

create index if not exists merchants_market_status_idx on public.merchants (market, status);
create index if not exists orders_market_status_idx on public.orders (market, status, created_at);
