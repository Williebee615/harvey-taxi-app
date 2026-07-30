-- Atomic driver-verification-override functions. Backs the two admin
-- routes added for the separation of "administrative approval" from
-- "compliance verification" (docs/production-incidents.md, 2026-07-30
-- entries): PATCH /api/admin/drivers/:id/contact-verification-override
-- and PATCH /api/admin/drivers/:id/compliance-override.
--
-- Why this exists: these two routes previously updated the driver row
-- with one Supabase call, then wrote an audit_logs row with a second,
-- separate call whose failure was silently swallowed
-- (auditLog(...).catch(() => {})). That meant a compliance override
-- could successfully mark a driver's background/identity check as
-- cleared even if the required audit record never saved — unacceptable
-- for a high-risk manual override that exists specifically to create an
-- accountable paper trail.
--
-- Each function below does the driver UPDATE and the audit_logs INSERT
-- inside a single plpgsql function body, which Postgres runs as one
-- transaction: if the INSERT fails for any reason, the exception aborts
-- the whole call and the UPDATE is rolled back with it. server.js calls
-- these via supabase.rpc(...) instead of two separate calls, so "the
-- override applied" and "the override was audited" can no longer
-- diverge.
--
-- Idempotent: safe to re-run against an environment where this has
-- already been applied.

create or replace function public.apply_driver_contact_verification_override(
  p_driver_id text,
  p_email_verified boolean,
  p_phone_verified boolean,
  p_actor_type text,
  p_actor_id text,
  p_action text,
  p_metadata jsonb,
  p_ip_address text,
  p_user_agent text
)
returns public.drivers
language plpgsql
as $function$
declare
  v_driver public.drivers%rowtype;
begin
  update public.drivers
    set email_verified = coalesce(p_email_verified, email_verified),
        phone_verified = coalesce(p_phone_verified, phone_verified),
        updated_at     = now()
    where id = p_driver_id
    returning * into v_driver;

  if not found then
    raise exception 'Driver % not found', p_driver_id;
  end if;

  insert into public.audit_logs (
    actor_type, actor_id, action, entity_type, entity_id,
    metadata, ip_address, user_agent, created_at
  ) values (
    p_actor_type, p_actor_id, p_action, 'driver', p_driver_id,
    p_metadata, p_ip_address, p_user_agent, now()
  );

  return v_driver;
end;
$function$;

create or replace function public.apply_driver_compliance_override(
  p_driver_id text,
  p_checkr_status text,
  p_persona_verified boolean,
  p_actor_type text,
  p_actor_id text,
  p_action text,
  p_metadata jsonb,
  p_ip_address text,
  p_user_agent text
)
returns public.drivers
language plpgsql
as $function$
declare
  v_driver public.drivers%rowtype;
begin
  update public.drivers
    set checkr_status    = coalesce(p_checkr_status, checkr_status),
        persona_verified = coalesce(p_persona_verified, persona_verified),
        updated_at       = now()
    where id = p_driver_id
    returning * into v_driver;

  if not found then
    raise exception 'Driver % not found', p_driver_id;
  end if;

  insert into public.audit_logs (
    actor_type, actor_id, action, entity_type, entity_id,
    metadata, ip_address, user_agent, created_at
  ) values (
    p_actor_type, p_actor_id, p_action, 'driver', p_driver_id,
    p_metadata, p_ip_address, p_user_agent, now()
  );

  return v_driver;
end;
$function$;
