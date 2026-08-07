# Admin drivers/riders list data minimization

## Background

The Admin RBAC Architecture & Authorization Audit
(`admin-rbac-architecture-audit.md`) inventoried every `/api/admin/*`
route as a documentation/investigation exercise, not a search for this
issue specifically. While cataloguing what data each route touches, it
surfaced a critical finding: `GET /api/admin/drivers` and
`GET /api/admin/riders` both used `select("*")`, which returns every
column on the row with no filtering. A live, read-only query against
production confirmed this was not theoretical -- real, non-null
`password_hash` values were present (1 driver, 4 riders), alongside raw
SMS/email verification codes and their hashes, and raw Persona/Checkr
webhook payloads. All of this was reachable by anyone holding the
single flat admin credential (`ADMIN_API_TOKEN`, `ADMIN_PASSWORD`, or an
admin session cookie -- `requireAdmin` treats all three identically).

This PR closes that specific exposure. It does not touch admin RBAC,
driver readiness rules, rider auth, verification provider behavior, or
Stripe behavior, and it does not change any production driver/rider
record or any password.

## Scope

- `GET /api/admin/drivers`
- `GET /api/admin/riders`

No other admin route is changed in this PR. `/api/admin/rides`,
`/api/admin/audit-logs`, and `/api/admin/stream` (including its
unscoped SSE broadcast to every connected admin) are a known follow-up,
queued separately and explicitly out of scope here.

## What every live admin page actually reads from these two routes

Before writing an allow-list, every page that calls either route was
read in full to find its actual field usage, so the fix could not break
a real admin workflow:

| Page | Route(s) | Fields actually read |
|---|---|---|
| `public/admin-dashboard.html` | both | drivers: `id`, `first_name`, `last_name`, `email`, `checkr_status`, `approval_status`, `status`, `online`. riders: `id`, `first_name`, `last_name`, `email`, `phone`, `status`, `approval_status` |
| `public/admin-live-dispatch-map.html` | drivers only | `first_name`, `last_name`, `full_name`, `name`, `availability_status`, `online_status`, `status`, `current_address`, `city` |
| `public/admin-home.html` | drivers only | `name`, `email`, `status`, `id` (also references `driver.vehicle`/`driver.plate`, which are not real columns under the current schema -- see "Pre-existing dead fields" below) |
| `public/admin-verification.html` | both | does not consume the actual response shape at all -- see below |

`public/admin-verification.html` calls `fetch('/api/admin/riders')` /
`fetch('/api/admin/drivers')` and then does `riders.map(...)` /
`drivers.map(...)` directly on the parsed JSON body, but both routes
have always returned `{ riders: [...] }` / `{ drivers: [...], page: {...} }`
envelopes, never a bare array. `Array.prototype.map` does not exist on
that object, so this page already throws before it reaches any field
access, independent of this change. It also reads `rider.isVerified`,
`driver.isApproved`, and `rider?.verification?.status`, none of which
are real columns (the schema has `verified`/`approved` booleans and
separate status columns, not those names). This is pre-existing, dead
code unrelated to this fix; it is noted here for completeness and left
alone, consistent with this PR's scope.

**Pre-existing dead fields (noted, not fixed here):** `admin-home.html`
reads `driver.vehicle` and `driver.plate`, but the `drivers` table has
no columns by those names (it has `vehicle_make`, `vehicle_model`,
`vehicle_color`, `vehicle_plate`, `license_plate`). Those two lines have
always rendered blank, with or without this change. Separately,
`admin-dashboard.html`'s `renderHTAF()` reads `a.transportation_need`
and `a.destination`, which stopped being present in the HTAF admin list
response after `htaf-admin-data-minimization.md` (both are detail-only
fields there). Both are out of scope for this PR.

The route handlers themselves (`server.js`) also require `id` and
`created_at` independent of any UI, since keyset pagination
(`encodeCursor` / `decodeCursor` / `applyCursor`) orders on
`(created_at, id)` and encodes the last row's `created_at`/`id` into the
next-page cursor.

## The fix

`lib/adminDirectory.js` defines two explicit column allow-lists,
`ADMIN_DRIVERS_LIST_FIELDS` and `ADMIN_RIDERS_LIST_FIELDS`, containing
only the union of fields above. `server.js`'s two routes now call
`.select(ADMIN_DRIVERS_LIST_FIELDS.join(","))` and
`.select(ADMIN_RIDERS_LIST_FIELDS.join(","))` instead of `select("*")`.
Supabase only returns the named columns, so every other column --
including all of the following -- can no longer appear in either list
response:

- `password`, `password_hash`
- `sms_verification_code`, `sms_code`, `sms_verification_code_hash`
- `email_verification_token`, `email_verification_token_hash`
- `phone_verification_code_hash`
- `persona_last_payload`, `persona_inquiry_id`, `persona_template_id`
- `checkr_last_payload`, `checkr_candidate_id`, `checkr_invitation_id`, `checkr_invitation_url`, `checkr_report_id`
- `verification_payload` (riders)
- `stripe_account_id` (drivers), `stripe_customer_id` (riders)
- `id_last4`, `id_type` (riders)
- `role`, `consents`

Both constants are the single source of truth shared by the `.select()`
calls in `server.js` and the regression tests in
`lib/adminDirectory.test.js`, matching the pattern already used for
`HTAF_ADMIN_LIST_FIELDS` -- a column can't silently reappear in the
list response without a test catching it.

## Why no `GET .../:id` detail endpoint was added

The instruction for this PR was: if a genuinely sensitive field is
needed for a single-driver or single-rider support workflow, add a
scoped detail endpoint rather than restoring it to the bulk list. After
reading every live consumer above, no admin workflow was found that
needs a field outside the new allow-lists -- none of the credential,
verification-secret, raw-payload, or payment-linkage fields are read by
any live page today. No detail endpoint is added in this PR. If a
future admin workflow genuinely needs one of those fields for a single
record, it should get its own `GET /api/admin/drivers/:id` or
`GET /api/admin/riders/:id` route with its own explicit allow-list, not
an expansion of the bulk list.

## What did not change

- No password, verification code, or token was reset or altered.
- No production driver/rider record was modified.
- Admin RBAC (still the flat `requireAdmin` model), driver readiness
  rules, rider auth, verification provider behavior, and Stripe
  behavior are all untouched.
- `PATCH /api/admin/drivers/:id/approve`, `/reject`,
  `/contact-verification-override`, `/compliance-override`, and
  `PATCH /api/admin/riders/:id/approve` are untouched -- they already
  use their own targeted queries, not the list route.

## Testing

- `lib/adminDirectory.test.js` (new): proves neither allow-list ever
  contains any of the forbidden credential/verification/payload/payment
  columns found in the schema, proves both always carry `id` and
  `created_at` for pagination, proves each allow-list is exactly the
  fields the live pages above use (no more), and proves the literal
  `.join(",")` select-string built from each list never contains a
  forbidden column.
- Full suite: `npx jest` -- 15 suites, 399 tests, all passing.
- `node -c server.js` -- syntax check passes.

## Follow-up (queued, not part of this PR)

1. A further data-minimization pass on `/api/admin/rides`,
   `/api/admin/audit-logs`, and `/api/admin/stream` -- the SSE stream
   especially, since it currently broadcasts every event (including at
   least one, `htaf_ride_created`, carrying `rider_name`/`rider_phone`)
   to every connected admin with no scoping, which would undermine
   role-based access once RBAC is implemented.
2. RBAC implementation in phases, per the six-phase rollout strategy in
   `admin-rbac-architecture-audit.md`.
3. Because real password hashes and raw verification codes were
   confirmed present and reachable through the old `select("*")`, this
   should be treated as a security exposure rather than pure cleanup:
   after this fix is deployed, review existing audit/access logs to
   determine whether either endpoint was ever accessed by anyone beyond
   the intended administrator, and document the exposure window.
   Password resets should not be forced unless that review finds
   evidence, or another concrete reason emerges, to justify it.
