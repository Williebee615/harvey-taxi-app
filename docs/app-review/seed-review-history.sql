-- App Review sample history. NOT a migration: run once, by hand, in the
-- Supabase SQL editor, after approval. Idempotent (re-running inserts
-- nothing new). Rollback: rollback-review-history.sql.
--
-- What it does:
--   1. Relabels the two existing review accounts from "Google Play ..."
--      to a store-neutral "App Review ..." display name.
--   2. Inserts 5 completed, simulated rides between the review rider and
--      the review driver, plus one driver_earnings row per ride, so ride
--      history and earnings are reviewable.
--
-- Safety: every row is is_review_ride = true, payment_status =
-- 'not_required', payment_id NULL (no payments row, no Stripe object).
-- Fixed IDs prefixed REVIEW_SEED_ make the rows easy to find and remove.
-- Touches no ordinary rider, driver or ride. Contains no credentials.

begin;

-- Guard: abort unless both review accounts exist and are flagged.
do $$
begin
  if not exists (select 1 from public.riders
                 where id = 'RIDER_GPLAY_REVIEWER' and is_review_account = true)
     or not exists (select 1 from public.drivers
                    where id = 'DRIVER_GPLAY_REVIEWER' and is_review_account = true) then
    raise exception 'Review accounts missing or not flagged; nothing changed.';
  end if;
end $$;

update public.riders
   set first_name = 'App Review', last_name = 'Rider'
 where id = 'RIDER_GPLAY_REVIEWER' and is_review_account = true;

update public.drivers
   set first_name = 'App Review', last_name = 'Driver'
 where id = 'DRIVER_GPLAY_REVIEWER' and is_review_account = true;

insert into public.rides (
  id, rider_id, driver_id, status, ride_type,
  pickup_address, dropoff_address,
  pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
  distance_miles, duration_minutes,
  estimated_fare, final_fare, tip_amount, driver_payout,
  driver_name, driver_vehicle,
  payment_status, payment_id, is_review_ride,
  requested_at, created_at, updated_at, completed_at
)
select v.id, 'RIDER_GPLAY_REVIEWER', 'DRIVER_GPLAY_REVIEWER', 'completed',
       'standard',
       v.pickup, v.dropoff, v.plat, v.plng, v.dlat, v.dlng,
       v.miles, v.minutes, v.fare, v.fare, v.tip, v.payout,
       'App Review Driver', 'Simulated vehicle (App Review)',
       'not_required', null, true,
       now() - v.ago, now() - v.ago, now() - v.ago + v.dur, now() - v.ago + v.dur
from (values
  ('REVIEW_SEED_RIDE_1', '501 Broadway, Nashville, TN 37203',
   '1 Terminal Dr, Nashville, TN 37214',
   36.1612, -86.7775, 36.1263, -86.6774, 9.8, 18, 31.40, 4.00, 22.00,
   interval '2 days', interval '20 minutes'),
  ('REVIEW_SEED_RIDE_2', '2500 West End Ave, Nashville, TN 37203',
   '1 Titans Way, Nashville, TN 37213',
   36.1493, -86.8100, 36.1665, -86.7713, 3.6, 12, 14.75, 2.00, 10.30,
   interval '5 days', interval '14 minutes'),
  ('REVIEW_SEED_RIDE_3', '1211 Medical Center Dr, Nashville, TN 37232',
   '2120 Belcourt Ave, Nashville, TN 37212',
   36.1420, -86.8005, 36.1355, -86.8003, 1.4, 7, 9.50, 0.00, 6.65,
   interval '8 days', interval '9 minutes'),
  ('REVIEW_SEED_RIDE_4', '600 Opry Mills Dr, Nashville, TN 37214',
   '222 2nd Ave S, Nashville, TN 37201',
   36.2033, -86.6934, 36.1599, -86.7740, 10.7, 21, 33.20, 5.00, 23.25,
   interval '12 days', interval '24 minutes'),
  ('REVIEW_SEED_RIDE_5', '1600 Division St, Nashville, TN 37203',
   '3401 West End Ave, Nashville, TN 37203',
   36.1503, -86.7929, 36.1386, -86.8205, 2.3, 9, 11.25, 1.50, 7.90,
   interval '20 days', interval '11 minutes')
) as v(id, pickup, dropoff, plat, plng, dlat, dlng, miles, minutes,
       fare, tip, payout, ago, dur)
on conflict (id) do nothing;

-- Mirrors upsertDriverEarningIdempotent(): total = driver_payout + tip.
insert into public.driver_earnings (
  id, ride_id, driver_id, rider_id, gross_fare, driver_base_earning,
  tip_amount, total_earning, payout_amount, currency, status,
  earning_status, payment_id, created_at, updated_at
)
select 'REVIEW_SEED_EARN_' || substr(r.id, length('REVIEW_SEED_RIDE_') + 1),
       r.id, r.driver_id, r.rider_id, r.estimated_fare, r.driver_payout,
       r.tip_amount, r.driver_payout + r.tip_amount,
       r.driver_payout + r.tip_amount, 'USD', 'earned', 'earned', null,
       r.completed_at, r.completed_at
from public.rides r
where r.id like 'REVIEW_SEED_RIDE_%'
  and r.is_review_ride = true
on conflict do nothing;

commit;

-- Verify (read-only):
-- select id, status, payment_status, is_review_ride, final_fare
--   from public.rides where id like 'REVIEW_SEED_RIDE_%' order by id;
-- select id, ride_id, total_earning, status
--   from public.driver_earnings where id like 'REVIEW_SEED_EARN_%' order by id;
