# Post-deployment exposure review: admin drivers/riders `select("*")`

This is the follow-up review requested after PR #109 (merged) replaced
`select("*")` with explicit allow-lists on `GET /api/admin/drivers` and
`GET /api/admin/riders`. It documents the exposure window and reviews
the available audit trail for evidence of access by anyone other than
the intended administrator. It makes no code changes and forces no
credential rotation.

## 1. Confirming the fix landed correctly

Checked directly against `main` after the PR #109 merge (commit
`37c8e22`):

- `GET /api/admin/drivers` (`server.js`, the `/api/admin/drivers` list
  route) calls `.select(ADMIN_DRIVERS_LIST_FIELDS.join(","))`.
- `GET /api/admin/riders` (`server.js`, the `/api/admin/riders` list
  route) calls `.select(ADMIN_RIDERS_LIST_FIELDS.join(","))`.
- Neither route contains `select("*")` anymore (other `select("*")`
  calls remain elsewhere in `server.js`, for unrelated routes outside
  this PR's scope).
- `lib/adminDirectory.test.js`'s regression tests (forbidden-field
  checks against both allow-lists, plus the built select-strings) pass:
  15 suites, 399 tests, all green.
- No `GET /api/admin/drivers/:id` or `GET /api/admin/riders/:id` detail
  endpoint was added, per the instruction to only add one if a real
  workflow demonstrably needs it -- none was found. This should stay
  the default until a concrete workflow proves otherwise.

## 2. Exposure window

**Start:** Both routes have called `.from("drivers"/"riders").select("*")`
since the earliest commit in this repository's tracked git history --
`51c7c4d`, dated 2026-06-15 05:34:09 -0500. There is no earlier commit
to check; this is the practical start of the exposure window as far as
this repository's history can establish. (It cannot rule in or out
whether this code existed, in the same form, in an earlier untracked
history before this repository began.)

**End:** PR #109's merge commit, `37c8e22`, dated 2026-08-07 13:09:30
-0500.

**Window:** approximately 2026-06-15 through 2026-08-07 -- about 53
days, for as long as this codebase's git history can attest.

This session has no access to Render (or other hosting) deploy history,
so it cannot independently confirm the exact moment production started
serving the fixed code versus the merge timestamp above. If `main`
auto-deploys on push, the two should be close together, but that
assumption isn't verified here.

## 3. What the audit trail can and cannot show

`requireAdmin` accepts three equally-privileged credentials: a shared
`X-Admin-Token` header, `X-Admin-Email`/`X-Admin-Password` headers
checked directly on every request, or a signed session cookie issued by
`POST /api/admin/login`. Reviewing what each path actually leaves
behind in `audit_logs`:

- **No route-level audit entry exists for either `GET /api/admin/drivers`
  or `GET /api/admin/riders`.** The codebase only calls `auditLog()` for
  a fixed set of write/authentication actions (login, approvals,
  exports, account deletion, etc. -- see the `action:` call sites in
  `server.js`); reads of these two list routes were never logged, before
  or after this fix.
- **The `X-Admin-Token` and direct-header (`X-Admin-Email`/
  `X-Admin-Password`) paths leave no audit trail at all.** Both are
  checked inline in `requireAdmin` on every request; neither passes
  through the `/api/admin/login` route, which is the only place
  `admin_login_success`/`admin_login_failed` get written.
- **Even the login events that do exist carry no IP address or
  user-agent.** The two `auditLog()` calls in `POST /api/admin/login`
  omit the `req` parameter, so `ip_address` and `user_agent` are written
  as `null` for every row -- there is no IP data to check for anything
  unexpected, for any admin login, ever.
- **Audit logging itself doesn't cover the full exposure window.** The
  `audit_logs` table's earliest row is 2026-07-04 07:06:25 UTC -- about
  19 days after the exposure window's start (2026-06-15). Whatever
  happened with these routes in that first ~19-day span left no record
  in this table one way or the other.

Given this, the honest scope of what can be checked is: every
`admin_login_success`/`admin_login_failed` row from 2026-07-04 onward,
with actor email but no IP/user-agent, and no way to link a login event
to which admin routes were subsequently called in that session.

## 4. What was found

Querying `audit_logs` for `action in ('admin_login_success',
'admin_login_failed')` across the full available range
(2026-07-04 through 2026-08-07) returned 23 rows:

- **19 `admin_login_success` rows**, spanning 2026-07-08 through
  2026-08-07, all with `actor_id = "williebee@harveytaxiservice.com"`
  -- the configured admin email. This is consistent with one
  administrator logging in repeatedly (sometimes several times in a
  day) over roughly a month.
- **4 `admin_login_failed` rows**:
  - 2026-07-23 01:55:15 and 01:55:18 -- `actor_id =
    "admin@harveytaxi.com"`, a different address on a similar but
    distinct domain.
  - 2026-07-23 01:55:43 and 01:55:46 -- `actor_id =
    "williebee@harveytaxiservice.comw"`, the correct address with a
    stray trailing "w".
  - 2026-08-05 03:12:51 and 2026-08-05 16:08:23 -- `actor_id =
    "williebee@harveytaxiservice.com"` (correct email, wrong password),
    each followed within seconds/minutes by a successful login with the
    same email.

All four failures on 2026-07-23 occurred within a 31-second window and
read as the same person fumbling a login (two guesses at an
email/domain variant, then two attempts at the right address with a
typo) rather than a distinct external actor -- but audit logs alone
cannot prove that; there is no IP or session data to corroborate it.

**No `actor_id` value outside these five (one correct address, three
recognizable typos/variants of it, and no other identity) appears
anywhere in the login audit trail.**

## 5. Conclusion

No evidence was found, in the data actually available, of access by
anyone other than the intended administrator. This is a "no evidence
found" conclusion, not a "confirmed clean" one -- the gaps in section 3
mean a large share of the exposure window and several valid access
paths (the token header, the direct-header path, and the pre-2026-07-04
period) are simply not observable with the current logging. Per
instruction, this review does not force a password reset, verification
secret rotation, or any other credential action: no evidence or other
concrete compromise indicator was found here to justify one. If new
evidence surfaces later (e.g., from a hosting-provider access log this
session didn't have access to), that should be revisited.

No password hash, verification code, or raw identity-provider payload
was printed or copied into this document or into any tool call made
during this review -- only audit-log metadata (action, actor_id,
ip_address, user_agent, created_at) was queried and recorded above.

## 6. Observations for later (not implemented here, no action taken)

These are noted for awareness only; none are in scope for this review
and none should be treated as authorization to implement them:

1. The two `auditLog()` calls in `POST /api/admin/login` don't pass
   `req`, so IP address and user-agent are never captured for any admin
   login, past or future. Passing `req` there would close that gap
   going forward, independent of anything else in this document.
2. The `X-Admin-Token` and direct-header (`X-Admin-Email`/
   `X-Admin-Password`) authentication paths in `requireAdmin` leave zero
   audit trail by design, since they never touch `/api/admin/login`.
   Whether that's acceptable is a question for the RBAC/session-hardening
   work already queued (`admin-rbac-architecture-audit.md`), not this
   review.
