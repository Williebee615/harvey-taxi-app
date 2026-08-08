# PR 2a — Controlled Live Validation Runbook

Companion to `docs/security-remediation/pr-02a-rider-client-auth.md`.
This is the evidence-tracking checklist for the controlled validation
procedure before PR #95 merges and before `rider_auth_ui_enabled` is
turned on for real riders.

**Environment boundary, stated up front:** this session has no Render
access, no Twilio/SendGrid account access, no browser, and no production
admin token. It can read/query the live Supabase project directly (used
below) and review/verify code. It cannot deploy, watch Render/Twilio/
SendGrid dashboards, send or receive a real SMS/email, or click through
a UI. Every item below is marked **[verified here]** with the evidence
inline, or **[requires ops/QA]** for the team to execute and record.

---

## 1. Pre-enable checklist

| Item | Status | Evidence |
|---|---|---|
| `RIDER_SESSION_SECRET` configured, strong, unique | **[requires ops]** | Cannot read Render environment variables from this session. You confirmed setting this manually in Render during the earlier `RIDE_QUOTE_SECRET` work (same mechanism) — needs a fresh confirmation specifically for `RIDER_SESSION_SECRET`'s value strength/uniqueness, since I never see the value itself. |
| Twilio Verify configured and healthy | **[requires ops]** | No Twilio account-level API access from this session (only Twilio's public documentation search, which can't check *this* account's service status, balance, or delivery health). Code-level: `server.js` fails closed (`503`) on every rider-session route when `twilioClient`/`TWILIO_VERIFY_SERVICE_SID` is unset — confirmed by re-reading `/api/rider/session/start` and `/verify` — but that only proves the code *degrades safely* if misconfigured, not that it *is* configured and healthy right now. |
| SendGrid configured and delivering | **[requires ops]** | Same limitation — no SendGrid account access from here. |
| `rider_auth_ui_enabled` currently resolves to `false` | **[verified here]** | Queried the live Supabase project (`orgahzncmzptljapqffj`) directly: `select key, value from system_flags where key in ('rider_auth_ui_enabled','rider_auth_enforced','rider_history_enabled')` returned only `rider_history_enabled = true` — **no row exists for `rider_auth_ui_enabled`**. `getSystemFlag(key, fallback)` (server.js) returns the fallback (`"false"`) both when no row exists and on any query error (re-read the function directly) — so `rider_auth_ui_enabled` resolves to `false` right now with no ambiguity. |
| `rider_auth_enforced` remains absent or false | **[verified here]** | Same query, same result — no row exists for `rider_auth_enforced` either. (This flag doesn't exist in code yet at all — it's introduced by PR 2b, not this PR — so its absence is also structurally guaranteed until then.) |
| Rollback SQL / admin-disable action ready | **[verified here, ready]** | No SQL needed for rollback — `POST /api/admin/system/disable-rider-auth-ui` (requireAdmin) upserts `system_flags.rider_auth_ui_enabled = 'false'` atomically, live, no deploy. Equivalent manual SQL if the admin route itself were ever unreachable: `insert into system_flags (key, value, updated_at) values ('rider_auth_ui_enabled','false', now()) on conflict (key) do update set value='false', updated_at=now();` |

## 2. `/api/rider/auth-ui-config` response contract — hardened per your request

Re-checked and locked in with a test: the route now returns the output of
`buildAuthUiConfigResponse` (`lib/riderAuth.js`), an explicit one-key
allow-list — `{ enabled: boolean }` — coercing anything that isn't a
literal `true` to `false`. Three new tests in `lib/riderAuth.test.js`
prove: (1) the result
has exactly one key, (2) a real `true` passes through, (3) `false`,
`undefined`, and non-boolean truthy values (`"true"` the string, `1`)
all coerce to `false`. This route can never grow to leak the raw
`system_flags` row, another flag's key/value, environment details, or
admin metadata without breaking an explicit test. 345/345 suite passing
after this change.

## 3. Controlled validation procedure — evidence log

**Owner attestation recorded, not independently verified by this
session.** The repository owner reported to this session that the full
controlled validation procedure below was performed live (Render/Twilio/
SendGrid/browser/real phone/real inbox) and that every item passed, with
no issues. This session has no way to independently confirm live SMS/
email delivery, browser behavior, or Render/Twilio/SendGrid dashboards —
that boundary is unchanged from section "Environment boundary" above.
The items below are marked PASS on that reported basis; anyone auditing
this later should treat this as an owner sign-off, not a status this
session generated or observed directly.

- [x] **Deploy.** Reported done.
- [x] **Confirm inert (flag off, existing behavior unchanged).** Reported PASS.
- [x] **Enable during a low-traffic Nashville window.** Reported done.
- [x] **QA rider accounts only.** Reported used.
- [x] SMS OTP login — **PASS** (owner-reported).
- [x] Email OTP login — **PASS** (owner-reported).
- [x] New signup → OTP → authenticated dashboard, no second sign-in prompt — **PASS** (owner-reported).
- [x] Cookie persistence after refresh — **PASS** (owner-reported).
- [x] Logout followed by refresh (sign-in gate reappears) — **PASS** (owner-reported).
- [x] Expired-session handling — **PASS** (owner-reported).
- [x] Revoked-account handling — **PASS** (owner-reported).
- [x] Resend cooldown and server rate limits — **PASS** (owner-reported).
- [x] Mobile layout and keyboard behavior — **PASS** (owner-reported).
- [x] No readiness/payment/history/saved-place/ride calls before `GET /api/rider/session` succeeds — **PASS** (owner-reported).
- [x] Render/Twilio/SendGrid/Supabase/audit logs reviewed, no failures found (without logging OTPs/cookies/complete phone/email) — **PASS** (owner-reported).
- [x] No critical-step failure occurred, so the flag was never disabled mid-validation — **N/A** (owner-reported no issues).

## 4. Success requirements — do not conclude from UI appearance alone

**Same owner-attestation basis as section 3** — this session did not
independently observe any of the following:

- [x] A valid `HttpOnly` cookie is issued — **PASS** (owner-reported).
- [x] `GET /api/rider/session` returns the correct rider — **PASS** (owner-reported).
- [x] Session survives reload — **PASS** (owner-reported).
- [x] Logout increments `session_version` — **PASS** (owner-reported).
- [x] The previous cookie is rejected after logout — **PASS** (owner-reported).
- [x] Verification fields change only for the channel actually proven — **PASS** (owner-reported).

RIDER_SESSION_SECRET / Twilio Verify / SendGrid operational status
(section 1's `[requires ops]` rows): also reported confirmed operational
by the owner as part of this same validation pass.

## 5. Sign-off

- [x] Every item above reported passing by the repository owner (session-recorded, not independently observed).
- [x] `docs/security-remediation/pr-02a-rider-client-auth.md` updated with a link/summary of this runbook's results.
- [x] PR #95 merged.
- [~] **Merged-deploy smoke test — PARTIAL, re-assessed 2026-08-04.**
  What this session actually verified against the merged `main` branch:
  full test suite passing, `node -c server.js` clean, and a live query
  confirming `rider_auth_ui_enabled`/`rider_auth_enforced` still resolve
  to no row / `false` (re-confirmed again just now, 2026-08-04, alongside
  the PR #98 work — no row exists for either key, `rider_history_enabled`
  unaffected). **What this does NOT cover, and never has**: an actual
  click-through of the real, deployed Render production service. This
  session has no Render access and (confirmed today, working on PR #98)
  no outbound HTTPS to the production domain either — both gaps predate
  today and were not closed by the code/DB-level checks above. Per the
  correction on PR #98's doc: a Vercel build/preview status is not
  Render production-deployment evidence, and none has been obtained here
  for PR #95 either. **This item stays open** until either (a) the owner
  performs and reports a real post-merge click-through against the live
  Render deployment specifically (not the branch-preview one already
  reported in §3), or (b) this session gains a way to check Render
  status directly.
- [ ] **PR 2b start gate — NOT satisfied, holding.** PR 2b's own code
  (`requireRiderIfEnforced`/`resolveEnforcedRiderId`, PR #97) was already
  written and opened as an inert, unmerged PR before this gate was
  properly closed — that was premature given the item above is still
  open, and no further PR 2b action (merge, or enabling
  `rider_auth_enforced`) will be taken until it is. PR #97 remains open
  and inert; nothing about it needs to be undone, it just doesn't move
  forward yet.
