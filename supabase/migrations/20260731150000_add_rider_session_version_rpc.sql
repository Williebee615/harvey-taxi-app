-- Atomic rider-session-invalidation function. Backs the rider
-- self-logout route (POST /api/rider/session/logout) added in this PR,
-- and will also back the approved admin "Force Logout" action (a later
-- PR) -- both need to bump riders.session_version and record an
-- audit_logs event as a single atomic fact, the same gap already
-- closed for driver compliance overrides in
-- 20260730180000_add_driver_override_atomic_functions.sql.
--
-- Doing the UPDATE and the audit INSERT in one plpgsql function body
-- means Postgres runs them as one transaction: if the INSERT fails for
-- any reason, the exception aborts the whole call and the session_version
-- bump rolls back with it. Without this, a rider or admin logout could
-- succeed at actually invalidating every outstanding session token
-- while the audit record proving it happened silently failed to save --
-- unacceptable for an action whose entire purpose is a defensible,
-- auditable revocation event.
--
-- Idempotent: safe to re-run against an environment where this has
-- already been applied.

create or replace function public.increment_rider_session_version(
  p_rider_id text,
  p_actor_type text,
  p_actor_id text,
  p_action text,
  p_metadata jsonb,
  p_ip_address text,
  p_user_agent text
)
returns public.riders
language plpgsql
as $function$
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

  insert into public.audit_logs (
    actor_type, actor_id, action, entity_type, entity_id,
    metadata, ip_address, user_agent, created_at
  ) values (
    p_actor_type, p_actor_id, p_action, 'rider', p_rider_id,
    p_metadata, p_ip_address, p_user_agent, now()
  );

  return v_rider;
end;
$function$;
