-- Standalone App Review demonstrations (lib/reviewDemo.js,
-- docs/app-review-demo.md). Off unless the system flag
-- review_demo_autopilot_enabled is "true".
--
-- Additive: two nullable columns and two partial indexes on rides. Every
-- existing row keeps review_demo = null and is unaffected. Only review rides
-- (is_review_ride) ever get a review_demo value.

-- 'autopilot': a reviewer ride driven by the simulated driver.
-- 'auto_offer': the simulated ride offered to the review driver.
alter table public.rides add column if not exists review_demo text;
alter table public.rides drop constraint if exists rides_review_demo_check;
alter table public.rides add constraint rides_review_demo_check check (
  review_demo is null or (review_demo in ('autopilot', 'auto_offer') and is_review_ride = true)
);

-- When the simulated driver's next stage is due (autopilot only).
alter table public.rides add column if not exists review_demo_next_at timestamptz;

-- At most one open simulated driver offer at a time, however many server
-- instances or ticks try to create one at once.
create unique index if not exists rides_one_open_review_auto_offer
  on public.rides ((review_demo))
  where review_demo = 'auto_offer'
    and status in ('payment_authorized', 'awaiting_driver_acceptance', 'driver_assigned', 'driver_enroute', 'arrived', 'in_progress');

-- The tick's lookup of due autopilot stages.
create index if not exists rides_review_demo_due_idx
  on public.rides (review_demo_next_at)
  where review_demo = 'autopilot';
