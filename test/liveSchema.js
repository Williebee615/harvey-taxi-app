// Column lists for public.rides and public.driver_offers, copied from
// information_schema.columns on the live Supabase project (checked
// 2026-09-28). Used with test/fakeSupabase.js's `columns` option so a read
// or write of a column the real schema doesn't have fails in tests the way
// PostgREST fails in production.
//
// Deliberately absent: rides.current_driver_id and rides.current_offer_id.
// rides.driver_id (text, matches drivers.id "DRV-xxxx") is the canonical
// assigned-driver column. rides.assigned_driver_id (uuid) exists but is
// unused schema debt: it cannot hold DRV-xxxx ids and no code reads or
// writes it.

const LIVE_COLUMNS = {
  // Checked 2026-10-03: no latitude/longitude columns.
  emergency_alerts: "id,ride_id,rider_id,driver_id,alert_type,message,status,created_at,updated_at".split(","),
  rides: (
    "id,rider_id,rider_name,rider_phone,driver_id,driver_name,driver_phone,driver_vehicle," +
    "pickup_address,dropoff_address,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,ride_type," +
    "payment_method,distance_miles,duration_minutes,distance_text,duration_text,estimated_fare," +
    "estimated_driver_payout,estimated_platform_fee,surge_multiplier,fare_config,final_tip," +
    "final_fare,final_driver_payout,final_platform_fee,status,driver_eta_to_pickup_minutes," +
    "driver_eta_to_pickup_text,driver_distance_to_pickup_miles,driver_distance_to_pickup_text," +
    "requested_at,search_started_at,search_restarted_at,mission_sent_at,driver_accepted_at," +
    "driver_arrived_at,trip_started_at,trip_in_progress_at,trip_completed_at,payment_processed_at," +
    "cancelled_at,cancellation_reason,created_at,updated_at,requested_mode,autonomous_vehicle_name," +
    "accepted_at,started_at,completed_at,cancel_reason,notes,scheduled_time,ride_status," +
    "dispatch_status,current_dispatch_id,dispatch_lock_until,last_dispatch_at,assigned_at," +
    "arrived_at,tip_amount,payment_id,assigned_driver_id,cancelled_by,public_code," +
    "estimated_distance_miles,estimated_duration_minutes,pricing_snapshot,payment_status," +
    "en_route_at,cancelled_by_type,cancelled_by_id,driver_payout,platform_revenue,mission_id," +
    "dispatch_id,service_type,miles_estimate,minutes_estimate,fare_total,fare_snapshot," +
    "route_snapshot,current_mission_id,dispatch_attempts,canceled_at,canceled_by,enroute_at," +
    "payment_captured,admin_note,assigned_by_admin,htaf_application_id,delivery_stage," +
    "delivery_pin,merchant_name,item_count,pickup_instructions,delivery_instructions," +
    "delivered_at,delivery_handoff,delivery_proof_url,dispatch_claimed_at,autonomous_pilot," +
    "pilot_status,pilot_zone_id,pilot_provider,pilot_vehicle_id,remote_supervision_status," +
    "human_fallback_allowed,human_fallback_reason,pilot_consent_at,pilot_disclosure_version," +
    "boarding_confirmed_at,is_review_ride," +
    // Added 2026-10-04 (supabase/migrations/20261004140000_add_rider_live_location.sql).
    "rider_live_lat,rider_live_lng,rider_live_accuracy_m,rider_live_at"
  ).split(","),
  driver_offers:
    "id,ride_id,driver_id,status,attempt,decline_reason,responded_at,expires_at,created_at,updated_at".split(
      ","
    )
};

module.exports = { LIVE_COLUMNS };
