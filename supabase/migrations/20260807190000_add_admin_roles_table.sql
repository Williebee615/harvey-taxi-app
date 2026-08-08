-- Admin RBAC Phase 1: additive role infrastructure only (docs/
-- security-remediation/admin-rbac-phase1-foundation.md). Per the
-- approved architecture (admin-rbac-architecture-audit.md), this is
-- step 1 of the six-phase no-lockout rollout: "Add role infrastructure
-- without removing the flat model yet." Nothing in server.js reads
-- from this table yet -- requireAdmin still grants full access exactly
-- as it does today, so this migration cannot introduce a lockout by
-- itself: there is no code path that consults it.
--
-- This table does not replace or touch the existing flat admin
-- credential model (ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_API_TOKEN env
-- vars, checked inline in requireAdmin()). It exists so a later phase
-- (shadow-mode logging, then per-route-group enforcement) has a real,
-- persistent place to look up a specific admin's granted role once
-- enforcement begins, instead of inventing that lookup at the same
-- time enforcement is flipped on.
--
-- Backfill: the one admin identity this codebase has today
-- (confirmed via the exposure review in admin-drivers-riders-
-- exposure-review.md -- every admin_login_success row's actor_id)
-- is seeded as super_admin, matching "preserve the existing
-- administrator as super_admin" and the architecture doc's own
-- backfill requirement. ON CONFLICT DO NOTHING makes this safe to
-- re-run and safe if the row already exists from a prior partial
-- apply.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CHECK constraint names are
-- stable, unique index uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS admin_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admin_roles_role_check CHECK (
    role IN (
      'super_admin',
      'htaf_caseworker',
      'dispatcher',
      'support',
      'finance',
      'compliance'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS admin_roles_email_unique_idx
  ON admin_roles (lower(email));

-- RLS: this table is administrative metadata, never read by client-side
-- code (nothing in public/ ever will, and no phase of this rollout
-- reads it from anywhere but the trusted backend's service-role
-- client). Enabling RLS with no policies means only the service role
-- (which bypasses RLS) can touch it -- anon/authenticated get nothing,
-- matching the pattern already used for other admin-only tables in
-- this codebase.
ALTER TABLE admin_roles ENABLE ROW LEVEL SECURITY;

INSERT INTO admin_roles (email, role)
VALUES ('williebee@harveytaxiservice.com', 'super_admin')
ON CONFLICT (lower(email)) DO NOTHING;
