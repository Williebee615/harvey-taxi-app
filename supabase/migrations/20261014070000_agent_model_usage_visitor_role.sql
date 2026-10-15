-- Assistant pilot (docs/assistant-platform-architecture.md): model
-- answers for signed-out website visitors are recorded in the same usage
-- ledger and count against the same monthly ceiling. The ledger's role
-- check allowed only rider/driver/admin, so a visitor answer could not be
-- settled. This adds 'visitor'. No data changes; the ceiling is unchanged.
--
-- NOT APPLIED. Applying it is required before the pilot's model mode can
-- be switched on, and needs owner approval.

alter table public.agent_model_usage drop constraint if exists agent_model_usage_role_check;
alter table public.agent_model_usage
  add constraint agent_model_usage_role_check check (role in ('rider', 'driver', 'admin', 'visitor'));
