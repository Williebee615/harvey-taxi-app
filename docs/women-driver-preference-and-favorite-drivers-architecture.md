# Rider Matching Preferences — Architecture Proposal
### (1) "Prefer a Woman Driver", (2) Favorite Drivers / Preferred-Driver Matching, and (3) Direct Driver Requests

**Status: PROPOSAL — NOT APPROVED, NOT IMPLEMENTED.** No code, schema, migration, feature flag, or production data has been touched for any feature described here. This document is the design deliverable requested before any implementation begins, and implementation must not start until this document (or a revised version of it) is explicitly approved.

**Relationship between the three features:** these are three separate rider-facing systems with separate data, separate opt-in mechanics, and separate privacy postures, documented together because they all ultimately touch the same question — "given a rider's relationship to Harvey Taxi's drivers, how should that affect who they get matched with?" Parts A and B (per the original request) are **scoring-only** — they influence ranking within an already-eligible candidate pool, feeding one shared dispatch scoring engine (Part C). Part D (added per explicit follow-up request, after Parts A–C were already drafted) is conceptually different in kind, not just in name: it is an **explicit, single-driver offer initiated by the rider**, not a ranking signal — a favorite-driver boost can make a driver *more likely* to be dispatched next; a direct request *asks that specific driver, and only that driver, and requires their explicit acceptance*. Parts A–C are preserved below exactly as originally written; Part D is new and self-contained, with integration points back into A–C called out explicitly rather than folded into their text.

---

## 0. Ground rule that shapes every section below

Harvey Taxi's dispatch pipeline (`dispatchRide()`, `server.js:9432`) already does exactly one eligibility pass — `findAvailableDrivers()` (`server.js:9116`) filters candidates by `online = true`, `status = active`, `approval_status = approved`, geographic radius, and "not already offered this ride" — and then takes the single nearest candidate (`drivers[0]`) to create one `driver_offers` row via the atomic `dispatch_ride_atomic` RPC. `computeDriverReadiness()` (`lib/driverCompliance.js`) is enforced only when a driver goes online (`POST /api/driver/status`), not re-checked at dispatch time — a driver who is `online/active/approved` in the `drivers` table is, by construction, the population dispatch already trusts.

**Both preference systems in this document are scoring/ranking layers that run *after* that existing eligibility filter and *before* the "take the top candidate" step — never a replacement for it, never a second eligibility gate with different rules.** Concretely: a new function reorders (or re-scores) the array `findAvailableDrivers()` already returns; `dispatchRide()` still just takes index `[0]` of whatever comes out. This is what makes "a preference must never make an otherwise-ineligible driver dispatchable" a structural property of the design rather than a rule someone has to remember to enforce — an ineligible driver is never in the array to begin with, so no reordering step can promote one into contention.

Also confirmed by reading `dispatchRide()` in full: offers are **sequential, not broadcast**. One offer is created for one driver at a time; on decline/expiry (`lib/offerExpiry.js`), the ride is marked `redispatching` and `dispatchRide()` runs again, excluding every driver who already has a `driver_offers` row for that ride. **Neither preference feature may notify multiple drivers at once** — both must work by influencing which single candidate is tried first, letting the existing sequential offer/timeout/redispatch model carry on unchanged after that.

Also confirmed: HTAF rides created via `create_htaf_ride_atomic` (`server.js:17343`) are stamped `dispatch_status: "foundation_authorized"` — a value the scheduled-dispatch sweep's claim filter (`scheduledDispatchClaimFilter()`, `server.js:9778`, matching only `ready_to_dispatch` or a stale `dispatching`) never matches. **HTAF rides do not enter automatic dispatch at all; they require manual admin assignment via `POST /api/admin/rides/:id/assign-driver`.** This resolves the open question from the investigation phase and matters directly for §7 and Part B §11: neither preference layer has any effect on an HTAF ride unless and until an admin action route is also taught to honor it, which is out of scope for v1 of either feature (see §12).

---

# PART A — "Prefer a Woman Driver"

## A.1 Product objective and terminology

**Recommended rider-facing name: "Prefer a woman driver."** Agreeing with the user's own recommendation and reasoning: Harvey Taxi controls *matching and prioritization*, not *guaranteed availability*. "Women only" (or similar absolute language) would imply a guarantee the dispatch system cannot make without either (a) blocking a ride entirely when no participating woman driver is eligible, which the user has explicitly ruled out as a silent default, or (b) lying about who is en route. "Prefer a woman driver" is accurate under both outcomes.

This naming choice cascades into the rest of the design: the preference is implemented as a **scoring input**, never as an **authorization check**. It participates in "which eligible driver goes first," never in "is this driver allowed to take this ride." That is the same identity → authorization → eligibility/readiness → preference scoring → dispatch layering already used throughout this codebase's security work this session (e.g., RBAC Phase 2 never let a proposed role affect a real authorization decision; this preference never lets a proposed match affect a real eligibility decision).

**Internal/schema naming recommendation:** avoid the word "gender" alone in column/field names where "self-identified" isn't also obvious from context, given this is self-reported data with no verification (§A.4). Recommend `driver_gender_identity_optin` (or similar) for the driver's participation record and `prefers_woman_driver` (boolean) for the rider's setting — plain, literal, and hard to misread as something the app verified rather than something the person stated.

## A.2 Existing systems this must be built on (not a parallel system)

| Concern | Existing system | File / location |
|---|---|---|
| Rider identity/auth | `requireRider` session middleware | `server.js:3289` |
| Rider-owned resource pattern (secure) | `/api/rider/htaf-application` | `server.js:12307` |
| Rider-owned resource pattern (insecure — **do not copy**) | `/api/rider/saved-places` (client-supplied `riderId`, no session check) | `server.js:12199` |
| Driver eligibility filter | `findAvailableDrivers()` | `server.js:9116` |
| Dispatch orchestration | `dispatchRide()` | `server.js:9432` |
| Driver readiness/compliance | `computeDriverReadiness()` | `lib/driverCompliance.js` |
| Scheduled-ride timing | `shouldDispatchRideNow()`, `sweepScheduledRides()` | `lib/rideDispatch.js` |
| Feature flags | `system_flags` table, `getSystemFlag()` | `server.js:19542` |
| Admin data-minimization discipline | explicit field allow-lists (no `select("*")`) | `lib/adminDirectory.js` |
| Dormant, unrelated "preference" table — **not to be reused, see §A.9.4** | `preferred_drivers` | `supabase/migrations/20260804210100_...sql` |

No new dispatch engine, no new offer/timeout mechanism, no new driver-eligibility table. The only genuinely new things are: one rider-owned settings resource, one driver-owned opt-in resource, and a scoring function that reorders an already-computed candidate list.

## A.3 Rider preference

- **Setting:** `prefers_woman_driver` boolean on the rider's profile (exact storage TBD — either a new nullable column on `riders`, or a small `rider_preferences` table if more preference fields are anticipated; recommend the latter since Part B also needs rider-scoped preference storage and a single table avoids repeating the same RLS pattern twice — see §C.1). **Default OFF.** Never inferred, defaulted on, or set by anything other than the rider's own explicit action.
- **Route:** `GET/PUT /api/rider/preferences` (or a namespaced `.../preferences/women-driver` if bundled with other settings), gated by `requireRider` exactly like `/api/rider/htaf-application` — **never** a `saved_places`-style client-supplied-riderId route. `req.rider.id` from the verified session is the only source of "whose preference is this."
- **Changeable/removable at any time**, same route, idempotent PUT.
- **Per-ride override:** recommend supporting one. Rationale: a rider's standing preference is a *default*, but a specific trip (e.g., riding with a male friend who has a preference of his own, or an urgent ride where the rider decides speed matters more this one time) is a legitimate reason to deviate for a single request without changing the saved default. Proposed: an optional `prefer_woman_driver` field on the ride-request payload that, if present, overrides the profile default for that one ride only; if absent, the profile default applies. This override must be **rider-supplied at request time from the authenticated rider's own request**, never a value the dispatch system infers.

## A.4 Driver participation

This is the most privacy-sensitive part of the whole feature, and the constraints are absolute, not judgment calls:

- **No inference, ever.** Not from name, photo, uploaded ID, Persona verification data, Checkr results, vehicle info, or any ML/heuristic process. The only legitimate source of "this driver is a participating woman driver" is the driver's own affirmative, explicit action.
- **Opt-in, not opt-out.** A driver who does nothing is simply not part of the matching pool for this preference — exactly symmetric with the rider side.
- **Minimum necessary data.** Recommend storing exactly two facts, nothing more: (1) `participates_in_women_driver_matching` (boolean, default false — the only fact dispatch scoring actually needs), and (2) an explicit consent timestamp/version (`women_driver_program_consent_at`, `consent_version`) so Harvey Taxi can prove *when* and under *what disclosed terms* a driver opted in, which will matter for the legal review in §A.10. Recommend **not** storing an open-ended "gender" free-text field or drawing from any broader identity taxonomy — the only operationally necessary fact is participation in this specific matching program, and minimizing to that fact is both a privacy win and reduces what must be protected.
- **Never exposed to riders or other drivers.** A rider who has the preference on and gets matched to a participating driver never sees a "this driver identifies as a woman" label anywhere in the UI — they see the driver they already see today (name, photo, vehicle, rating). The *only* consumer of `participates_in_women_driver_matching` is the server-side dispatch scoring function. No API response aimed at a rider or another driver may ever include this field — this is an allow-list discipline problem identical to the `lib/adminDirectory.js` pattern, applied to a new surface: define the rider-facing driver-info response shape explicitly and simply never put this field in it, rather than filtering it out defensively after the fact.
- **UI placement:** `public/driver-dashboard.html`'s existing "Driver Profile + Service Capabilities" section (`server.js`... — actually `public/driver-dashboard.html:1003-1041`) is the natural home; it already lists profile/capability toggles (`capRidesBox`, `capFoodBox`, `capGroceryBox` service-type toggles at `driver-dashboard.html:1818-1820`). No existing "settings" or "preferences" section exists in that file today (confirmed by search) — recommend adding a new card in the same visual style as the capabilities card, not repurposing an unrelated one, so the opt-in reads as a distinct, deliberate program rather than a buried checkbox. Route: `GET/PUT /api/driver/women-driver-program`, gated by whatever this codebase's standard driver-authenticated middleware is for self-service profile changes (mirroring the capability-toggle route's auth, not a new pattern).
- **Client-supplied values must never be trusted for eligibility.** The PUT route accepts only the boolean opt-in action from an authenticated driver about themself; it must never accept or trust a client-supplied "eligible" or "participating" flag on any other request (e.g., embedded in a ride-request payload) — same anti-spoofing posture as Part B's anti-abuse section (§B.9) and worth testing identically (§A.13).

## A.5 Dispatch integration

1. `dispatchRide(ride)` already calls `findAvailableDrivers(...)` to get the eligible, radius-filtered, not-previously-offered candidate array.
2. **New, additive step:** if the ride carries an active "prefer a woman driver" signal (per-ride override, else the rider's saved profile default — resolved server-side from `req.rider`/the ride's `rider_id`, never from a client-supplied boolean on the dispatch call itself), pass the candidate array through a new pure function, e.g. `lib/matchingPreferences.js`'s `applyWomanDriverPreference(candidates, { preferenceActive })`, which re-sorts the array so that candidates with `participates_in_women_driver_matching = true` sort ahead of others **while preserving the existing distance-based ordering within each group** (i.e., stable partition, not a full re-sort that ignores distance — the nearest participating driver still beats a farther participating driver).
3. `dispatchRide()` continues to take `candidates[0]` exactly as today. No change to offer creation, timeout, or redispatch logic.
4. This function is pure (no Supabase calls) and independently unit-testable, matching this codebase's established `lib/*.js` + `lib/*.test.js` convention.

**This never bypasses:** `computeDriverReadiness()` (never invoked here, same as today — the candidate pool already reflects `online/active/approved`), Checkr/Persona requirements (enforced at go-online time, unaffected), driver approval, vehicle requirements, availability, geographic eligibility (all already baked into the array this function receives), or accessibility requirements (also already filtered upstream, if/where that filtering exists in `findAvailableDrivers()`).

## A.6 No-driver-available behavior

Never silently drop the preference and never claim a match exists before dispatch actually finds one. Concretely:

- If the reordering step in §A.5 finds **zero** participating, eligible drivers in the candidate array, the array is returned unchanged (i.e., normal nearest-driver dispatch proceeds) — but the *rider* must be told this happened, not left to assume their preference silently worked or silently failed.
- Recommend the ride-request flow surface an explicit choice when the preference is active and the rider is about to be matched to a non-participating driver: **"Continue waiting for a woman driver"** vs. **"Accept the next available driver now."** This requires the rider-facing UI to know, at the moment of matching, whether the specific driver chosen was a preference match — which the existing offer/accept flow can expose today (the ride already surfaces which driver was assigned once an offer is created/accepted) without needing to expose *why* to the rider ("matched because of preference" is an internal scoring fact, not something to show; "this is your assigned driver" is what's shown today regardless of feature).
- "Continue waiting" is a bounded choice, not an indefinite one — recommend it decays to the same next-available-driver behavior after a configurable timeout or after a configurable number of redispatch cycles, so a rider can't be left waiting forever, and so this doesn't become a de facto second offer-timeout system fighting the existing one in `lib/offerExpiry.js`. This needs a product decision on the exact bound; flagged as an open question in §A.14.
- **Never claim a woman driver is available until dispatch has actually identified and offered one.** No predictive/estimated messaging ("a woman driver is nearby") is in scope for v1.
- **Emergency/safety handling takes precedence.** Any existing emergency-dispatch or safety-override path in this codebase must be checked for interaction and, if found, must run entirely independently of this preference — the preference must never delay or gate an emergency response. (Locating and confirming the exact emergency-dispatch code path, if one exists separately from ordinary dispatch, is an open item for before implementation — see §A.14.)

## A.7 Scheduled rides

`sweepScheduledRides()` calls the same `dispatchRide()` at the moment a scheduled ride becomes due — so the reordering step in §A.5 applies unchanged; no separate logic is needed for the scheduled-ride path itself. The one scheduled-ride-specific question is **fallback**: if a scheduled ride was expected (by the rider, informally) to go to a participating driver but none is eligible at dispatch time, the same "continue waiting vs. accept next driver" choice from §A.6 applies — but a scheduled ride has less slack (the rider likely has a real commitment at a real time), so recommend defaulting scheduled rides toward the bounded-wait-then-fallback behavior with a shorter wait bound than an on-demand ride, rather than an open-ended wait. Exact bound is a product decision (§A.14).

## A.8 HTAF

Per §0's confirmed finding, HTAF rides bypass automatic dispatch entirely and are assigned manually by an admin via `POST /api/admin/rides/:id/assign-driver`. Two consequences:

1. **The rider-side preference setting still applies to an HTAF-riding rider as a person** (it's a rider profile fact, not a ride-type-specific one) — but it has **no automatic effect** on an HTAF ride unless the admin-assignment UI/route is explicitly taught to surface it as a hint to the assigning admin. Recommend treating that as a **separate, later, explicitly-opt-in enhancement** (e.g., show the admin "this rider prefers a woman driver" as an informational hint on the assignment screen) rather than part of v1 — keeps the two systems (automatic dispatch scoring vs. manual admin assignment) from being silently coupled.
2. **HTAF eligibility, medical/accessibility needs, safety requirements, and funding rules are entirely unaffected**, since this preference never has authorization power over anything, including who an admin is allowed to assign. Per the user's explicit requirement, this preference must never override HTAF eligibility, medical/accessibility needs, safety requirements, or funding rules — and because the preference is scoring-only and HTAF assignment is a manual admin action outside the scoring path entirely, there is no code path by which it could.

## A.9 Privacy, security, and data model

### A.9.1 Storage

Recommend two additions, both additive/nullable, both under RLS:
- On the rider side: a `rider_preferences` row (or column) holding `prefers_woman_driver boolean not null default false`. See §C.1 for why a shared preferences table with Part B is recommended over one-off columns scattered on `riders`.
- On the driver side: `participates_in_women_driver_matching boolean not null default false`, `women_driver_program_consent_at timestamptz`, `women_driver_program_consent_version text` — either new columns on `drivers` or a small `driver_program_optins` table if more opt-in programs are anticipated later (mirrors the rider-side "one preferences table" reasoning, but not load-bearing either way; a plain column addition to `drivers` is also fine given this is exactly one boolean + provenance, not an open-ended set).

### A.9.2 RLS / authorization rules

- **Rider A must never read or change Rider B's preference.** Enforced two ways, matching this codebase's established defense-in-depth pattern: (1) the route requires `requireRider` and only ever operates on `req.rider.id` from the verified session, never a client-supplied rider id; (2) RLS on the underlying table denies `anon`/`authenticated` roles entirely (service-role-only, same posture as `admin_roles` and `admin_rbac_shadow_log` from the recent RBAC work) — the Express layer is the only thing that can read/write these rows at all, and it always scopes by the session-verified id.
- **Drivers must never be able to manipulate their own eligibility through client-supplied fields.** The opt-in route accepts only the boolean intent from an authenticated driver about themselves; nothing about *dispatch-time* eligibility (online/active/approved/readiness) is ever read from or influenced by anything in this table — it is consulted only as a scoring input over a population already established as eligible by other, unrelated tables/columns.
- **Admin access minimized and audited.** Admin routes that need to see this data (if any — v1 arguably needs none, since dispatch resolves it server-side and no admin workflow requires reading it) should follow the same `lib/adminDirectory.js` explicit-allow-list discipline and go through `auditLog()` on read, exactly like every other admin PII surface hardened this session. Recommend **no new admin UI surface for this data in v1** unless a concrete admin need is identified — the smallest exposure is no exposure.

### A.9.3 Anti-spoofing

A ride-request payload must never be trusted to say "this driver participates" or "this rider prefers X" about anyone other than the authenticated requester's own resolved records — tested explicitly in §A.13.

### A.9.4 Explicit non-reuse of `preferred_drivers`

The dormant `preferred_drivers` table (RLS-hardened in `supabase/migrations/20260804210100_...sql`, confirmed empty, confirmed zero application code references) is a **different concept** — Part B's "favorite driver" relationship, not this feature's demographic-matching preference — and per the user's explicit instruction must not be conflated with this feature. It is not proposed as storage for anything in Part A. Its relationship to Part B is discussed in §B.1.

## A.10 Legal and policy considerations — **flagged for attorney/policy review, not resolved here**

This section identifies areas that need review; it does not and cannot conclude the feature is legally compliant. **Doing the technical design correctly does not make the feature legally compliant** — that determination requires attorney review of Tennessee and federal law as applied to Harvey Taxi's specific corporate structure, driver classification, and service area, which is outside this document's scope and this author's competence.

Areas identified as needing review before any production launch:
- **Public accommodation / anti-discrimination law** (Tennessee state law and any applicable federal framework for transportation/public accommodation providers) as applied to a service that treats driver gender as a rider-facing matching criterion — including whether framing it as a *rider* preference (rather than a *service* restriction) changes the analysis, and whether analogous precedent exists from other ride-hailing or transportation services that have implemented similar features.
- **Employment / independent-contractor law** as applied to a program that offers *some* drivers (opted-in participants) preferential matching under certain conditions — whether this could be read as a term/condition of the working relationship that interacts with independent-contractor classification, and whether the voluntary, revocable, no-penalty-for-non-participation framing (recommended in §A.4) is legally sufficient to avoid that characterization.
- **Privacy law** applicable to collecting and storing gender-identity-adjacent self-reported data, including any Tennessee-specific data privacy requirements and general best practice for sensitive-category data (data minimization, as already reflected in §A.4's "two facts only" recommendation, is a good technical starting point but not a substitute for a privacy-law review of retention, breach-notification obligations, and disclosure requirements).
- **Insurance and liability** — whether Harvey Taxi's insurance carrier(s) or any regulatory body governing its transportation operations have position statements or requirements bearing on gender-based matching preferences.
- **Marketing/disclosure language** — the exact rider-facing copy (e.g., how "Prefer a woman driver" is explained in-app, in terms of service, and in any public marketing) should itself be reviewed alongside the legal analysis, since overpromising availability (the exact failure mode §A.1's naming choice is designed to avoid) could itself create a legal exposure independent of the underlying feature's legality.

**Recommendation:** treat legal/policy sign-off as a hard gate before this feature is enabled for any real rider or driver, independent of and in addition to the engineering rollout gates in §A.13.

## A.11 API summary

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/rider/preferences` (or `/api/rider/preferences/women-driver`) | GET/PUT | `requireRider` | Read/set the rider's standing preference |
| `/api/driver/women-driver-program` | GET/PUT | driver's existing self-service auth | Read/set the driver's opt-in + consent record |
| (ride-request payload) | — | `requireRider` (existing) | Optional per-ride override field, resolved server-side against the authenticated rider only |

No new admin routes proposed for v1 (§A.9.2).

## A.12 UI flows (textual)

- **Rider:** Profile/Settings → new "Prefer a woman driver" toggle, off by default, with inline copy reflecting the §A.1 framing ("We'll prioritize an eligible, participating woman driver when one is available — this doesn't guarantee one will be assigned"). Ride-request screen may offer a one-tap override for that specific trip if the per-ride override is built.
- **Driver:** Dashboard → new card next to "Driver Profile + Service Capabilities" → opt-in toggle with disclosure text (what data is stored, that it's never shown to riders directly, that it's revocable at any time) and a consent action that stamps `women_driver_program_consent_at`.
- **Dispatch (invisible to both parties):** `dispatchRide()` → `findAvailableDrivers()` → `applyWomanDriverPreference()` (new, only if preference active) → take `[0]` → existing offer flow, unchanged.
- **Fallback:** rider sees the explicit "keep waiting / accept next driver" choice from §A.6 only when the preference is active and the system is about to (or already did) match a non-participating driver.

## A.13 Rollout, flags, and tests

- **New flag:** `women_driver_preference_enabled`, reusing the exact `system_flags` + `getSystemFlag()` + admin enable/disable route pattern already used elsewhere (`server.js:19542`). Default OFF.
- Recommend a **shadow-mode phase** before enabling the feature for real matching, directly analogous to the RBAC Phase 2 approach already used this session: log what `applyWomanDriverPreference()` *would* have done (would it have reordered anything? how often would a participating driver have won?) without actually reordering the live candidate array, to validate the logic against real traffic patterns (e.g., "are there even enough participating drivers in any given area for this to matter") before it affects real dispatch outcomes.
- **Tests to include** (unit, on the new pure `lib/matchingPreferences.js` functions, plus integration coverage where this codebase already has integration tests for dispatch):
  - Cross-account access: Rider A cannot read/write Rider B's preference (via `requireRider`'s existing session scoping — test that a forged/mismatched session cannot affect another rider's row).
  - Spoofed fields: a ride-request payload claiming `prefers_woman_driver` for a rider whose saved preference is off does not leak into stored preference state beyond the single-ride override, and a request claiming a driver "participates" cannot alter that driver's actual stored opt-in.
  - Reordering preserves distance ordering within each group (participating-first, still nearest-first within that group).
  - Zero participating eligible drivers → array unchanged, normal dispatch proceeds.
  - Preference inactive (rider never opted in, no override) → reordering step is a no-op / not invoked.
  - Scheduled-ride dispatch applies the same reordering as on-demand dispatch.
  - HTAF rides are unaffected (no automatic dispatch path reaches the reordering function at all).
  - Driver readiness/eligibility filtering is never affected by opt-in status — an opted-in but otherwise-ineligible driver never appears in the candidate array regardless of preference state.

## A.14 Open questions (need a decision before implementation)

1. Exact "continue waiting" timeout/retry-count bound (§A.6), and whether it should differ for scheduled vs. on-demand rides (§A.7).
2. Whether/how an emergency-dispatch code path exists separately from ordinary `dispatchRide()`, and confirmation the preference layer cannot reach it (§A.6) — not conclusively located this session.
3. Exact schema shape for driver-side storage (columns on `drivers` vs. a small dedicated table) — a judgment call, not a security question either way.
4. Legal/policy review outcome (§A.10) — a hard gate, not an engineering decision.

---

# PART B — Favorite Drivers / Preferred-Driver Matching (all riders)

Per the user's explicit follow-up instruction: this is a **separate preference layer** available to **all riders** (not tied to Part A), which may feed the **same dispatch scoring engine**. The two must remain conceptually and technically distinct — this section does not reuse Part A's storage, routes, or opt-in mechanics, and vice versa.

## B.1 Relationship to the dormant `preferred_drivers` table

The existing `preferred_drivers` table (RLS-hardened, empty, zero app code references — `supabase/migrations/20260804210100_...sql`) is the closest existing precedent for this feature's *shape*, but its exact column layout was not confirmed this session (Supabase MCP tool access was gated throughout — see §F). Two options exist:

- **(a) Repurpose it**, after confirming its actual columns match or can be migrated to match this proposal's `rider_favorite_drivers` shape (§B.3).
- **(b) Leave it untouched and create a new `rider_favorite_drivers` table**, per the user's proposed name, treating the old table as genuinely dead schema to be cleaned up separately (or left alone) rather than repurposed.

**Recommendation: (b).** The old table has zero references and unknown provenance/intent (it predates this feature's requirements entirely); building fresh with the exact requirements in hand (unique rider/driver pair, completed-ride gating, admin-exception path, active flag) is lower-risk than reverse-engineering whether an already-existing empty table happens to match a spec it was never designed against. This also sidesteps needing confirmed live-schema access before this document can be considered complete. If a decision is later made to consolidate, that is a follow-up migration, not a blocker to shipping this feature.

## B.2 Rider flow

- After a completed ride (ride status reaches whatever this codebase's terminal "completed" state is — needs confirming against the exact `RIDE_STATUS` enum in `lib/rideDispatch.js`, presumably a `COMPLETED`-equivalent value), the rider is offered a "Mark as favorite driver" action referencing that specific ride and driver.
- A rider can have **multiple** favorite drivers.
- A rider can **remove** a favorite at any time (soft-remove via an `active` flag, not necessarily a hard delete — preserves history for anti-abuse/audit purposes without exposing that history to anyone but the owning rider and, minimally, admins).
- **Favorite status is private to the rider who set it** — never shown to the driver, never shown to other riders, never shown in any driver-facing "who has favorited me" surface. (A driver may reasonably infer repeat business from seeing the same rider again, which is unavoidable and out of scope, but the *explicit favorite flag itself* is never surfaced to them.)

## B.3 Schema proposal

```sql
CREATE TABLE rider_favorite_drivers (
  id BIGSERIAL PRIMARY KEY,
  rider_id UUID NOT NULL REFERENCES riders(id),
  driver_id UUID NOT NULL REFERENCES drivers(id),
  source_ride_id UUID REFERENCES rides(id),   -- the completed ride that qualified this favorite, null only for an admin-created exception
  active BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT NOT NULL DEFAULT 'rider',   -- 'rider' | 'admin_exception', so an admin-created row is always distinguishable in an audit query
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rider_id, driver_id)
);
```

A proper relationship table, not an array column on `riders` — matches the user's explicit instruction and this codebase's general preference for normalized relations over array-of-id columns (e.g., `driver_offers` is its own table rather than an array on `rides`).

- `UNIQUE (rider_id, driver_id)` enforces "favorite or not" as a single fact per pair — re-favoriting after unfavoriting is an `UPDATE ... SET active = true`, not a new row, keeping history clean and the uniqueness constraint meaningful.
- `source_ride_id` plus `created_by` together give an auditable answer to "why does this favorite exist" without needing a separate audit table for this specific fact.
- No "rider preference metadata" fields are proposed beyond what's listed — the user's spec allows for "optional rider preference metadata" but nothing in the stated requirements needs any yet (e.g., no per-favorite note/rank field is required by the ranking algorithm in §B.7, which is computed, not manually assigned). Recommend adding fields only if a concrete need emerges, consistent with this codebase's stated preference against speculative schema.

RLS posture: enabled, no `anon`/`authenticated` policies — service-role only, identical posture to every other rider-scoped-but-security-sensitive table this session (`admin_roles`, `admin_rbac_shadow_log`). All access goes through Express routes scoped by `requireRider`'s verified `req.rider.id`.

## B.4 API summary

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/rider/favorite-drivers` | GET | `requireRider` | List the authenticated rider's own active favorites |
| `/api/rider/favorite-drivers` | POST | `requireRider` | Create a favorite; body carries `driver_id` and `source_ride_id`; server verifies the ride belongs to `req.rider.id`, involved that `driver_id`, and is in a completed state (§B.9) before inserting |
| `/api/rider/favorite-drivers/:id` | DELETE (or PATCH `active: false`) | `requireRider` | Remove a favorite; server verifies the row's `rider_id` matches `req.rider.id` before touching it |
| `/api/rider/preferences` (shared with Part A, §C.1) | GET/PUT | `requireRider` | `prefer_favorite_drivers` boolean, `wait_longer_for_favorite` boolean (future mode, §B.8) |
| (admin-only, exceptional path) | POST | `requireElevatedAdmin` (or equivalent strict admin auth) | Admin-created favorite for a documented exceptional case, always `created_by: 'admin_exception'`, always audit-logged |

## B.5 Authorization / anti-abuse

- **Rider A cannot read or modify Rider B's favorites** — same two-layer enforcement as Part A (`requireRider` session scoping + service-role-only RLS).
- **A rider cannot favorite a nonexistent driver** — the POST route validates `driver_id` against the `drivers` table server-side; a client-supplied id that doesn't resolve to a real driver is rejected, never silently stored.
- **Favoriting requires a real completed ride between that rider and that driver, by default.** The POST route looks up `source_ride_id`, verifies `rides.rider_id = req.rider.id` **and** the ride's assigned driver matches the supplied `driver_id` **and** the ride is in a completed state — all server-side, never trusting a client-supplied "yes this ride happened" claim. This directly prevents a rider from favoriting an arbitrary driver they never rode with (which would otherwise let favorite-status be used to probe or manipulate matching for a driver a rider has no relationship with).
- **Admin exception path** exists for legitimate edge cases (e.g., a data-migration scenario, or a documented customer-service accommodation) but must go through a distinctly stricter admin auth (mirroring the compliance-override route's `requireElevatedAdmin` pattern already used elsewhere in this codebase) and must always be audit-logged with a reason, exactly like other elevated-admin actions.
- **Client-supplied favorite status must never influence driver readiness.** Symmetric with Part A: this table is consulted only as a scoring input over an already-eligible candidate population; nothing about it ever touches `online/active/approval_status`/`computeDriverReadiness()`.

## B.6 Dispatch scoring integration

Same shape as Part A's §A.5, and — per §C — the two compose in one combined step rather than two independent reorderings:

1. `findAvailableDrivers()` produces the eligible, radius-filtered, not-previously-offered candidate array (unchanged).
2. A new pure function (e.g. `lib/matchingPreferences.js`'s `applyFavoriteDriverPreference(candidates, { riderId, favoriteDriverIds, preferenceMode })`) gives a **configurable scoring boost** to any candidate whose id is in the rider's active favorites list — never an outright "always pick the favorite regardless of distance" override, since the requirements explicitly list distance/ETA, availability, dispatch score, and reliability as co-factors in ranking multiple favorites (§B.7), implying this is a weighted boost, not a hard override.
3. `dispatchRide()` continues to take the top of the resulting array.

**This never bypasses:** the same list as Part A — safety/compliance, Checkr/Persona, vehicle eligibility, accessibility, geographic constraints, driver availability, HTAF eligibility/funding rules, or emergency/safety handling — for the identical structural reason (the function only ever reorders an already-eligible array).

## B.7 Ranking multiple favorites — deterministic factors

When more than one of a rider's favorites appears in the eligible candidate array, rank among them (before applying the boost relative to non-favorites) using, in order of recommended weight:

1. **Availability/eligibility** — already guaranteed by construction (only eligible candidates reach this function at all), but "not already handling another ride" specifically should be double-checked here if `findAvailableDrivers()`'s `online=true` doesn't already fully capture "currently mid-trip" — flagged as an open item to confirm against the exact meaning of the `online`/`status` columns (§F).
2. **Current distance/ETA** — reuse the same distance computation `findAvailableDrivers()` already produces; do not compute a second, inconsistent distance metric.
3. **Recent acceptance/reliability** — if this codebase already tracks a driver reliability/acceptance-rate signal anywhere (not confirmed this session — flagged in §F), reuse it; otherwise this factor is deferred to a later iteration rather than inventing a new reliability metric as part of this proposal.
4. **Existing dispatch score**, if `findAvailableDrivers()`/`nearest_drivers()` already computes one beyond raw distance (not confirmed this session, since `nearest_drivers()` is a live-only, uncommitted RPC — §F).
5. **Rider-specific favorite relationship recency/strength** — lowest-weighted tiebreaker only (e.g., most-recently-favorited first), since the requirements don't call for a "favorite of favorites" ranking beyond a deterministic tiebreak.

All weights configurable server-side (§C.3) — never hardcoded in frontend JavaScript, and never exposed to the client at all, since the client has no legitimate need to see or influence scoring weights.

## B.8 Rider settings

Two settings, per the user's spec:

- **"Prefer favorite drivers when available"** — recommended **default-on behavior for opted-in riders** in the sense that once a rider has any favorites, this is the natural/expected mode; the toggle exists so a rider can turn it off if they'd rather always get pure nearest-driver dispatch. This mode applies the scoring boost from §B.6 but **never delays dispatch** to wait for a favorite — if the array reorders and a favorite is at or near the top, great; if no favorite is in the eligible array at all, normal dispatch proceeds immediately with no behavioral difference from a rider with no favorites.
- **"Wait longer for a favorite driver"** (explicitly flagged by the user as an optional *future* mode, not v1) — a stronger preference that would introduce an actual wait/delay when no favorite is currently eligible, hoping one becomes eligible shortly. This interacts with the existing offer-timeout/redispatch model in a way that needs its own design pass (how long is "longer," what happens if the rider's patience runs out, how this composes with `lib/offerExpiry.js`) — recommend treating it as explicitly out of scope for the v1 implementation sequence (§E) and revisiting only after the boost-only mode has run in production.

## B.9 Scheduled rides and fallback

Same mechanism as Part A (§A.7): `sweepScheduledRides()` → `dispatchRide()` → the same scoring function applies, no separate logic needed. Fallback is simpler here than Part A's, precisely because the recommended v1 behavior (§B.8) never waits — "no favorite available" always and immediately falls through to normal dispatch, satisfying the user's explicit requirement ("if no favorite driver is available, the ride should automatically continue through normal dispatch unless the rider explicitly chose a stronger preference mode") without needing a bounded-wait design at all for v1.

## B.10 Feature flag, tests, rollback

- **New flag:** `favorite_driver_preference_enabled`, same `system_flags` pattern, default OFF, independent of `women_driver_preference_enabled` (they are unrelated flags for unrelated features, even though both feed the shared scoring step — see §C.3 on how the combining function itself is flag-aware).
- **Tests** (mirroring §A.13's structure):
  - Cross-account: Rider A cannot list, create, or delete Rider B's favorites.
  - Cannot favorite a nonexistent driver id.
  - Cannot favorite a driver without a qualifying completed ride (server-side verified, not trusting a client claim) — except via the distinctly-audited admin-exception path.
  - Unique-pair constraint: re-favoriting an existing (rider, driver) pair updates `active`, never creates a duplicate row.
  - Spoofed favorite-status in a ride-request or any other client payload never influences driver readiness or eligibility.
  - Multiple-favorites ranking is deterministic and reproducible given the same inputs (§B.7).
  - Boost never promotes an ineligible driver into the candidate array (structural test: feed the scoring function a favorites list containing a driver *not* present in the eligible-candidates array and confirm output length/membership is unchanged).
  - No-favorite-available → normal dispatch proceeds immediately, no delay introduced.
  - Scheduled-ride dispatch applies the same boost.
  - Feature-flag-off → scoring function is a no-op / not invoked at all.
- **Rollback:** disabling `favorite_driver_preference_enabled` immediately reverts dispatch to today's pure-nearest-driver behavior with zero code rollback needed, since the scoring step is additive and flag-gated; the `rider_favorite_drivers` table and its data can remain in place harmlessly while disabled (no destructive rollback required at the data layer).

---

# PART C — Combining the two preference layers

## C.1 Shared vs. separate storage

Recommend **one small `rider_preferences` table** (or equivalent columns on `riders`) for the *boolean toggles that are simple rider-level settings* — `prefers_woman_driver`, `prefer_favorite_drivers`, `wait_longer_for_favorite` (reserved for the future mode) — since these are all "one row per rider, a handful of booleans, identical RLS/auth needs" and sharing one table avoids re-deriving the same RLS policy and `requireRider`-scoped route pattern three separate times. This is purely a storage-efficiency recommendation, not a conceptual merge — **`rider_favorite_drivers` remains its own relationship table** (§B.3), never folded into this settings table, since it's a one-to-many relation, not a scalar setting.

## C.2 Combined dispatch scoring architecture

```
findAvailableDrivers()
  → [hard eligibility/readiness filters: online, active, approved,
     radius, not-already-offered — UNCHANGED, pre-existing]
  → [safety/accessibility requirements, wherever already enforced upstream — UNCHANGED]
  → candidates[]
        │
        ▼
applyFavoriteDriverPreference(candidates, riderFavorites, weights)
        │   (adds a configurable score boost per candidate; §B.6-B.7
        │    ranking factors for ties among multiple favorites)
        ▼
applyWomanDriverPreference(candidates, preferenceActive, weights)
        │   (adds a configurable score boost per candidate; §A.5)
        ▼
combineAndSort(candidates)  // stable sort by combined score, falling
        │                   // back to existing distance ordering as the
        │                   // tiebreaker, exactly like today when no
        │                   // preference applies at all
        ▼
dispatchRide() takes candidates[0], creates one driver_offers row,
existing sequential offer/timeout/redispatch model, UNCHANGED
```

Both preference functions are independent, pure, and individually flag-gated (`women_driver_preference_enabled`, `favorite_driver_preference_enabled`) — either can be enabled without the other, and the combining step simply sums whatever scores are actually active for a given ride (an inactive preference contributes zero boost, not an error or a skipped step).

## C.3 Precedence when a rider has both a favorite and "prefer a woman driver" active

Per the user's own example: **a favorite woman driver who is eligible and available should receive the strongest preference** — i.e., a candidate who satisfies *both* boosts should score higher than a candidate who satisfies only one. This falls out naturally from an additive scoring model (favorite boost + woman-preference boost, summed) rather than needing a special-cased "which preference wins" rule — the two are complementary signals about the same candidate, not competing claims. The system must still behave safely (§A.6's explicit-choice fallback) when no candidate satisfies either preference, or only one.

**All weights configurable and server-side** (e.g., stored in `system_flags` as numeric values, or a small dedicated config row, read by the combining function at dispatch time) — never hardcoded into frontend JavaScript, and never sent to or readable by any client, since the client has no legitimate reason to see scoring internals and exposing them would let a sufficiently motivated rider or driver reverse-engineer ways to game matching.

**Interaction with Part D:** a Direct Driver Request (§D) is not a third input to this scoring function — it bypasses scoring entirely by construction, since it targets exactly one driver rather than ranking a pool. See §D.9 for the precedence rule when a rider has both a direct request and an active Part A preference outstanding at once.

---

# PART D — Direct Driver Requests

Added per explicit follow-up request, after Parts A–C were drafted. Parts A–C are unchanged above; this section is self-contained and calls out its few integration points back into them explicitly (§D.8, §D.9) rather than editing their text.

## D.1 Scope and how this differs from Parts A–C

Every feature above this point is a **scoring layer**: it never talks to one driver, it re-ranks a pool and lets the existing sequential offer/timeout/redispatch model in `dispatchRide()` carry on. A Direct Driver Request is different in kind: the rider is explicitly asking **one specific driver**, by name, to take **one specific ride**, and nothing is dispatched to anyone else unless that driver says no (or doesn't answer in time). **A direct request is not an assignment.** Creating one never puts a driver on a ride; only that driver's own explicit accept action does, and until they accept, the ride is not considered matched.

This section treats a direct request as **a rider-initiated, single-target offer that — once accepted — becomes exactly the same kind of ride the existing dispatch system already produces**, per the explicit instruction to integrate with, not parallel, the existing ride lifecycle. It is not a second ride-matching product; it is a second *entry point* into the same one.

## D.2 Existing systems this must be built on

| Concern | Existing system | File / location |
|---|---|---|
| Rider identity/auth | `requireRider` | `server.js:3289` |
| Driver identity/auth | `requireDriver` | used at `/api/driver/offers/:offerId/accept`, `.../decline` (`server.js:12377`, `12609`) |
| The existing single-driver offer mechanism (closest precedent) | `driver_offers` table + accept/decline routes | `server.js:9380-9424`, `12377-12470`, `12609-12690` |
| Offer expiry/timeout sweep | `lib/offerExpiry.js` | referenced at `server.js:8766`, `21161` |
| Driver readiness | `computeDriverReadiness()` | `lib/driverCompliance.js` |
| Driver eligibility filter (radius/online/active/approved) | `findAvailableDrivers()` | `server.js:9116` |
| Ride lifecycle / scheduled dispatch | `dispatchRide()`, `sweepScheduledRides()` | `server.js:9432`, `lib/rideDispatch.js` |
| Who a rider is even allowed to direct-request | `rider_favorite_drivers` (Part B) + ride history (rider-owned, via `/api/rider/rides`) | §B.3; `server.js` rider-history routes |
| Rate limiting | `rateLimit({ windowMs, max, keyPrefix })` | `server.js:1009`, used ~15 places already |
| Idempotency-key precedent | Stripe payment-intent creation | `server.js:10595-10704` |
| Audit logging | `auditLog()` | used throughout admin/compliance routes this session |
| **A concrete, currently-open gap this feature must not inherit** | `POST /api/driver/offers/:offerId/decline` performs **no ownership check** — unlike `.../accept`, which does check `offer.driver_id !== driverId` (`server.js:12435-12453`), decline (`server.js:12609-12690`) reads the offer and updates it by `id` alone, never comparing `offer.driver_id` to the authenticated `req.driver.id`. Confirmed by reading both routes this session. Tracked as pending backlog item **PR8** ("Driver offer /decline ownership check"). | `server.js:12609` |

That last row matters directly: whatever accept/decline machinery Part D builds for direct requests must not copy today's decline route verbatim. See §D.12.

## D.3 Who a rider can direct-request

Per the explicit instruction, **no directory of private driver information** is exposed. The rider's "who can I request" list is built entirely from data the rider already legitimately has access to:

1. **Favorite drivers** (Part B, `rider_favorite_drivers`) — surfaced first/most prominently, per instruction, since favoriting already proved a real prior relationship (§B.5's completed-ride gate).
2. **Drivers from the rider's own ride history** — any driver who appears in the rider's own `/api/rider/rides` history, whether or not favorited. This is data the rider already owns and can already see (who drove them, when) — no new exposure.
3. **Any other eligible driver, only if a future platform-policy decision explicitly permits driver discovery** — **not part of this design**. No driver search, browse, or lookup-by-name/photo/vehicle surface is proposed here. If Harvey Taxi later decides to allow requesting a driver with no prior relationship, that is its own product/policy/safety decision (likely with very different anti-harassment requirements than "a driver you already rode with") and should get its own review, not be smuggled in as a side effect of this design.

The picker itself shows only what the rider already sees elsewhere today (name, photo, vehicle — the same fields already shown for an assigned driver) — never anything from §D.10's driver-controls table, §D.11's block list, or any compliance/verification field.

## D.4 State machine

```
                 ┌───────────┐
   rider creates │  pending  │
   ─────────────>│           │
                 └─────┬─────┘
                       │
        ┌──────────────┼───────────────┬───────────────┬───────────────┐
        ▼              ▼               ▼               ▼               ▼
   ┌─────────┐   ┌───────────┐   ┌──────────┐   ┌──────────┐   ┌─────────────┐
   │accepted │   │ declined  │   │ expired  │   │ canceled │   │ unavailable │
   └─────────┘   └───────────┘   └──────────┘   └──────────┘   └─────────────┘
   driver said    driver said     no response    rider           eligibility
   yes            no              in time         withdrew it     recheck failed
                                                   before a        at creation
                                                   response         OR accept time
```

- **`pending`** — created, driver notified, awaiting a response.
- **`accepted`** — the driver explicitly accepted. This is the only state that causes anything to happen to the ride (§D.6).
- **`declined`** — the driver explicitly said no. Terminal.
- **`expired`** — no response within the request's TTL (§D.18's sweep, reusing `lib/offerExpiry.js`'s model). Terminal.
- **`canceled`** — the *rider* withdrew the request before the driver responded. Terminal. (Distinct from `declined` for audit/reporting clarity — "the rider changed their mind" is a different fact than "the driver said no," and conflating them would make §D.10's driver-side decline-cooldown logic and any future abuse analysis harder to reason about.)
- **`unavailable`** — the eligibility/readiness recheck (§D.5, §D.6) failed, either at creation (driver isn't currently eligible at all) or at accept time (driver became ineligible between creation and responding). Terminal. Deliberately a distinct state from `declined`, so "the driver said no" is never conflated with "the system determined this driver couldn't legally/safely take this ride" — the second is not a reflection on the driver at all, and the difference matters for §D.11's anti-harassment "one generic unavailable message" design (a rider must not be able to distinguish *which* of these actually happened, but the backend must still know internally, for its own correctness and audit trail).

All transitions are **atomic conditional updates** (`.eq("status", "pending")` before writing a new status), the same pattern already used by the existing accept/decline routes (`server.js:12462-12481`, `12669-12681`) — whichever of "driver accepts," "driver declines," "rider cancels," or "the expiry sweep marks it expired" reaches the database first wins; every other concurrent attempt reads back a no-op and must handle that gracefully (§D.19).

## D.5 Request creation — eligibility recheck #1

When a rider creates a direct request (targeting an eligible ride they own, per `requireRider`, and a driver from §D.3's rider-owned candidate list):

1. **Ownership/identity checks, all server-side:** the ride belongs to `req.rider.id`; the ride is in a dispatchable state (has already cleared payment authorization — see §D.12 — and has not already been assigned); the targeted driver id resolves to a real driver row.
2. **Relationship check:** the targeted driver must actually be a current favorite (§B.3) or appear in the rider's own ride history (§D.3) — never trusted from the client beyond "which driver id are you asking for"; the server independently re-derives whether that relationship is real.
3. **Block check (§D.11):** if a `driver_rider_blocks` row exists for this (driver, rider) pair, the request is rejected with the same generic message as any other "can't be requested right now" outcome (§D.11) — never a distinguishable "you're blocked" message.
4. **Driver-controls check (§D.10):** if the driver has `accept_direct_requests = false`, or their `direct_request_audience` setting excludes this rider (e.g., "favorites only" and this rider isn't a current favorite of *this driver* — note this is symmetric-but-separate from the rider's own favorite list, see §D.10), reject with the same generic message.
5. **Eligibility/readiness recheck, reusing existing logic, never re-implemented:** the driver must currently be `online/active/approved` (the same condition `findAvailableDrivers()` already checks) **and** pass `computeDriverReadiness()` — **this is the one place in this entire document where `computeDriverReadiness()` is actually invoked**, since a direct request, unlike ordinary dispatch, needs an affirmative answer about one named driver rather than "some driver in an already-filtered pool." Recommend factoring the existing eligibility conditions out of `findAvailableDrivers()` into a small reusable predicate (e.g. `isDriverEligibleForDispatch(driver)`) that both the pool query and this single-driver recheck call, rather than writing a second, potentially-drifting copy of the same rules.
6. If all checks pass: insert a `direct_driver_requests` row (`pending`), notify the driver (push, mirroring the existing offer-created push pattern — subject to PR6's push-subscription-ownership status, §D.12), start the TTL clock.
7. If any check fails: **do not create a row implying the driver was asked and failed to respond.** Recommend recording a minimal internal-only audit event (for rate-limiting and anti-abuse pattern detection, §D.11) without creating a user-visible `unavailable` row in this case — reserve the visible `unavailable` state for §D.6's post-creation recheck failure, where a row already exists and needs a terminal state. Respond to the rider with the same generic "this driver isn't available for a direct request right now" message used everywhere else in this section.

## D.6 Acceptance — eligibility recheck #2, then join the existing ride lifecycle

`POST /api/driver/direct-requests/:id/accept`, `requireDriver`, **with an explicit ownership check from day one** (`request.driver_id !== req.driver.id` → 403) — the exact check §D.2 confirmed is currently missing from the analogous decline route elsewhere in this codebase, not repeated here.

1. Re-run the same eligibility/readiness predicate from §D.5 step 5. A driver can go offline, lose readiness, or start another ride between request-creation and this moment — this second check is not redundant, it's the whole reason "recheck at creation AND at accept" was required. If it now fails, atomically transition the request to `unavailable` instead of `accepted`, and notify the rider (generic messaging, §D.11) that this driver is no longer available, applying whatever fallback the rider configured (§D.7).
2. If eligibility still holds: atomic conditional update `direct_driver_requests` row `pending → accepted` (`.eq("status", "pending")` guard, exactly like the existing accept route's pattern). If this returns no row (someone else already resolved it — rider canceled, TTL sweep expired it, race with a concurrent accept attempt that shouldn't be possible for a single-driver-target row but is still guarded defensively), return the same "already resolved" response the existing decline route already gives (`server.js:12683-12688`) rather than a confusing error.
3. **Join the ride into the existing lifecycle, not a parallel one.** Recommend: acceptance performs the same operation ordinary dispatch performs when it successfully offers-and-would-assign a driver — i.e., create the corresponding `driver_offers` row for this (ride, driver) pair via the same insert path §0 already describes (`server.js:9380-9424`), immediately in an already-`accepted` state (since the driver's acceptance *is* the offer response, there is no separate pending-offer window to wait through), then let every downstream step (ride status transition, ETA persistence, push notification to the rider, payment capture flow) run through its existing, unmodified code path exactly as if ordinary `dispatchRide()` had produced this same offer. This is what "transition into the existing dispatch/ride lifecycle rather than a parallel ride system" means concretely: after this point, nothing about the ride's remaining lifecycle knows or cares that it arrived via a direct request instead of ordinary dispatch.
4. The `direct_driver_requests` row keeps its own `accepted` status and a `resulting_offer_id` pointer to the `driver_offers` row it produced — purely for the rider-facing "you requested this driver, and they accepted" history/audit trail; it is not consulted again by ride logic after this point.

**A distinct race from the one step 2 already guards: a driver reserves nothing merely by being the target of a pending request.** Nothing about creating a direct request (§D.5) changes that driver's state in any table `findAvailableDrivers()`/`dispatchRide()` reads — the driver remains fully visible to, and dispatchable by, ordinary dispatch for a *different* ride for the entire time a direct request sits `pending`. This is deliberate (a pending, unanswered request must never let a rider effectively take a driver off the market), but it means the same driver could receive an ordinary dispatch offer for Ride B while a direct request for Ride A is still pending, and could then attempt to accept both. **Only an authenticated driver's atomic acceptance action may ever establish an assignment — never the mere creation of a request** — and if a driver's direct-request acceptance (this route) and an ordinary `driver_offers` acceptance land at effectively the same moment for the same driver, exactly one must win. Recommend enforcing this the same way single-offer correctness is already enforced elsewhere in this codebase: a database-level constraint or transaction (e.g., a partial unique index or an explicit check-and-set within the same transaction as the acceptance write) guaranteeing a driver cannot simultaneously hold two `accepted`/active assignments, rather than relying on a pre-check in application code or any frontend state — a pre-check alone has exactly the same TOCTOU gap the `.eq("status", "pending")` conditional-update pattern already exists elsewhere in this document to close. This is called out explicitly as its own concurrency requirement (not fully solved by step 2's guard, which only protects the request row itself, not the driver's overall assignment state) and is tracked as an implementation-time requirement, not resolved by this document (§F).

## D.7 Rider settings and fallback

Two settings, mirroring Part B's pattern exactly and per the explicit instruction:

- **"Request this driver first; if unavailable, continue with normal Harvey Taxi matching." — recommended default.** On decline, expiry, or `unavailable`, the ride automatically falls into ordinary `dispatchRide()` — including re-applying whatever Part A/Part B preferences the rider has active, per §D.9's precedence rule. No silent dead end: the rider is told the direct request didn't work out, and immediately sees normal matching pick up.
- **"Wait for this driver"** (architect now, defer implementation if needed, per instruction) — a stronger mode where the ride does *not* fall through to normal dispatch on decline/expiry, but is left in a rider-visible "still trying" state offering to re-request the same driver, wait for the driver to become available again, or manually switch to normal matching. **Must have a configurable maximum wait/expiration and must never create an indefinitely pending ride** — recommend the same bounded-wait principle as §A.6's "continue waiting for a woman driver," including a hard ceiling after which the ride is forced into normal dispatch (with the rider notified, not silently overridden). Exact bound is a product decision, deferred to the same open-items list as §A.14 (see §F).

## D.8 Favorite-driver integration

Per the explicit instruction, these remain **two separate concepts that happen to share a source list**:

- **Favorite preference (Part B) = a dispatch scoring boost** applied automatically to every matching ride, no driver consent step, never seen by the driver.
- **Direct request (Part D) = an explicit, one-time offer to one named driver**, which that driver must actively accept, and which the driver can decline or opt out of entirely (§D.10).

**A favorite relationship does not give the rider any right to that driver's time and does not bypass driver consent.** Concretely: favoriting a driver never auto-creates a direct request, never changes how §D.5's eligibility/consent checks are evaluated, and never lets a rider skip §D.10's driver-controls or §D.11's rate limits just because the target is a favorite. The only effect favoriting has on Part D is populating §D.3's "who can I request" list first/most prominently — nothing about the request-creation, acceptance, or abuse-control logic treats a favorite differently from a non-favorite driver drawn from ride history.

## D.9 Interaction with "Prefer a woman driver" (Part A)

**Deterministic rule, never a silent override of either preference:** a direct request targets exactly one driver by construction — there is no candidate pool for Part A's scoring function to reorder, so **Part A's preference simply does not apply to a direct request's initial attempt**, the same way it doesn't apply to any single-target action. This is a structural fact, not a policy choice to hide.

**The rider must be told this, explicitly, at the point of creating a direct request if they also have "prefer a woman driver" active** — e.g., "You're requesting [driver] directly. Your 'prefer a woman driver' setting won't apply to this specific ride, since you've chosen a specific driver." This must **never** reveal the targeted driver's actual participation status in the Part A program (§A.4's "never exposed to riders" rule applies with full force here too) — the message is about the rider's *own setting* not applying to *this specific action*, not a statement about the driver.

**On fallback (§D.7's default mode):** once a direct request resolves to declined/expired/unavailable and the ride falls through to ordinary `dispatchRide()`, Part A's preference (and Part B's favorite-boost, for any *other* favorites besides the one just directly requested) **reactivates normally** for that fallback dispatch — the rider's standing preferences were never disabled, only inapplicable to the one explicit ask that has now concluded.

## D.10 Driver controls

New `driver_direct_request_preferences` (one row per driver, default-inserted or defaulted at read time):

- **`accept_direct_requests`** (boolean) — lets a driver disable this entire channel **without going offline for ordinary dispatch**, per the explicit instruction. Recommend default **true** (a rider can already only reach a driver they have a real prior relationship with, per §D.3 — the exposure is narrower than ordinary dispatch's "any nearby rider," which drivers already accept today), but this is a product judgment call worth revisiting; a more conservative default of **false** (opt-in) is equally defensible and should be an explicit decision before launch, not an implementation detail (tracked in §F).
- **`direct_request_audience`** — enum: `all_eligible_previous_riders` | `favorites_only` | `nobody`. `nobody` is equivalent to `accept_direct_requests = false` and can be modeled as either a third enum value or a derived state from the boolean — implementation detail. "Favorites only" here means *the driver's own* notion of a favorite/repeat rider — this document does not currently propose a symmetric "driver favorites a rider" table; if the driver-side favoriting concept doesn't exist yet, recommend scoping v1's audience choice to `all_eligible_previous_riders` vs `nobody` only, and deferring `favorites_only` until (if) a driver-side favorite-rider concept is separately designed — not silently inventing one as a side effect of this table.
- Route: `GET/PUT /api/driver/direct-request-preferences`, same driver self-service auth pattern as Part A's `/api/driver/women-driver-program`.

**Decline and block:** a driver can decline any individual pending request (§D.4) with no obligation to accept anything. Separately, a driver can **block a specific rider from ever creating a future direct request to them** (§D.11's `driver_rider_blocks`) — a stronger, standing action distinct from a one-off decline, for a rider whose requests are unwanted or harassing.

## D.11 Abuse controls

- **Rate limits:** reuse `rateLimit({ windowMs, max, keyPrefix })` (`server.js:1009`) on the creation route, keyed by `rider_id` (e.g., a small `max` per hour/day — exact number is a product tuning decision, not a security one, tracked in §F).
- **Duplicate-request prevention:** a partial unique constraint on `direct_driver_requests (rider_id, driver_id, ride_id) WHERE status = 'pending'` — a rider cannot have two simultaneous pending requests to the same driver for the same ride. Combined with an idempotency key (below), this also protects against double-submit from a flaky client.
- **Decline cooldown:** after a driver declines a request from a given rider, reject a new request from that same rider to that same driver for a configurable cooldown window (server-side, checked against the most recent `declined`/`unavailable` row's `responded_at` — never a client-supplied "it's been long enough" claim) — prevents a declined rider from immediately re-asking the same driver on a loop.
- **Expiration:** every `pending` request has a TTL; a sweep (reusing `lib/offerExpiry.js`'s interval/lease model rather than inventing a second one) transitions stale `pending` rows to `expired`.
- **Rider/driver blocking:** `driver_rider_blocks` (§D.15) — a driver-initiated, one-directional block; once set, every future request-creation attempt from that rider to that driver is rejected identically to any other "unavailable" outcome (§D.5 step 3). Recommend **not** notifying the rider that they've been specifically blocked (vs. merely "unavailable right now") — that distinction is exactly the kind of information this design must not leak (below).
- **Audit logging:** every creation, accept, decline, cancel, expiry, and block event goes through the existing `auditLog()` mechanism.
- **Idempotency:** the creation route accepts an optional `idempotency_key` (mirroring the Stripe payment-intent pattern at `server.js:10595-10704`), with a unique constraint on `(rider_id, idempotency_key)`, so a retried client request can't create two rows.
- **Anti-harassment / presence-probing prevention — the single most important control in this section:** a rider must never be able to use repeated direct-request attempts to determine an off-duty driver's real-time location, schedule, or online/offline status, or to distinguish "this driver is offline" from "this driver is busy" from "this driver opted out of direct requests" from "this driver blocked you specifically." **Every one of §D.5's rejection reasons (relationship check failed, blocked, driver controls exclude this rider, eligibility/readiness recheck failed) must produce the exact same generic rider-facing response** — e.g., "This driver isn't available for a direct request right now" — with no status code, timing, or copy difference a rider could use to distinguish them. This is the same principle already used for account-enumeration protection in `docs/rider-auth-design-proposal.md` §1.2 ("the same response whether or not the submitted phone/email matches a real rider") applied to a new surface. Rate limiting (above) further blunts any attempt to use volume/timing of repeated attempts as a side channel.
- **Never expose:** exact off-duty location, personal phone number, personal email, home address, compliance/verification records (Persona/Checkr status, approval history), or another rider's activity (e.g., "this driver is currently busy with another rider" is too much detail — collapse it into the same generic "unavailable" message as everything else in this list).

## D.12 Payment/security — explicit dependencies, verified against current code, not inherited from PR labels

**Correction:** an earlier draft of this section characterized several dependencies as "Done" based on this session's PR-completion tracking. That was too strong. A merged PR is not the same fact as a live-enforced security property — a fix can be merged but flag-gated off, or the flag can be on while the enforcement code behind it was never actually merged. Per explicit instruction, this table instead distinguishes **code merged / migration applied / flag state / live enforcement verified / outstanding validation** for each dependency, and every row below was re-checked directly against the current `server.js` and this codebase's own operational docs on 2026-08-08, not inherited from the task tracker's labels.

**Headline finding from that re-check: rider-owned resource ownership is not currently enforced on the payment surface, contradicting this session's own "PR3/PR2b: completed" task-tracker labels.** Specifically, direct reads of the current `server.js` this session found:

- `requireRiderIfEnforced` / `resolveEnforcedRiderId` (the PR2b functions the codebase's own comments describe as gating rider-route ownership) **do not exist anywhere in `server.js`** — zero matches, confirmed by direct search. `docs/security-remediation/pr-02a-live-validation-runbook.md` independently corroborates this: as of its last recorded evidence (2026-08-04), "**PR 2b start gate — NOT satisfied, holding** ... PR #97 remains open and inert."
- `POST /api/rider/payment-methods/setup-intent` (`server.js:10417-10454`), `GET /api/rider/payment-methods` (`server.js:10456-10489`), `DELETE /api/rider/payment-methods/:paymentMethodId` (`server.js:~10494-10539`), and `POST /api/rides/payment-intent` (`server.js:~10548-10601`) **all read `rider_id`/`riderId` directly from the request body or query string, with no `requireRider` middleware and no session verification of any kind**, confirmed by reading each route in full. The delete route's own comment even names the pattern: "Same 404-either-way ownership check used by `/api/rider/saved-places`" — the exact insecure, already-documented legacy pattern this whole security program exists to close, still live on the payment surface.
- This is a **currently-live gap, not a historical one** — it means any caller who can guess or obtain a rider's id can today create a Stripe SetupIntent/PaymentIntent against that rider's Stripe customer, list their payment methods, or delete them, independent of any feature-flag state, since the enforcement code that would gate this was never actually merged.

This finding is reported to the user directly, outside this document, given its severity — it is recorded here because Part D's design must not build on top of an inaccurate belief that this surface is already secured.

| Dependency | Code merged | Migration applied | Flag state | Live enforcement verified | Outstanding validation |
|---|---|---|---|---|---|
| Rider session issuance (`requireRider`, OTP login, session cookie) | Yes — `requireRider` (`server.js:3289`), OTP routes (PR #95) | N/A (no new tables; `riders.session_version` column, per `rider-auth-design-proposal.md` §2.3) | `rider_auth_ui_enabled` — last **directly queried live** 2026-08-04, resolved to **no row / `false`** (`pr-02a-live-validation-runbook.md` §1); **not re-confirmed since** | **No** — the one completed real-user walkthrough recorded in `pr-02a-live-validation-runbook.md` §3–4 is explicitly an **owner attestation, not independently observed** by any session | Re-query `system_flags` for `rider_auth_ui_enabled`'s current live value immediately before any decision to build/enable Part D; do not assume it is still `false` (or still `true`) from a four-day-old reading. |
| Rider-owned route ownership enforcement (PR2b: `requireRiderIfEnforced`/`resolveEnforcedRiderId`) | **No** — verified absent from current `server.js` by direct search, despite this session's task tracker marking "PR2b: completed" | N/A | `rider_auth_enforced` — last queried 2026-08-04, no row / `false`; **moot regardless of value, since the code it would gate isn't merged** | **No** | Resolve the task-tracker discrepancy first (confirm whether PR2b/PR #97 ever actually merged to `main`); until `requireRiderIfEnforced` exists and is wired onto rider-owned routes, treat rider-route ownership enforcement generally as **not implemented**, not merely "off." |
| Payment/Stripe customer & payment-method ownership (task-tracker "PR3") | **Partially** — Stripe customer creation/reuse logic (`getOrCreateStripeCustomer`) and idempotency-key handling are merged and functioning; the frontend fetch-helper credential fix from `pr-02c-signup-session-handoff.md` is merged | N/A | N/A — no flag gates these specific routes | **No — verified NOT enforced** by direct code read this session (see headline finding above): `setup-intent`, `payment-methods` (GET/DELETE), and `/api/rides/payment-intent` all still trust a client-supplied `rider_id`/`riderId` | Add `requireRider` (or an equivalent session-derived identity check) to all four routes named above, replacing every client-supplied `rider_id`/`riderId` read with `req.rider.id`, and live-verify post-deploy — this is a pre-existing gap Part D does not create but must not build on top of as though it were closed. |
| Rider RLS on `riders` table (PR4) | Yes | Yes — `supabase/migrations/20260804210000_fix_riders_public_policy.sql`, merged PR #98 | N/A (RLS, not a flag) | **Yes** — `pr-04-rls-hardening.md` records the migration applied directly to production with before/after verification | None outstanding for this specific item. **Caveat:** RLS protects against unauthenticated/anon direct-DB access; it does **not** protect against the application-layer gap above, since this codebase's backend connects as `service_role`, which bypasses RLS by design (the same posture used for every service-role-only table in this document) — RLS and the payment-route gap are two different layers and closing one does not close the other. |
| Driver offer `/decline` ownership check (PR8) | **No** — confirmed still missing this session (§D.2) | N/A | N/A | **No** | Part D's own accept/decline routes (§D.6, §D.16) implement this check independently and correctly from their first line of code — they are specified not to be built by copying today's decline route. Recommend fixing PR8 on the existing route as its own independent, low-risk fix, so the same bug class isn't left open in one place while corrected in another. |
| Push-subscription ownership (PR6) | **No** — pending backlog | N/A | N/A | **No** | Treat driver-side "new direct request" push notifications as best-effort only; the in-app pending-requests list, not push delivery, is Part D's authoritative source (§D.17). |
| Persona inquiry ownership, safety-endpoint auth, secrets/session hardening (PR5, PR7, PR9) | **No** — pending backlog | N/A | N/A | **No** | No direct functional dependency identified for Part D specifically, but none of these should be assumed closed when reasoning about the overall security posture of the app Part D is being added to. |
| Subscriptions/referrals interaction | Not investigated this session | — | — | — | Flagged in §F — confirm no discount/referral logic keys off "how a ride was matched" before implementation. |

**Gate, stated plainly: Direct Driver Requests must not be enabled in production — regardless of how complete its own new code is — until every one of the following is independently, freshly true and verified, not merely believed true from a prior PR label:**
1. Rider-owned route ownership enforcement (the PR2b class of fix) is actually merged to `main` and live-verified, including specifically on the payment routes named above.
2. `rider_auth_ui_enabled`/`rider_auth_enforced` (or whatever flag(s) end up gating that enforcement) are confirmed, by a live query at decision time, to be in the intended state — not assumed from this document's 2026-08-08 snapshot.
3. Part D's own PR8-equivalent ownership check is implemented and tested on its own accept/decline routes from day one.
4. Fare calculation and payment authorization continue to run through the existing, unmodified quote/pricing pipeline for a direct-request-originated ride, with no new code path that could re-derive or bypass it.

Fare calculation is identical regardless of matching mechanism — a direct request never produces a different quote or bypasses `lib/rideQuote.js`'s quote-integrity token, since acceptance only ever joins a ride that already went through the existing estimate/quote flow (§D.6 step 3).

**Refund/completed-ride integrity:** unaffected by construction — once a direct request is accepted (§D.6 step 3), the ride is, from that point forward, indistinguishable from an ordinarily-dispatched ride to every downstream system (completion, payout, refund). No new completion/refund code path is proposed.

## D.13 Scheduled rides

A rider may direct-request a driver for a future scheduled ride. Recommend:

- The request can be **created** well in advance (rider intent captured immediately), but the driver should not be asked to commit to something days out under the same eligibility snapshot used for on-demand requests — a driver's readiness/online status days from now is not knowable today.
- Recommend the actual **notification-and-response window** open only as the scheduled ride approaches its dispatch time, reusing `sweepScheduledRides()`'s due-time mechanism (`lib/rideDispatch.js`) — i.e., a scheduled direct request sits in a "scheduled, not yet actionable" sub-state until the same due-time logic that triggers ordinary scheduled dispatch would fire, at which point §D.5's full eligibility recheck runs for the first time and the driver is actually notified.
- **Acceptance is never represented as an unconditional guarantee.** The rider-facing copy for an accepted scheduled direct request should communicate that circumstances (illness, vehicle issue, emergency) can still change before pickup — the same residual uncertainty any scheduled assignment already carries today, not a new promise introduced by this feature.
- **Fallback if the accepted driver becomes unavailable before pickup:** proactively notify the rider (not a silent failure discovered only at pickup time) and apply the rider's configured fallback (§D.7) — normal matching by default, with enough lead time before the scheduled pickup for ordinary dispatch to actually succeed, consistent with the existing scheduled-dispatch lease/retry model already in `lib/rideDispatch.js`.

## D.14 HTAF

Preserving §0/§A.8's finding exactly: HTAF rides bypass `dispatchRide()` entirely and are assigned manually by an admin. **Direct Driver Requests are not extended to HTAF rides in this design** — there is no automatic entry point for them to plug into (the same reason Part A's preference has no automatic HTAF effect). A future "HTAF rider wants to specifically request a driver" is **explicitly deferred as its own separate policy/product decision** requiring changes to the manual admin-assignment workflow itself, not an automatic consequence of shipping Part D.

## D.15 Data model

```sql
CREATE TABLE direct_driver_requests (
  id BIGSERIAL PRIMARY KEY,
  ride_id UUID NOT NULL REFERENCES rides(id),
  rider_id UUID NOT NULL REFERENCES riders(id),
  driver_id UUID NOT NULL REFERENCES drivers(id),
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | accepted | declined | expired | canceled | unavailable
  source TEXT NOT NULL,                      -- 'favorite' | 'ride_history' -- never 'discovery' until/unless §D.3's deferred policy decision changes this
  resulting_offer_id UUID REFERENCES driver_offers(id),  -- set only on acceptance, §D.6 step 4
  idempotency_key TEXT,
  decline_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  canceled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One pending request per (rider, driver, ride) at a time.
CREATE UNIQUE INDEX direct_driver_requests_one_pending_idx
  ON direct_driver_requests (rider_id, driver_id, ride_id)
  WHERE status = 'pending';

-- Idempotent retries.
CREATE UNIQUE INDEX direct_driver_requests_idempotency_idx
  ON direct_driver_requests (rider_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE driver_direct_request_preferences (
  driver_id UUID PRIMARY KEY REFERENCES drivers(id),
  accept_direct_requests BOOLEAN NOT NULL DEFAULT true,   -- default is an open product decision, §F
  direct_request_audience TEXT NOT NULL DEFAULT 'all_eligible_previous_riders',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE driver_rider_blocks (
  id BIGSERIAL PRIMARY KEY,
  driver_id UUID NOT NULL REFERENCES drivers(id),
  rider_id UUID NOT NULL REFERENCES riders(id),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (driver_id, rider_id)
);
```

`rider_favorite_drivers` (Part B, §B.3) is **reused as-is**, not duplicated — §D.3's candidate list reads from it directly.

**RLS posture:** all three tables enabled, no `anon`/`authenticated` policies — service-role only, identical posture to every other table in this document. A request row is meaningful to both the requesting rider and the targeted driver, but both sides only ever reach it through an Express route scoped by their own verified session (`req.rider.id` or `req.driver.id`), never a general "read rows where I'm involved" policy — consistent with this codebase's established pattern of enforcing scoping in the application layer against a fully locked-down table, not in SQL policies.

**State-transition protection:** every write to `status` is the same atomic `.eq("status", "pending")` conditional-update pattern already used by the existing offer accept/decline routes — never a plain unconditional `UPDATE`.

## D.16 API summary

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/rider/direct-request-candidates?rideId=...` | GET | `requireRider` | §D.3's picker list (favorites first, then ride-history drivers) for a specific ride the rider owns |
| `/api/rider/rides/:rideId/direct-requests` | POST | `requireRider` | Create a request (§D.5); accepts `driver_id`, optional `idempotency_key` |
| `/api/rider/direct-requests/:id` | DELETE (or PATCH `status: canceled`) | `requireRider` | Cancel a pending request the rider created (§D.4) |
| `/api/driver/direct-requests` | GET | `requireDriver` | List the authenticated driver's own pending/recent requests |
| `/api/driver/direct-requests/:id/accept` | POST | `requireDriver` **+ explicit ownership check** | §D.6 |
| `/api/driver/direct-requests/:id/decline` | POST | `requireDriver` **+ explicit ownership check** | Symmetric with accept; must not be built by copying today's ownership-check-less decline route (§D.2, §D.12) |
| `/api/driver/direct-request-preferences` | GET/PUT | driver self-service auth | §D.10 |
| `/api/driver/blocked-riders` (or `/:riderId`) | GET/POST/DELETE | driver self-service auth | §D.10's block/unblock |

## D.17 UI flows (textual)

- **Rider:** after selecting a ride's pickup/destination (or from ride-history/favorites screens), an option to "Request [driver] directly" appears for eligible candidates from §D.3. On tap, the rider sees the fallback-mode choice (§D.7, default pre-selected) and, if "prefer a woman driver" is active, the §D.9 disclosure. The ride then shows a distinct "Waiting for [driver] to respond" state until accept/decline/expiry, at which point it either becomes a normal in-progress ride (accepted) or transitions per the rider's fallback setting.
- **Driver:** dashboard shows incoming direct requests distinctly from ordinary dispatch offers (different, clearly-labeled UI element — a driver should never confuse "a rider specifically asked for me" with "the system's nearest-driver algorithm picked me"), with accept/decline actions and, from a completed request or ride, an option to block that rider from future direct requests.
- **Fallback (invisible mechanism, visible outcome to the rider):** declined/expired/unavailable → default mode hands off to ordinary `dispatchRide()` (with Part A/B preferences reactivated, §D.9) → rider sees normal matching proceed, told plainly that the direct request didn't work out.

## D.18 Rollout, flags, and tests

- **New flag:** `direct_driver_requests_enabled`, same `system_flags` pattern, **default OFF, independent of `women_driver_preference_enabled` and `favorite_driver_preference_enabled`** — per the explicit instruction that this is its own flag, not bundled with either scoring feature (they can be enabled/disabled in any combination).
- **Shadow/inert rollout:** ship schema + the driver-preferences/block self-service routes first, fully inert (no way for a rider to actually create a request yet, mirroring the phased approach in the combined Implementation Sequence below) — lets drivers set their `accept_direct_requests`/audience preferences ahead of the feature actually going live, so the very first real request already respects real driver choices rather than everyone defaulting to whatever the schema default is at flip-the-flag time.
- **Tests:**
  - **IDOR:** Rider A cannot view, cancel, or otherwise act on Rider B's request; Driver A cannot accept/decline/view a request targeted at Driver B — including via the exact class of gap confirmed present in today's decline route (§D.2), explicitly tested against the *new* routes.
  - **Spoofing:** a creation payload cannot claim a completed-ride/favorite relationship that doesn't actually exist server-side; cannot claim driver eligibility/readiness; cannot claim "identity" (gender/participation from Part A) about the driver as part of constructing the request.
  - **Duplicate acceptance:** two near-simultaneous accept attempts on the same request — exactly one succeeds, the other gets the existing "already resolved" response, never a double-assigned ride.
  - **Stale availability:** driver becomes ineligible between request creation and opening the accept screen — accept-time recheck (§D.6 step 1) correctly rejects into `unavailable` rather than accepting anyway.
  - **Race conditions:** rider cancels at (near-)the same instant the driver accepts — the atomic conditional update means exactly one wins; the losing side's caller must handle a null/no-op result gracefully, not crash or double-process.
  - **Blocked riders:** a blocked rider's creation attempt is rejected with the same generic message as any other unavailable outcome (§D.11) — not a distinguishable "blocked" response.
  - **Expired requests:** the TTL sweep transitions stale `pending` rows and never leaves one pending indefinitely; a request cannot be accepted after its `expires_at`.
  - **Payment bypass attempts:** accepting a direct request cannot start a ride whose payment was never authorized, and cannot produce a fare different from what the existing quote/pricing pipeline would have produced for the same ride.
  - **Fallback dispatch:** declined/expired/unavailable + default fallback setting correctly hands the ride to ordinary `dispatchRide()`, with Part A/B preferences correctly reapplied per §D.9.

---

# PART F — Open items needing confirmation before implementation

Carried over from the investigation phase, plus new ones surfaced while incorporating Parts B and D:

1. `preferred_drivers`'s actual live columns were never confirmed this session (Supabase MCP tool access was gated by a recurring `MCP error -32003: MCP tool call requires approval` throughout this investigation) — moot for the recommended path (§B.1 option b, build fresh) but should still be confirmed/documented before any future decision to consolidate or drop the old table.
2. Whether `online=true` on the `drivers` table already fully captures "not currently on another ride," or whether a separate mid-trip flag exists — needed to confirm §B.7 factor 1 isn't double-counting something `findAvailableDrivers()` already guarantees.
3. Whether any existing driver reliability/acceptance-rate metric already exists anywhere in this codebase, for §B.7 factor 3 — not found this session, not confirmed absent either.
4. Whether `nearest_drivers()` (live-only, uncommitted RPC) computes any score beyond raw distance, for §B.7 factor 4.
5. Exact terminal "completed" ride status value in the `RIDE_STATUS` enum (`lib/rideDispatch.js`), to precisely gate §B.9's "real completed ride" check.
6. Whether a separate emergency-dispatch code path exists outside ordinary `dispatchRide()` (§A.6, A.14) — not conclusively located this session.
7. Legal/policy review outcome for Part A (§A.10) — a hard gate independent of engineering readiness.
8. Exact wait-bound decisions for Part A's "continue waiting" choice (§A.6, A.14) — product decisions, not engineering ones.
9. **PR8 (driver offer `/decline` ownership check) resolution** (§D.2, §D.12) — a hard dependency to track, not necessarily to block on, since Part D's own routes are specified to implement the check independently regardless of PR8's status; but shipping both without ever fixing the original gap leaves a known bug live in production.
10. Default value for `driver_direct_request_preferences.accept_direct_requests` (opt-in `false` vs. opt-out `true`, §D.10) — a product decision, not resolved in this document.
11. Whether a driver-side "favorite/repeat rider" concept should exist at all, needed to make `direct_request_audience = 'favorites_only'` meaningful (§D.10) — not proposed elsewhere in this document; v1 may need to launch with only `all_eligible_previous_riders`/`nobody`.
12. Exact TTL/expiration durations for a pending direct request, and the "wait for this driver" mode's maximum wait bound (§D.7, §D.13) — product decisions.
13. Rate-limit and decline-cooldown thresholds (§D.11) — product/tuning decisions, not security decisions (the presence of the controls is the security requirement; the exact numbers are not).
14. Whether any subscription/referral logic keys off "how a ride was matched" in a way Part D could interact with — not investigated this session (§D.12).

---

# Implementation sequence (combined, all three features)

Recommend building and shipping independently, not as one big-bang PR — consistent with this session's established pattern of narrow, reviewable, individually-mergeable phases (e.g., the RBAC Phase 1/2 split). Parts A/B and Part D can proceed on independent tracks; Part D has no dependency on A/B shipping first (§D.1), only on the pending security-roadmap items it names explicitly (§D.12).

1. **Schema-only PRs** (additive, RLS-hardened, no application code reads/writes them yet): `rider_preferences`, driver opt-in columns/table, `rider_favorite_drivers` (Parts A/B); `direct_driver_requests`, `driver_direct_request_preferences`, `driver_rider_blocks` (Part D). Independently reviewable and, like Phase 1 RBAC, safe to merge with zero behavioral effect.
2. **Rider/driver self-service routes** (Part A §A.11, Part B §B.4, Part D's preference/block routes §D.16) — CRUD only, no dispatch/request-creation integration yet. Fully testable in isolation.
3. **Pure scoring functions** (`lib/matchingPreferences.js`, Parts A/B only — Part D has no scoring function, §D.1) — built and unit-tested against synthetic candidate arrays, not yet wired into `dispatchRide()`. Mirrors this session's `lib/*.js` + `lib/*.test.js` discipline exactly.
4. **Fix PR8** (driver offer `/decline` ownership check, §D.2/§D.12) — recommend landing this independently-useful fix before or alongside Part D's own accept/decline routes, so the same class of bug isn't left open in one place while being correctly handled in another.
5. **Shadow-mode wiring into `dispatchRide()`** (Parts A/B) — compute what the reordering *would* produce, log it, but don't actually reorder the live array yet — validates real-world signal before affecting real riders. (No equivalent shadow mode applies to Part D, whose "shadow" phase is instead the inert self-service-routes-only rollout in step 2/§D.18.)
6. **Part D request-creation/accept/decline routes**, behind `direct_driver_requests_enabled` (default OFF) — independent of A/B's flags.
7. **Enable behind flags**, one feature at a time (`favorite_driver_preference_enabled` first, since it has no legal-review gate; `women_driver_preference_enabled` only after §A.10's legal/policy sign-off; `direct_driver_requests_enabled` whenever its own testing/tuning — §F items 9-13 — is resolved, independent of the other two), starting with a narrow rollout if this codebase's flag system supports partial rollout, otherwise a short monitored full rollout with an immediate rollback plan (below).
8. **Deferred past v1, each its own later design pass:** "Wait longer for a favorite driver" (§B.8); HTAF admin-assignment hint for Part A (§A.8); Part D's "wait for this driver" mode (§D.7); Part D driver-discovery beyond favorites/ride-history (§D.3); Part D's HTAF extension (§D.14).

# Rollback strategy

All three features are additive and flag-gated at every layer:
- Disabling any of the three independent `system_flags` entries (`women_driver_preference_enabled`, `favorite_driver_preference_enabled`, `direct_driver_requests_enabled`) immediately reverts that feature's behavior with no code deploy needed — matching the existing `dispatch_paused`-style operational lever already in this codebase. Disabling Part D specifically simply stops new requests from being creatable; it does not need to (and should not) forcibly cancel requests already in flight — those still resolve normally through accept/decline/expiry, since the driver_offers path they feed into is unaffected by the flag.
- The pure scoring functions (Parts A/B) never mutate data — a rollback of the scoring step alone has zero data cleanup implications.
- The new tables (`rider_preferences`, driver opt-in fields, `rider_favorite_drivers`, `direct_driver_requests`, `driver_direct_request_preferences`, `driver_rider_blocks`) can remain in place harmlessly while their flags are off; no destructive rollback is required at the schema layer even in a full feature abandonment scenario — they simply stop being read/written.
- If a driver's or rider's stored preference/opt-in data itself needed to be purged (e.g., a driver fully rescinding consent, not just toggling off), that's a deletion of their own row(s), already covered by the "changeable/removable at any time" requirement (§A.3, §B.2) — not a schema rollback. A driver's `driver_rider_blocks` rows and `direct_driver_requests` history are similarly the driver's/rider's own data, deletable on request without affecting any other system.

# Acceptance criteria

**Part A ships when:**
- A rider can set, change, and remove "Prefer a woman driver" via `requireRider`-gated routes only; cross-rider access is impossible (tested).
- A driver can opt in/out via a clearly disclosed, consent-timestamped flow; the fact is never exposed to any rider or other driver in any API response (tested/reviewed against every rider-facing driver-info response shape).
- Dispatch reordering never changes the eligible candidate set, only its order (tested structurally, not just behaviorally).
- The explicit wait-vs-accept choice is surfaced whenever the preference is active and no participating driver is available (§A.6).
- HTAF, scheduled rides, and emergency handling behave per §A.7/§A.8/§A.6 (pending open item #6's resolution).
- Legal/policy review has explicitly signed off (§A.10) — required before enabling for any real user, independent of engineering completeness.

**Part B ships when:**
- A rider can favorite only a driver from a real, server-verified completed ride (or via the distinctly-audited admin exception), can list/remove their own favorites, and cannot access another rider's favorites (tested).
- The scoring boost never promotes an ineligible driver into contention (tested structurally).
- No-favorite-available always falls through to normal dispatch with no added delay (v1 scope, §B.8).
- Ranking among multiple favorites is deterministic and covered by tests (§B.7).
- Scoring weights are server-side-only and configurable without a frontend deploy.

**Part D ships when:**
- A rider can direct-request only a driver drawn from their own favorites or ride history (§D.3), never an arbitrary/discovered driver; cross-rider and cross-driver access (IDOR) is impossible (tested), including against the specific ownership-check gap already confirmed in today's decline route (§D.2).
- Eligibility/readiness is independently rechecked at both creation and acceptance, reusing `computeDriverReadiness()` and the same eligibility predicate `findAvailableDrivers()` uses, never a duplicated/drifting copy of those rules (§D.5, §D.6).
- Acceptance joins the ride into the existing dispatch/ride lifecycle (produces a normal `driver_offers`-backed ride) rather than a parallel one (§D.6).
- Every "can't be requested right now" outcome (blocked, opted out, audience-excluded, ineligible) is indistinguishable to the rider, and rate limits/decline cooldowns/idempotency/expiry are all enforced server-side (§D.11) — no data exists for a rider to infer an off-duty driver's location, schedule, or specific reason for unavailability.
- A driver can disable direct requests independent of going offline, and can block a specific rider from future requests (§D.10).
- The default fallback mode correctly hands an unresolved direct request to ordinary dispatch, with Part A/B preferences correctly reapplied (§D.7, §D.9), and never creates an indefinitely pending ride.
- Direct requests never bypass payment authorization, fare calculation, HTAF's manual-assignment-only posture, or any dependency named in §D.12 — and PR8 (or an equivalent independent fix in Part D's own routes) closes the ownership-check gap before launch.
- **A direct request never reserves, exposes, or alters a driver's availability merely because a rider created it.** Only an authenticated driver's atomic acceptance action may establish an assignment (§D.6), and a concurrent normal-dispatch acceptance and direct-request acceptance for the same driver must have exactly one winner, enforced at the database/transaction level (a partial unique index or equivalent check-and-set within the acceptance write's own transaction) — never by a pre-check alone, and never by frontend state (§D.6).
- Direct Driver Requests remains **blocked from production enablement** until every dependency in §D.12's gate is independently, freshly verified as actually enforced in production — not merely believed enforced from a prior PR label.

**All three:** full test suite green, `node -c server.js` clean, new `lib/*.test.js` coverage for every pure function, and this document's open items (Part F) either resolved or explicitly re-flagged as accepted risk before implementation begins.
