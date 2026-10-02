-- TEST-ONLY schema snapshot of the production public schema (Supabase
-- project orgahzncmzptljapqffj), generated 2026-10-01 from read-only
-- catalog queries (pg_attribute, pg_constraint, pg_index, pg_proc,
-- pg_trigger). SCHEMA ONLY: no rows were read or copied. Never apply this
-- to any Supabase environment; it exists so the isolated end-to-end suite
-- (test/stripe-isolated.e2e.test.js) runs the server against a real
-- Postgres with production's tables, constraints (including
-- rides.payment_id -> payments.id), indexes, dispatch functions and
-- triggers. Excluded: PostGIS's own objects, views, RLS policies (the
-- server uses the service role, which bypasses RLS).

create extension if not exists postgis;
create extension if not exists pgcrypto;

do $$
declare r record;
begin
  for r in select * from (values ('anon', 'nologin'), ('authenticated', 'nologin'), ('service_role', 'nologin bypassrls')) v(name, opts) loop
    if not exists (select 1 from pg_roles where rolname = r.name) then
      begin
        execute format('create role %I %s', r.name, r.opts);
      exception when duplicate_object or unique_violation then null;
      end;
    end if;
  end loop;
end $$;

create sequence if not exists public.admin_rbac_shadow_log_id_seq;

create table public.admin_logs (id text not null, type text not null, message text not null, metadata jsonb default '{}'::jsonb, created_at timestamp with time zone default now() not null, action text, admin_email text, target_type text, target_id text, ride_id text, rider_id text, driver_id text, details jsonb default '{}'::jsonb);
create table public.admin_rbac_shadow_log (id bigint default nextval('admin_rbac_shadow_log_id_seq'::regclass) not null, actor_email text, auth_method text, route text not null, http_method text not null, required_capability text not null, resolved_role text, resolution_source text not null, would_allow boolean not null, created_at timestamp with time zone default now() not null);
create table public.admin_roles (id uuid default gen_random_uuid() not null, email text not null, role text not null, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null);
create table public.audit_logs (id bigint not null, actor_type text, actor_id text, action text, entity_type text, entity_id text, metadata jsonb default '{}'::jsonb, ip_address text, user_agent text, created_at timestamp with time zone default now());
create table public.autonomous_pilot_events (id bigint not null, ride_id text not null, event_type text not null, pilot_status text, actor_type text not null, actor_id text, provider_event_id text, metadata jsonb default '{}'::jsonb not null, created_at timestamp with time zone default now() not null);
create table public.autonomous_pilot_zones (id text not null, name text not null, active boolean default false not null, center_lat numeric not null, center_lng numeric not null, radius_miles numeric not null, polygon jsonb, service_hours jsonb, notes text, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null);
create table public.autonomous_provider_reservations (id text not null, ride_id text not null, provider text not null, provider_reservation_id text, vehicle_id text, status text default 'pending'::text not null, requested_at timestamp with time zone default now() not null, reserved_at timestamp with time zone, cancelled_at timestamp with time zone, metadata jsonb default '{}'::jsonb not null, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null);
create table public.deletion_requests (request_id text not null, user_type text not null, user_id text not null, status text default 'pending'::text not null, reason text, requested_at timestamp with time zone default now() not null, approved_at timestamp with time zone, completed_at timestamp with time zone, rejected_at timestamp with time zone, reviewed_by text, admin_notes text, created_at timestamp with time zone default now() not null);
create table public.deliveries (id text not null, ride_id text, delivery_type text, status text, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now());
create table public.delivery_order_items (id uuid default gen_random_uuid() not null, delivery_order_id uuid not null, name text not null, quantity integer default 1, unit_price numeric default 0, line_total numeric default 0, notes text, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now());
create table public.delivery_orders (id uuid default gen_random_uuid() not null, rider_id uuid not null, driver_id uuid, payment_id uuid, service_type text not null, status text default 'created'::text not null, store_name text, restaurant_name text, pickup_address text not null, dropoff_address text not null, pickup_lat numeric, pickup_lng numeric, dropoff_lat numeric, dropoff_lng numeric, subtotal numeric default 0, delivery_fee numeric default 0, service_fee numeric default 0, small_order_fee numeric default 0, total numeric default 0, driver_payout numeric default 0, platform_revenue numeric default 0, item_count integer default 0, fare_snapshot jsonb, route_snapshot jsonb, notes text, customer_notes text, driver_notes text, scheduled_at timestamp with time zone, current_dispatch_id uuid, current_mission_id uuid, dispatch_attempts integer default 0, payment_status text, assigned_at timestamp with time zone, en_route_store_at timestamp with time zone, arrived_store_at timestamp with time zone, picked_up_at timestamp with time zone, en_route_customer_at timestamp with time zone, arrived_customer_at timestamp with time zone, completed_at timestamp with time zone, canceled_at timestamp with time zone, canceled_by text, cancellation_reason text, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now());
create table public.delivery_status_events (id uuid default gen_random_uuid() not null, delivery_order_id uuid, event_type text not null, payload jsonb default '{}'::jsonb, data jsonb default '{}'::jsonb, created_at timestamp with time zone default now());
create table public.dispatch_offers (id uuid default gen_random_uuid() not null, ride_id uuid, driver_id uuid, driver_name text, fleet_type text, status text default 'pending'::text, offered_at timestamp with time zone default now(), responded_at timestamp with time zone, expires_at timestamp with time zone);
create table public.dispatch_queue (id uuid default gen_random_uuid() not null, ride_id uuid, pickup_address text, dropoff_address text, assigned boolean default false, assigned_driver_id uuid, fleet_type text, status text default 'waiting'::text, created_at timestamp with time zone default now(), updated_at timestamp with time zone);
create table public.dispatches (id text not null, ride_id text not null, rider_id text, driver_id text, status text default 'awaiting_driver'::text not null, attempt_number integer default 1 not null, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null, expires_at timestamp with time zone, response_status text, responded_at timestamp with time zone, attempt_no integer, dispatch_status text, offer_expires_at timestamp with time zone, requested_mode text, offered_at timestamp with time zone, accepted_at timestamp with time zone, completed_at timestamp with time zone, cancelled_at timestamp with time zone, en_route_at timestamp with time zone, arrived_at timestamp with time zone, started_at timestamp with time zone, delivery_order_id uuid, service_type text, mission_id uuid, score numeric, distance_miles numeric, rejected_at timestamp with time zone, rejection_reason text, canceled_at timestamp with time zone, cancellation_reason text);
create table public.driver_earnings (id text not null, ride_id text, driver_id text, rider_id text, gross_fare numeric, driver_base_earning numeric, tip_amount numeric, total_earning numeric, earning_status text, payout_id text, created_at timestamp with time zone, updated_at timestamp with time zone, payout_amount numeric(10,2) default 0, currency text default 'usd'::text, status text default 'earned'::text, payment_id text);
create table public.driver_email_verifications (id text not null, driver_id text not null, email text not null, token text not null, status text default 'pending'::text not null, expires_at timestamp with time zone not null, verified_at timestamp with time zone, created_at timestamp with time zone default now() not null);
create table public.driver_locations (id text not null, driver_id text, address text, heading numeric, speed_mph numeric, availability_snapshot boolean, created_at timestamp with time zone, session_id text, lat numeric, lng numeric, speed numeric, accuracy numeric, recorded_at timestamp with time zone default now());
create table public.driver_offers (id text not null, ride_id text, driver_id text, status text default 'pending'::text, attempt integer default 1, decline_reason text, responded_at timestamp with time zone, expires_at timestamp with time zone, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now());
create table public.driver_payouts (id text not null, driver_id text, amount numeric(10,2) default 0, currency text default 'usd'::text, status text default 'pending'::text, earning_id text, notes text, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now());
create table public.driver_sessions (id text not null, driver_id text, status text default 'offline'::text, last_heartbeat timestamp with time zone default now(), device text, app_version text, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now());
create table public.driver_sms_verifications (id text not null, driver_id text not null, phone text not null, code_hash text not null, status text default 'pending'::text not null, expires_at timestamp with time zone not null, verified_at timestamp with time zone, created_at timestamp with time zone default now() not null);
create table public.driver_wallets (id text not null, driver_id text, balance numeric default 0, lifetime_earnings numeric default 0, updated_at timestamp with time zone default now());
create table public.drivers (id text not null, full_name text, email text, phone text, vehicle_make text, vehicle_model text, vehicle_color text, vehicle_plate text, verified boolean default false, approved boolean default false, persona_status text default 'pending'::text, checkr_status text default 'pending'::text, online boolean default false, available boolean default false, driver_status text default 'offline'::text, current_address text, last_known_address text, home_address text, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now(), email_verified boolean default false, sms_verified boolean default false, email_verification_token text, email_verified_at timestamp with time zone, email_verification_sent_at timestamp with time zone, email_verification_expires_at timestamp with time zone, sms_verification_code text, sms_verified_at timestamp with time zone, sms_verification_sent_at timestamp with time zone, sms_verification_expires_at timestamp with time zone, sms_verification_attempts integer default 0, first_name text, last_name text, city text, state text, password text, vehicle_year text, license_plate text, license_number text, verification_status text default 'pending'::text, background_check_status text default 'pending'::text, status text default 'offline'::text, driver_type text default 'human'::text, terms_accepted boolean default false, background_check_accepted boolean default false, insurance_confirmed boolean default false, latitude double precision, longitude double precision, approval_status text default 'pending'::text, fully_verified boolean default false, approved_at timestamp without time zone, rejected_reason text, availability_status text default 'offline'::text, is_available boolean default false, drivers_license_number text, accepted_terms boolean default false, accepted_background_check_consent boolean default false, accepted_driver_policy boolean default false, password_hash text, role text default 'driver'::text, is_approved boolean default false, identity_status text default 'not_started'::text, persona_inquiry_id text, email_verification_token_hash text, sms_verification_code_hash text, is_online boolean default false, rating numeric default 5, acceptance_rate numeric default 1, distance_miles numeric default 9999, is_priority boolean default false, current_ride_id text, current_mission_id text, is_blocked boolean default false, is_disabled boolean default false, last_seen_at timestamp with time zone, name text, phone_number text, mobile text, access_status text default 'pending'::text, online_status text default 'offline'::text, rejected_at timestamp with time zone, rejection_reason text, approval_note text, phone_verified boolean default false, sms_code text, sms_code_expires_at timestamp without time zone, phone_verification_code_hash text, phone_verification_expires_at timestamp with time zone, identity_verified boolean default false, persona_template_id text, persona_last_event text, persona_last_payload jsonb, checkr_candidate_id text, checkr_invitation_id text, checkr_invitation_url text, checkr_report_id text, checkr_last_event text, checkr_last_payload jsonb, review_reason text, current_lat numeric, current_lng numeric, last_location_at timestamp with time zone, last_available_at timestamp with time zone, last_unavailable_at timestamp with time zone, consents jsonb, zipcode text, stripe_account_id text, preferred_score numeric default 0, supports_rides boolean default true, supports_food_delivery boolean default true, supports_grocery_delivery boolean default true, current_delivery_order_id uuid, phone_verified_at timestamp with time zone, deletion_requested boolean default false, deletion_requested_at timestamp with time zone, deletion_reason text, persona_verified boolean default false, total_trips integer default 0, heading double precision, speed double precision, insurance_status text, license_status text, geog geography(Point,4326), photo_url text, location_accuracy_meters numeric, access_revoked boolean default false not null, deleted_at timestamp with time zone, deleted_reason text, deleted_by text, is_review_account boolean default false not null, review_password_hash text, review_password_salt text);
create table public.emergency_alerts (id text not null, ride_id text, rider_id text, driver_id text, alert_type text, message text, status text default 'open'::text, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now());
create table public.events (id text not null, type text, payload jsonb, created_at timestamp with time zone default now());
create table public.fleet_units (id text not null, unit_type text not null, name text, email text, phone text, vehicle_name text, plate text, provider text default 'harvey'::text, provider_unit_id text, status text default 'offline'::text, online boolean default false, available boolean default false, approved boolean default false, lat numeric, lng numeric, battery_level numeric, health_status text default 'ok'::text, sensor_status text default 'ready'::text, supports_autonomous_mode boolean default false, supports_remote_assist boolean default false, remote_ready boolean default false, created_at timestamp without time zone default now(), updated_at timestamp without time zone default now());
create table public.htaf_applications (id text not null, first_name text not null, last_name text not null, email text not null, phone text not null, county text not null, city text not null, program_type text not null, pickup_city text not null, destination text not null, ride_date date not null, transportation_need text not null, status text default 'submitted'::text not null, review_notes text, assigned_admin text, submitted_at timestamp with time zone default now() not null, reviewed_at timestamp with time zone, updated_at timestamp with time zone default now() not null, source text default 'foundation.html'::text, client_version text default 'htaf-portal-v1'::text, application_code text, applicant_type text, household_size integer, monthly_income numeric, notes text, created_at timestamp with time zone default now(), ride_id text);
create table public.incident_reports (id uuid default gen_random_uuid() not null, ride_id uuid, rider_id uuid, driver_id uuid, incident_type text default 'general'::text not null, severity text default 'medium'::text not null, summary text, details text not null, reported_by_type text default 'system'::text not null, reported_by_id text, status text default 'open'::text not null, metadata jsonb default '{}'::jsonb, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null);
create table public.missions (id text not null, ride_id text, rider_name text, phone text, pickup text, dropoff text, pickup_lat numeric, pickup_lng numeric, dropoff_lat numeric, dropoff_lng numeric, assigned_unit_id text, assigned_unit_type text, provider text, mission_mode text default 'mixed_auto'::text, status text default 'searching'::text, remote_assist_required boolean default false, fallback_required boolean default false, dispatch_distance_miles numeric, created_at timestamp without time zone default now(), updated_at timestamp without time zone default now(), accepted_at timestamp with time zone, declined_at timestamp with time zone, cancelled_at timestamp with time zone, completed_at timestamp with time zone, expires_at timestamp with time zone, mission_status text, dispatch_id text, sequence_no integer, requested_mode text, rider_id text, driver_id text, pickup_address text, dropoff_address text, offer_expires_at timestamp with time zone, expired_at timestamp with time zone, en_route_at timestamp with time zone, arrived_at timestamp with time zone, started_at timestamp with time zone, expiration_reason text, delivery_order_id uuid, service_type text, mission_type text, fare_total numeric, driver_payout numeric, rejected_at timestamp with time zone, rejection_reason text, canceled_at timestamp with time zone, cancellation_reason text, en_route_store_at timestamp with time zone, arrived_store_at timestamp with time zone, picked_up_at timestamp with time zone, en_route_customer_at timestamp with time zone, arrived_customer_at timestamp with time zone);
create table public.notification_logs (id uuid default gen_random_uuid() not null, channel text, notification_type text, recipient_role text, recipient_id text, ride_id text, mission_id text, dispatch_id text, destination text, message text, status text, provider text, metadata jsonb default '{}'::jsonb, created_at timestamp with time zone default now() not null);
create table public.payment_authorizations (authorization_id text not null, rider_id text, payment_method text, authorized_amount numeric default 0, status text default 'AUTHORIZED'::text, created_at timestamp with time zone default now());
create table public.payments (id text not null, rider_id text not null, amount numeric(10,2) default 0 not null, currency text default 'USD'::text not null, status text default 'authorized'::text not null, authorization_reference text, payment_method_last4 text, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null, authorization_status text, capture_amount numeric(10,2), driver_payout numeric(10,2), platform_revenue numeric(10,2), cancellation_reason text, ride_id text, delivery_order_id uuid, driver_id uuid, service_type text, provider text, type text, stripe_customer_id text, stripe_payment_intent_id text, stripe_latest_status text, client_secret text, fare_snapshot jsonb, route_snapshot jsonb, captured_at timestamp with time zone, captured_amount numeric, canceled_at timestamp with time zone, cancel_reason text, failure_message text);
create table public.payouts (id text not null, driver_id text, amount numeric, payout_status text, earning_ids jsonb, paid_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone);
create table public.preferred_drivers (id text not null, rider_id text not null, driver_id text not null, nickname text, is_active boolean default true, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now());
create table public.push_subscriptions (id text default (gen_random_uuid())::text not null, owner_type text not null, owner_id text not null, endpoint text not null, p256dh text not null, auth text not null, user_agent text, created_at timestamp with time zone default now(), last_used_at timestamp with time zone default now());
create table public.ride_chat (id uuid default gen_random_uuid() not null, ride_id uuid, sender_type text, message text, created_at timestamp with time zone default now());
create table public.rider_verifications (id uuid default gen_random_uuid() not null, rider_id uuid, inquiry_id text, status text, created_at timestamp with time zone default now());
create table public.riders (id text not null, full_name text, email text, phone text, verified boolean default false, approved boolean default false, persona_status text default 'pending'::text, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now(), approval_status text default 'pending'::text, verification_status text default 'pending'::text, is_approved boolean default false, email_verified boolean default false, sms_verified boolean default false, fully_verified boolean default false, city text, state text, emergency_contact text, account_notes text, verification_document_type text, first_name text, last_name text, password text, notes text, password_hash text, payment_authorization_status text default 'pending'::text, payment_authorized boolean default false, payment_authorized_at timestamp with time zone, role text default 'rider'::text, identity_verification_status text, identity_document_type text, persona_inquiry_id text, verification_completed_at timestamp with time zone, verification_payload jsonb, id_type text default 'government_id'::text, id_last4 text, status text default 'active'::text, payment_status text default 'authorized'::text, is_blocked boolean default false, is_disabled boolean default false, access_status text default 'pending'::text, approved_at timestamp with time zone, rider_type text default 'standard'::text, document_type text, name text, phone_number text, mobile text, rejected_at timestamp with time zone, rejection_reason text, approval_note text, stripe_customer_id text, persona_template_id text, persona_last_event text, persona_last_payload jsonb, deletion_requested boolean default false, deletion_requested_at timestamp with time zone, deletion_reason text, access_revoked boolean default false not null, deleted_at timestamp with time zone, deleted_reason text, deleted_by text, photo_url text, session_version integer default 0 not null, is_review_account boolean default false not null, review_password_hash text, review_password_salt text);
create table public.rides (id text not null, rider_id text, rider_name text, rider_phone text, driver_id text, driver_name text, driver_phone text, driver_vehicle text, pickup_address text, dropoff_address text, pickup_lat numeric, pickup_lng numeric, dropoff_lat numeric, dropoff_lng numeric, ride_type text, payment_method text, distance_miles numeric, duration_minutes numeric, distance_text text, duration_text text, estimated_fare numeric, estimated_driver_payout numeric, estimated_platform_fee numeric, surge_multiplier numeric, fare_config jsonb, final_tip numeric, final_fare numeric, final_driver_payout numeric, final_platform_fee numeric, status text, driver_eta_to_pickup_minutes numeric, driver_eta_to_pickup_text text, driver_distance_to_pickup_miles numeric, driver_distance_to_pickup_text text, requested_at timestamp with time zone, search_started_at timestamp with time zone, search_restarted_at timestamp with time zone, mission_sent_at timestamp with time zone, driver_accepted_at timestamp with time zone, driver_arrived_at timestamp with time zone, trip_started_at timestamp with time zone, trip_in_progress_at timestamp with time zone, trip_completed_at timestamp with time zone, payment_processed_at timestamp with time zone, cancelled_at timestamp with time zone, cancellation_reason text, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now(), requested_mode text default 'driver'::text, autonomous_vehicle_name text, accepted_at timestamp with time zone, started_at timestamp with time zone, completed_at timestamp with time zone, cancel_reason text, notes text, scheduled_time text, ride_status text, dispatch_status text, current_dispatch_id text, dispatch_lock_until timestamp with time zone, last_dispatch_at timestamp with time zone, assigned_at timestamp with time zone, arrived_at timestamp with time zone, tip_amount numeric default 0, payment_id text, assigned_driver_id uuid, cancelled_by text, public_code text, estimated_distance_miles numeric(10,2), estimated_duration_minutes numeric(10,2), pricing_snapshot jsonb default '{}'::jsonb, payment_status text, en_route_at timestamp with time zone, cancelled_by_type text, cancelled_by_id text, driver_payout numeric(10,2), platform_revenue numeric(10,2), mission_id text, dispatch_id text, service_type text default 'ride'::text, miles_estimate numeric, minutes_estimate numeric, fare_total numeric, fare_snapshot jsonb, route_snapshot jsonb, current_mission_id uuid, dispatch_attempts integer default 0, canceled_at timestamp with time zone, canceled_by text, enroute_at timestamp with time zone, payment_captured boolean default false, admin_note text, assigned_by_admin text, htaf_application_id text, delivery_stage text, delivery_pin text, merchant_name text, item_count integer, pickup_instructions text, delivery_instructions text, delivered_at timestamp with time zone, delivery_handoff text, delivery_proof_url text, dispatch_claimed_at timestamp with time zone, autonomous_pilot boolean default false not null, pilot_status text, pilot_zone_id text, pilot_provider text, pilot_vehicle_id text, remote_supervision_status text, human_fallback_allowed boolean default false not null, human_fallback_reason text, pilot_consent_at timestamp with time zone, pilot_disclosure_version text, boarding_confirmed_at timestamp with time zone, is_review_ride boolean default false not null, payment_capture_idempotency_key text, payment_capture_attempted_at timestamp with time zone, payment_capture_error text, cancellation_payment_status text, cancellation_payment_idempotency_key text, cancellation_payment_attempted_at timestamp with time zone, cancellation_payment_error text, quote_jti text);
create table public.safety_reports (id text not null, ride_id text, reporter_type text, reporter_id text, category text, description text, status text default 'open'::text, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now());
create table public.saved_places (id text not null, rider_id text not null, label text not null, address text not null, lat numeric, lng numeric, icon text default '📍'::text not null, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null);
create table public.support_cases (id uuid default gen_random_uuid() not null, ride_id uuid, rider_id uuid, driver_id uuid, case_type text default 'general'::text not null, priority text default 'normal'::text not null, subject text, description text not null, status text default 'open'::text not null, created_by_type text default 'system'::text not null, created_by_id text, metadata jsonb default '{}'::jsonb, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null);
create table public.system_flags (key text not null, value text, reason text, updated_at timestamp with time zone default now());
create table public.tips (id text not null, ride_id text, rider_id text, driver_id text, amount numeric, currency text, source text, status text, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now());
create table public.trip_events (id text not null, ride_id text not null, rider_id text, driver_id text, event_type text not null, event_message text, metadata jsonb, created_at timestamp with time zone default now() not null, title text, description text);
create table public.trip_timelines (id text not null, ride_id text, driver_id text, session_id text, event text, meta jsonb, created_at timestamp with time zone default now());
create table public.usage_counters (key text not null, count bigint default 0 not null, updated_at timestamp with time zone default now() not null);
create table public.verification_codes (id text not null, channel text, destination text, purpose text, user_type text, code_hash text, attempts integer default 0, max_attempts integer default 5, used_at timestamp with time zone, expires_at timestamp with time zone, metadata jsonb default '{}'::jsonb, created_at timestamp with time zone default now());

alter table public.audit_logs alter column id add generated always as identity;
alter table public.autonomous_pilot_events alter column id add generated always as identity;

alter table public.admin_logs add constraint admin_logs_pkey PRIMARY KEY (id);
alter table public.admin_rbac_shadow_log add constraint admin_rbac_shadow_log_pkey PRIMARY KEY (id);
alter table public.admin_roles add constraint admin_roles_pkey PRIMARY KEY (id);
alter table public.admin_roles add constraint admin_roles_role_check CHECK ((role = ANY (ARRAY['super_admin'::text, 'htaf_caseworker'::text, 'dispatcher'::text, 'support'::text, 'finance'::text, 'compliance'::text])));
alter table public.audit_logs add constraint audit_logs_pkey PRIMARY KEY (id);
alter table public.autonomous_pilot_events add constraint autonomous_pilot_events_pkey PRIMARY KEY (id);
alter table public.autonomous_pilot_zones add constraint autonomous_pilot_zones_center_lat_check CHECK (((center_lat >= ('-90'::integer)::numeric) AND (center_lat <= (90)::numeric)));
alter table public.autonomous_pilot_zones add constraint autonomous_pilot_zones_center_lng_check CHECK (((center_lng >= ('-180'::integer)::numeric) AND (center_lng <= (180)::numeric)));
alter table public.autonomous_pilot_zones add constraint autonomous_pilot_zones_pkey PRIMARY KEY (id);
alter table public.autonomous_pilot_zones add constraint autonomous_pilot_zones_radius_miles_check CHECK ((radius_miles > (0)::numeric));
alter table public.autonomous_provider_reservations add constraint autonomous_provider_reservations_pkey PRIMARY KEY (id);
alter table public.autonomous_provider_reservations add constraint autonomous_provider_reservations_ride_id_key UNIQUE (ride_id);
alter table public.deletion_requests add constraint deletion_requests_pkey PRIMARY KEY (request_id);
alter table public.deletion_requests add constraint deletion_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'rejected'::text, 'review_simulated'::text])));
alter table public.deletion_requests add constraint deletion_requests_user_type_check CHECK ((user_type = ANY (ARRAY['rider'::text, 'driver'::text])));
alter table public.deliveries add constraint deliveries_pkey PRIMARY KEY (id);
alter table public.delivery_order_items add constraint delivery_order_items_pkey PRIMARY KEY (id);
alter table public.delivery_orders add constraint delivery_orders_pkey PRIMARY KEY (id);
alter table public.delivery_orders add constraint delivery_orders_service_type_check CHECK ((service_type = ANY (ARRAY['food'::text, 'grocery'::text])));
alter table public.delivery_status_events add constraint delivery_status_events_pkey PRIMARY KEY (id);
alter table public.dispatch_offers add constraint dispatch_offers_pkey PRIMARY KEY (id);
alter table public.dispatch_queue add constraint dispatch_queue_pkey PRIMARY KEY (id);
alter table public.dispatches add constraint dispatches_pkey PRIMARY KEY (id);
alter table public.driver_earnings add constraint driver_earnings_pkey PRIMARY KEY (id);
alter table public.driver_earnings add constraint driver_earnings_ride_id_unique UNIQUE (ride_id);
alter table public.driver_earnings add constraint driver_earnings_status_check CHECK ((status = ANY (ARRAY['earned'::text, 'pending'::text, 'paid'::text, 'cancelled'::text])));
alter table public.driver_email_verifications add constraint driver_email_verifications_pkey PRIMARY KEY (id);
alter table public.driver_email_verifications add constraint driver_email_verifications_token_key UNIQUE (token);
alter table public.driver_locations add constraint driver_locations_pkey PRIMARY KEY (id);
alter table public.driver_offers add constraint driver_offers_pkey PRIMARY KEY (id);
alter table public.driver_payouts add constraint driver_payouts_pkey PRIMARY KEY (id);
alter table public.driver_payouts add constraint driver_payouts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'paid'::text, 'failed'::text, 'cancelled'::text])));
alter table public.driver_sessions add constraint driver_sessions_pkey PRIMARY KEY (id);
alter table public.driver_sms_verifications add constraint driver_sms_verifications_pkey PRIMARY KEY (id);
alter table public.driver_wallets add constraint driver_wallets_pkey PRIMARY KEY (id);
alter table public.drivers add constraint drivers_pkey PRIMARY KEY (id);
alter table public.emergency_alerts add constraint emergency_alerts_pkey PRIMARY KEY (id);
alter table public.events add constraint events_pkey PRIMARY KEY (id);
alter table public.fleet_units add constraint fleet_units_pkey PRIMARY KEY (id);
alter table public.htaf_applications add constraint htaf_applications_pkey PRIMARY KEY (id);
alter table public.incident_reports add constraint incident_reports_pkey PRIMARY KEY (id);
alter table public.missions add constraint missions_pkey PRIMARY KEY (id);
alter table public.notification_logs add constraint notification_logs_pkey PRIMARY KEY (id);
alter table public.payment_authorizations add constraint payment_authorizations_pkey PRIMARY KEY (authorization_id);
alter table public.payments add constraint payments_pkey PRIMARY KEY (id);
alter table public.payouts add constraint payouts_pkey PRIMARY KEY (id);
alter table public.preferred_drivers add constraint preferred_drivers_pkey PRIMARY KEY (id);
alter table public.push_subscriptions add constraint push_subscriptions_endpoint_key UNIQUE (endpoint);
alter table public.push_subscriptions add constraint push_subscriptions_owner_type_check CHECK ((owner_type = ANY (ARRAY['rider'::text, 'driver'::text])));
alter table public.push_subscriptions add constraint push_subscriptions_pkey PRIMARY KEY (id);
alter table public.ride_chat add constraint ride_chat_pkey PRIMARY KEY (id);
alter table public.rider_verifications add constraint rider_verifications_pkey PRIMARY KEY (id);
alter table public.riders add constraint riders_identity_verification_status_check CHECK ((identity_verification_status = ANY (ARRAY['pending'::text, 'verifying'::text, 'verified'::text, 'failed'::text, 'needs_review'::text])));
alter table public.riders add constraint riders_pkey PRIMARY KEY (id);
alter table public.riders add constraint riders_verification_status_check CHECK ((verification_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
alter table public.rides add constraint rides_cancellation_payment_status_check CHECK (((cancellation_payment_status IS NULL) OR (cancellation_payment_status = ANY (ARRAY['not_required'::text, 'cancel_pending'::text, 'cancelled'::text, 'cancel_failed'::text]))));
alter table public.rides add constraint rides_payment_status_check CHECK (((payment_status IS NULL) OR (payment_status = ANY (ARRAY['pending'::text, 'authorized'::text, 'capture_pending'::text, 'captured'::text, 'succeeded'::text, 'capture_failed'::text, 'not_required'::text, 'failed'::text]))));
alter table public.rides add constraint rides_pkey PRIMARY KEY (id);
alter table public.safety_reports add constraint safety_reports_pkey PRIMARY KEY (id);
alter table public.saved_places add constraint saved_places_pkey PRIMARY KEY (id);
alter table public.support_cases add constraint support_cases_pkey PRIMARY KEY (id);
alter table public.system_flags add constraint system_flags_pkey PRIMARY KEY (key);
alter table public.tips add constraint tips_pkey PRIMARY KEY (id);
alter table public.trip_events add constraint trip_events_pkey PRIMARY KEY (id);
alter table public.trip_timelines add constraint trip_timelines_pkey PRIMARY KEY (id);
alter table public.usage_counters add constraint usage_counters_pkey PRIMARY KEY (key);
alter table public.verification_codes add constraint verification_codes_pkey PRIMARY KEY (id);

alter table public.autonomous_pilot_events add constraint autonomous_pilot_events_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id);
alter table public.autonomous_provider_reservations add constraint autonomous_provider_reservations_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id);
alter table public.delivery_order_items add constraint delivery_order_items_delivery_order_id_fkey FOREIGN KEY (delivery_order_id) REFERENCES delivery_orders(id) ON DELETE CASCADE;
alter table public.delivery_status_events add constraint delivery_status_events_delivery_order_id_fkey FOREIGN KEY (delivery_order_id) REFERENCES delivery_orders(id) ON DELETE CASCADE;
alter table public.dispatches add constraint dispatches_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE;
alter table public.driver_earnings add constraint driver_earnings_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE;
alter table public.driver_earnings add constraint driver_earnings_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL;
alter table public.driver_earnings add constraint driver_earnings_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE SET NULL;
alter table public.driver_earnings add constraint driver_earnings_rider_id_fkey FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE SET NULL;
alter table public.driver_locations add constraint driver_locations_driver_fk FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE;
alter table public.driver_locations add constraint driver_locations_session_fk FOREIGN KEY (session_id) REFERENCES driver_sessions(id) ON DELETE SET NULL;
alter table public.driver_payouts add constraint driver_payouts_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE;
alter table public.driver_payouts add constraint driver_payouts_earning_id_fkey FOREIGN KEY (earning_id) REFERENCES driver_earnings(id) ON DELETE SET NULL;
alter table public.driver_sessions add constraint driver_sessions_driver_fk FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE;
alter table public.missions add constraint missions_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE;
alter table public.payments add constraint payments_ride_id_fkey FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE SET NULL;
alter table public.rides add constraint rides_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL;
alter table public.rides add constraint rides_pilot_zone_id_fkey FOREIGN KEY (pilot_zone_id) REFERENCES autonomous_pilot_zones(id) ON DELETE SET NULL;
alter table public.trip_timelines add constraint trip_timelines_ride_fk FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE;

CREATE INDEX idx_driver_offers_driver_id ON public.driver_offers USING btree (driver_id);
CREATE INDEX idx_driver_offers_ride_id ON public.driver_offers USING btree (ride_id);
CREATE INDEX idx_drivers_geog ON public.drivers USING gist (geog);
CREATE INDEX payments_rider_id_idx ON public.payments USING btree (rider_id);
CREATE INDEX payments_status_idx ON public.payments USING btree (status);
CREATE INDEX rides_payment_id_idx ON public.rides USING btree (payment_id);
CREATE INDEX rides_rider_id_idx ON public.rides USING btree (rider_id);
CREATE INDEX rides_status_idx ON public.rides USING btree (status);
CREATE INDEX idx_audit_logs_action ON public.audit_logs USING btree (action);
CREATE UNIQUE INDEX admin_roles_email_unique_idx ON public.admin_roles USING btree (lower(email));
CREATE UNIQUE INDEX autonomous_pilot_events_provider_event_id_idx ON public.autonomous_pilot_events USING btree (provider_event_id) WHERE (provider_event_id IS NOT NULL);
CREATE UNIQUE INDEX deletion_requests_one_pending_per_user ON public.deletion_requests USING btree (user_type, user_id) WHERE (status = 'pending'::text);
CREATE UNIQUE INDEX rides_htaf_application_id_unique ON public.rides USING btree (htaf_application_id) WHERE (htaf_application_id IS NOT NULL);
CREATE UNIQUE INDEX rides_quote_jti_unique ON public.rides USING btree (quote_jti) WHERE (quote_jti IS NOT NULL);
CREATE UNIQUE INDEX uq_preferred_driver_pair ON public.preferred_drivers USING btree (rider_id, driver_id);
-- (Production's remaining non-unique secondary indexes only affect
-- performance, not behaviour, and are omitted.)

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.drivers_sync_geog()
 RETURNS trigger LANGUAGE plpgsql
AS $function$
begin
  if new.current_lat is not null and new.current_lng is not null then
    new.geog := ST_SetSRID(ST_MakePoint(new.current_lng, new.current_lat), 4326)::geography;
  else
    new.geog := null;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.increment_usage_counter(p_key text)
 RETURNS bigint LANGUAGE sql
AS $function$
  insert into public.usage_counters (key, count, updated_at)
  values (p_key, 1, now())
  on conflict (key) do update
    set count = public.usage_counters.count + 1,
        updated_at = now()
  returning count;
$function$;

CREATE OR REPLACE FUNCTION public.increment_rider_session_version(p_rider_id text, p_actor_type text, p_actor_id text, p_action text, p_metadata jsonb, p_ip_address text, p_user_agent text)
 RETURNS riders LANGUAGE plpgsql
AS $function$
declare
  v_rider public.riders%rowtype;
begin
  update public.riders
    set session_version = session_version + 1,
        updated_at      = now()
    where id = p_rider_id
    returning * into v_rider;
  if not found then
    raise exception 'Rider % not found', p_rider_id;
  end if;
  insert into public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata, ip_address, user_agent, created_at)
  values (p_actor_type, p_actor_id, p_action, 'rider', p_rider_id, p_metadata, p_ip_address, p_user_agent, now());
  return v_rider;
end;
$function$;

CREATE OR REPLACE FUNCTION public.nearest_drivers(p_lat double precision, p_lng double precision, p_radius_miles double precision DEFAULT 25, p_limit integer DEFAULT 10)
 RETURNS TABLE(id text, first_name text, last_name text, email text, phone text, current_lat double precision, current_lng double precision, distance_miles double precision)
 LANGUAGE sql STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select
    d.id, d.first_name, d.last_name, d.email, d.phone, d.current_lat, d.current_lng,
    (public.st_distance(d.geog, public.st_setsrid(public.st_makepoint(p_lng, p_lat), 4326)::public.geography) / 1609.34)::double precision as distance_miles
  from public.drivers d
  where d.online = true
    and d.status = 'active'
    and d.approval_status = 'approved'
    and coalesce(d.access_revoked, false) = false
    and d.geog is not null
    and public.st_dwithin(d.geog, public.st_setsrid(public.st_makepoint(p_lng, p_lat), 4326)::public.geography, p_radius_miles * 1609.34)
    and not exists (
      select 1 from public.rides r
      where r.driver_id = d.id
        and r.status in ('driver_assigned', 'driver_enroute', 'arrived', 'in_progress')
    )
  order by d.geog operator(public.<->) public.st_setsrid(public.st_makepoint(p_lng, p_lat), 4326)::public.geography
  limit p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.dispatch_ride_atomic(p_ride_id text, p_driver_id text, p_expires_seconds integer DEFAULT 30)
 RETURNS TABLE(offer_id text, outcome text)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
#variable_conflict use_column
declare
  v_ride     public.rides%rowtype;
  v_offer_id text;
  v_attempt  integer;
begin
  if p_ride_id is null or p_driver_id is null then
    raise exception 'dispatch_ride_atomic: p_ride_id and p_driver_id are required' using errcode = '22023';
  end if;

  select r.* into v_ride from public.rides r where r.id = p_ride_id for update;

  if not found then
    return query select null::text, 'ride_not_found'::text;
    return;
  end if;

  if v_ride.driver_id is not null
     or v_ride.status not in ('payment_authorized', 'awaiting_driver_acceptance') then
    return query select null::text, 'ride_not_dispatchable'::text;
    return;
  end if;

  if exists (
    select 1 from public.driver_offers o
    where o.ride_id = p_ride_id and o.status = 'pending' and o.expires_at > pg_catalog.now()
  ) then
    return query select null::text, 'ride_has_live_offer'::text;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('dispatch_driver:' || p_driver_id));

  if exists (
    select 1 from public.rides r
    where r.driver_id = p_driver_id
      and r.status in ('driver_assigned', 'driver_enroute', 'arrived', 'in_progress')
  ) or exists (
    select 1 from public.driver_offers o
    where o.driver_id = p_driver_id and o.status = 'pending' and o.expires_at > pg_catalog.now()
  ) or exists (
    select 1 from public.driver_offers o
    join public.rides r on r.id = o.ride_id
    where o.driver_id = p_driver_id
      and o.status = 'accepted'
      and r.status not in ('completed', 'cancelled', 'failed')
      and (r.driver_id is null or r.driver_id = p_driver_id)
  ) or not exists (
    select 1 from public.drivers d
    where d.id = p_driver_id
      and d.online = true
      and d.status = 'active'
      and d.approval_status = 'approved'
      and coalesce(d.access_revoked, false) = false
  ) then
    return query select null::text, 'driver_no_longer_available'::text;
    return;
  end if;

  v_attempt := greatest(coalesce(v_ride.dispatch_attempts, 0), 1);
  v_offer_id := 'OFFER-' || pg_catalog.upper(pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 10));

  insert into public.driver_offers (id, ride_id, driver_id, status, attempt, expires_at, created_at, updated_at)
  values (v_offer_id, p_ride_id, p_driver_id, 'pending', v_attempt,
          pg_catalog.now() + pg_catalog.make_interval(secs => p_expires_seconds), pg_catalog.now(), pg_catalog.now());

  update public.rides
    set status = 'awaiting_driver_acceptance',
        dispatch_status = 'offer_sent',
        dispatch_attempts = v_attempt,
        updated_at = pg_catalog.now()
    where id = p_ride_id;

  return query select v_offer_id, 'created'::text;
end;
$function$;

CREATE OR REPLACE FUNCTION public.accept_driver_offer_atomic(p_offer_id text, p_driver_id text)
 RETURNS TABLE(outcome text, ride_id text, offer_id text, driver_id text, ride_status text, rider_id text, rider_phone text, ride_type text, is_review_ride boolean, driver_name text, driver_vehicle text, driver_phone text)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
#variable_conflict use_column
declare
  v_offer_ride_id text;
  v_offer         public.driver_offers%rowtype;
  v_ride          public.rides%rowtype;
  v_driver        public.drivers%rowtype;
  v_now           timestamptz := pg_catalog.now();
begin
  if p_offer_id is null or p_driver_id is null then
    raise exception 'accept_driver_offer_atomic: p_offer_id and p_driver_id are required' using errcode = '22023';
  end if;

  select o.ride_id into v_offer_ride_id from public.driver_offers o where o.id = p_offer_id;
  if not found then
    outcome := 'offer_not_found'; return next; return;
  end if;

  select r.* into v_ride from public.rides r where r.id = v_offer_ride_id for update;

  perform 1 from public.driver_offers o where o.ride_id = v_offer_ride_id order by o.id for update;

  select o.* into v_offer from public.driver_offers o where o.id = p_offer_id;
  if not found then
    outcome := 'offer_not_found'; return next; return;
  end if;

  if v_offer.driver_id is distinct from p_driver_id then
    outcome := 'not_offer_owner'; return next; return;
  end if;

  if v_offer.status = 'accepted' then
    if v_ride.id is not null
       and v_ride.driver_id = p_driver_id
       and v_ride.status in ('driver_assigned', 'driver_enroute', 'arrived', 'in_progress') then
      outcome := 'already_accepted'; ride_id := v_ride.id; offer_id := v_offer.id;
      driver_id := p_driver_id; ride_status := v_ride.status;
      return next; return;
    end if;
    outcome := 'offer_not_pending'; return next; return;
  end if;

  if v_offer.status <> 'pending' then
    outcome := 'offer_not_pending'; return next; return;
  end if;

  if v_offer.expires_at is not null and v_offer.expires_at <= v_now then
    outcome := 'offer_expired'; return next; return;
  end if;

  if v_ride.id is null
     or v_ride.driver_id is not null
     or v_ride.status not in ('payment_authorized', 'awaiting_driver_acceptance') then
    outcome := 'ride_not_assignable'; return next; return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('dispatch_driver:' || p_driver_id));

  select d.* into v_driver from public.drivers d where d.id = p_driver_id;

  if not found
     or v_driver.approval_status is distinct from 'approved'
     or coalesce(v_driver.access_revoked, false) then
    outcome := 'driver_unavailable'; return next; return;
  end if;

  if exists (
    select 1 from public.rides r
    where r.driver_id = p_driver_id and r.id <> v_ride.id
      and r.status in ('driver_assigned', 'driver_enroute', 'arrived', 'in_progress')
  ) or exists (
    select 1 from public.driver_offers o
    join public.rides r on r.id = o.ride_id
    where o.driver_id = p_driver_id and o.status = 'accepted' and o.ride_id <> v_ride.id
      and r.status not in ('completed', 'cancelled', 'failed')
      and (r.driver_id is null or r.driver_id = p_driver_id)
  ) then
    outcome := 'driver_unavailable'; return next; return;
  end if;

  update public.driver_offers o set status = 'accepted', responded_at = v_now, updated_at = v_now where o.id = v_offer.id;
  update public.driver_offers o set status = 'superseded', updated_at = v_now
    where o.ride_id = v_ride.id and o.id <> v_offer.id and o.status = 'pending';

  update public.rides r
    set driver_id = p_driver_id,
        status = 'driver_assigned',
        dispatch_status = 'accepted',
        accepted_at = v_now,
        driver_name = coalesce(
          nullif(pg_catalog.concat_ws(' ', nullif(v_driver.first_name, ''), nullif(v_driver.last_name, '')), ''),
          nullif(v_driver.name, ''), nullif(v_driver.full_name, ''), 'Driver'),
        driver_vehicle = pg_catalog.concat_ws(' ', nullif(v_driver.vehicle_year, ''), nullif(v_driver.vehicle_make, ''), nullif(v_driver.vehicle_model, '')),
        driver_phone = coalesce(nullif(v_driver.phone, ''), nullif(v_driver.phone_number, '')),
        updated_at = v_now
    where r.id = v_ride.id
    returning r.* into v_ride;

  outcome := 'accepted'; ride_id := v_ride.id; offer_id := v_offer.id; driver_id := p_driver_id;
  ride_status := v_ride.status; rider_id := v_ride.rider_id; rider_phone := v_ride.rider_phone;
  ride_type := v_ride.ride_type; is_review_ride := v_ride.is_review_ride;
  driver_name := v_ride.driver_name; driver_vehicle := v_ride.driver_vehicle; driver_phone := v_ride.driver_phone;
  return next;
end;
$function$;

CREATE TRIGGER trg_riders_updated_at BEFORE UPDATE ON public.riders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_drivers_updated_at BEFORE UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_driver_earnings_updated_at BEFORE UPDATE ON public.driver_earnings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_drivers_sync_geog BEFORE INSERT OR UPDATE OF current_lat, current_lng ON public.drivers FOR EACH ROW EXECUTE FUNCTION drivers_sync_geog();

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
