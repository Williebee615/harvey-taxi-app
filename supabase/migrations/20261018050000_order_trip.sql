-- Merchant portal, step 3c-3: the delivery trip (owner decision
-- 2026-10-18: "You are authorized to begin building Step 3c-3", the trip
-- created when the store accepts and the capture at the driver's handoff).
--
-- dropoff_address: the street address the rider chose at checkout, shown
-- to the driver. Display text only; the drop-off coordinates still come
-- from the signed delivery estimate.
-- ride_id: one order per delivery trip.

alter table public.orders add column if not exists dropoff_address text;
alter table public.orders drop constraint if exists orders_dropoff_address_check;
alter table public.orders add constraint orders_dropoff_address_check
  check (dropoff_address is null or length(btrim(dropoff_address)) between 3 and 300);

create unique index if not exists orders_ride_id_key on public.orders (ride_id) where ride_id is not null;
