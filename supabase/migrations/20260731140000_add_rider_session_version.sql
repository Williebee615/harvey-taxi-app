-- Second PR of the approved rider-authentication implementation
-- sequence (docs/rider-auth-design-proposal.md). Adds the one schema
-- change real session revocation needs.
--
-- lib/riderAuth.js's session tokens are stateless and self-signed --
-- valid until their embedded expiry no matter what. session_version is
-- what actually makes logout, an admin Force Logout, or an
-- access_revoked deletion take effect immediately: each of those bumps
-- this column by 1 in a single atomic UPDATE, which invalidates every
-- token issued before that bump (requireRider checks the token's
-- session_version against this column's live value -- see
-- isSessionVersionCurrent() in lib/riderAuth.js). No session table, no
-- denylist to grow or clean up.
--
-- No system_flags row is seeded here for rider_auth_enforced --
-- getSystemFlag() already defaults an absent key to "false" (the same
-- fallback rider_history_enabled/dispatch_paused/
-- offer_expiry_sweep_enabled all rely on), so the flag simply doesn't
-- exist until an admin route explicitly upserts it, exactly like those
-- other flags.

alter table public.riders
  add column if not exists session_version integer not null default 0;
