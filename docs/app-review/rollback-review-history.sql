-- Rollback for seed-review-history.sql. Removes only the seeded rows
-- (fixed REVIEW_SEED_ IDs, review-flagged) and restores the original
-- display names. Ordinary data is never matched.

begin;

delete from public.driver_earnings
 where id like 'REVIEW_SEED_EARN_%'
   and driver_id = 'DRIVER_GPLAY_REVIEWER';

delete from public.rides
 where id like 'REVIEW_SEED_RIDE_%'
   and is_review_ride = true
   and rider_id = 'RIDER_GPLAY_REVIEWER';

update public.riders
   set first_name = 'Google Play', last_name = 'Reviewer (Rider)'
 where id = 'RIDER_GPLAY_REVIEWER' and is_review_account = true;

update public.drivers
   set first_name = 'Google Play', last_name = 'Reviewer (Driver)'
 where id = 'DRIVER_GPLAY_REVIEWER' and is_review_account = true;

commit;
