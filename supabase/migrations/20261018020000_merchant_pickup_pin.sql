-- Merchant portal: store pickup pin (owner decision 2026-10-18: "Staff
-- confirm a map pin during the store approval process"). Staff paste the
-- coordinates of the store's pickup entrance from a map; orders need a
-- pin, and a delivery-fee quote must start at it. No geocoding service.
-- Who confirmed the pin, and when, is kept.

alter table public.merchants
  add column if not exists pickup_lat double precision,
  add column if not exists pickup_lng double precision,
  add column if not exists pickup_pin_confirmed_by text,
  add column if not exists pickup_pin_confirmed_at timestamptz;

alter table public.merchants drop constraint if exists merchants_pickup_pin_check;
alter table public.merchants add constraint merchants_pickup_pin_check check (
  (pickup_lat is null and pickup_lng is null and pickup_pin_confirmed_by is null and pickup_pin_confirmed_at is null)
  or (pickup_lat between -90 and 90 and pickup_lng between -180 and 180
      and pickup_pin_confirmed_by is not null and pickup_pin_confirmed_at is not null)
);
