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

Fill in as each step is actually performed. **None of section 3 has been
performed by me** — no browser, phone, or inbox in this environment.

- [ ] **Deploy.** Branch-preview deploy of `security/pr2a-rider-client-auth`, or merge to `main` only if production's `rider_auth_ui_enabled` is confirmed `false` first (confirmed above — currently no row, resolves false).
- [ ] **Confirm inert.** With the flag off, click through `rider-dashboard.html` and `rider-signup.html` as an existing rider; confirm both behave identically to pre-PR-2a (no sign-in overlay, signup shows the payment-method card and direct dashboard link).
- [ ] **Enable during a low-traffic Nashville window.** Record timestamp and who flipped it: ______
- [ ] **QA rider accounts only** — record which account IDs were used (do not record raw phone/email here; reference by rider ID only, consistent with this whole remediation effort's PII-handling discipline).
- [ ] SMS OTP login — pass/fail: ______
- [ ] Email OTP login — pass/fail: ______
- [ ] New signup → OTP → authenticated dashboard, no second sign-in prompt — pass/fail: ______
- [ ] Cookie persistence after refresh — pass/fail: ______
- [ ] Logout followed by refresh (must show sign-in gate again) — pass/fail: ______
- [ ] Expired-session handling — pass/fail: ______
- [ ] Revoked-account handling — pass/fail: ______
- [ ] Resend cooldown (30s client-side) and server rate limits (10/min IP, 3/10min destination on `start`) — pass/fail: ______
- [ ] Mobile layout and keyboard behavior — pass/fail: ______
- [ ] **No readiness/payment/history/saved-place/ride calls before `GET /api/rider/session` succeeds** — verify via browser devtools Network tab, checking request order on a cold load: `auth-ui-config` → (if off, nothing further gated) or `session` → only then `rider/rides`, `rider/deliveries`, `rider/saved-places`, HTAF status. Any of those four firing *before* a `200` from `GET /api/rider/session` is a fail.
- [ ] **Check Render, Twilio, SendGrid, Supabase, and audit logs for errors** — without logging OTPs, cookies, or complete phone/email addresses. Supabase side: I can run `mcp__Supabase__get_logs` (service: `api`/`postgres`/`auth`) and `mcp__Supabase__get_advisors` from this session on request, but Render/Twilio/SendGrid logs need the team.
- [ ] **If login delivery, session establishment, or dashboard boot fails at any point: disable `rider_auth_ui_enabled` immediately** (`POST /api/admin/system/disable-rider-auth-ui`) before continuing to debug.

## 4. Success requirements — do not conclude from UI appearance alone

Each of these needs a specific, verifiable check, not just "the screen
looked right":

- [ ] **A valid `HttpOnly` cookie is issued.** Browser devtools → Application/Storage → Cookies → confirm `harvey_rider_session` is present, `HttpOnly` is checked, `Secure` is checked (production), `SameSite=Lax`. `document.cookie` in the console must **not** show it (proves `HttpOnly`).
- [ ] **`GET /api/rider/session` returns the correct rider.** Compare the returned `rider_id` against the QA account actually signed in with, not just "a" rider_id.
- [ ] **Session survives reload.** Full page reload (not just SPA navigation), confirm dashboard loads without re-prompting.
- [ ] **Logout increments `session_version`.** Query (or have the team query) the rider's row before and after logout: `select session_version from riders where id = '<qa-rider-id>';` — the value must be strictly greater after logout than before.
- [ ] **The previous cookie is rejected after logout.** With the old cookie value saved (devtools) before logging out, manually resubmit a request using that old cookie after logout completes — expect `401`, not success. (`isSessionVersionCurrent` in `lib/riderAuth.js` is what rejects it — already unit-tested for this exact case — but the live end-to-end round trip through the real cookie/route still needs a real check.)
- [ ] **Verification fields change only for the channel actually proven.** After a phone OTP login: `select sms_verified, email_verified from riders where id = '<qa-rider-id>';` — `sms_verified` must be `true`, `email_verified` must be unchanged (still whatever it was before, not flipped to `true`). After an email OTP login on a different/same account: the reverse.

## 5. Sign-off

- [ ] Every item above passes with recorded evidence (not just "looked fine").
- [ ] `docs/security-remediation/pr-02a-rider-client-auth.md` updated with a link/summary of this runbook's results.
- [ ] PR #95 merged.
- [ ] `rider_auth_ui_enabled` left in its controlled (QA-only or off) state until the **merged** deploy is itself smoke-tested — a merge is a new deploy, not a continuation of the branch-preview one.
- [ ] Only then: PR 2b begins, introducing `rider_auth_enforced` (default `false`) and migrating rider-owned routes in small groups, each with its own IDOR regression tests alongside it, per your instruction.
