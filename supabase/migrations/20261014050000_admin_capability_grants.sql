-- Explicit, per-person admin permissions that are separate from a role's
-- built-in authority. First use: drivers.onboarding_review, the
-- permission to use the driver review assistant. It is deliberately not
-- implied by drivers.approve (dispatcher) or by the compliance role.
--
-- The server honors a grant only for the roles in
-- ONBOARDING_REVIEW_GRANT_ROLES (lib/adminRbac.js: dispatcher, compliance);
-- the owner (super_admin) needs no grant. Revoke by setting revoked_at.
-- Server-only: RLS on, no policies, no anon/authenticated access.
--
-- Grant (owner approval; record who approved it):
--   insert into public.admin_capability_grants (email, capability, granted_by, reason)
--   values ('<staff email>', 'drivers.onboarding_review', '<owner email>', '<why>');
-- Revoke:
--   update public.admin_capability_grants set revoked_at = now(), revoked_by = '<owner email>'
--   where lower(email) = lower('<staff email>') and capability = 'drivers.onboarding_review' and revoked_at is null;

create table if not exists public.admin_capability_grants (
  id bigint generated always as identity primary key,
  email text not null check (email = lower(btrim(email)) and email <> ''),
  capability text not null check (capability in ('drivers.onboarding_review')),
  granted_by text not null,
  reason text,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by text,
  check (revoked_at is null or revoked_by is not null)
);

-- At most one active grant per person and capability.
create unique index if not exists admin_capability_grants_active_uniq
  on public.admin_capability_grants (email, capability) where revoked_at is null;

alter table public.admin_capability_grants enable row level security;
revoke all on public.admin_capability_grants from anon, authenticated;
