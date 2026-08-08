# Rider Matching Preferences — Architecture Proposal
### (1) "Prefer a Woman Driver" and (2) Favorite Drivers / Preferred-Driver Matching

**Status: PROPOSAL — NOT APPROVED, NOT IMPLEMENTED.** No code, schema, migration, feature flag, or production data has been touched for either feature described here. This document is the design deliverable requested before any implementation begins, and implementation must not start until this document (or a revised version of it) is explicitly approved.

**Relationship between the two features (per explicit instruction):** these are two separate rider preference systems with separate data, separate opt-in mechanics, and separate privacy postures. They are documented together, and share one dispatch scoring engine, because both ultimately answer the same question — "given a set of already-eligible drivers, which one should we offer the ride to first?" — and a single rider can have both active at once, which requires one combined precedence rule (§9). Neither feature is a prerequisite for the other; either could be built and shipped alone.

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

The existing `preferred_drivers` table (RLS-hardened, empty, zero app code references — `supabase/migrations/20260804210100_...sql`) is the closest existing precedent for this feature's *shape*, but its exact column layout was not confirmed this session (Supabase MCP tool access was gated throughout — see §D). Two options exist:

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

1. **Availability/eligibility** — already guaranteed by construction (only eligible candidates reach this function at all), but "not already handling another ride" specifically should be double-checked here if `findAvailableDrivers()`'s `online=true` doesn't already fully capture "currently mid-trip" — flagged as an open item to confirm against the exact meaning of the `online`/`status` columns (§D).
2. **Current distance/ETA** — reuse the same distance computation `findAvailableDrivers()` already produces; do not compute a second, inconsistent distance metric.
3. **Recent acceptance/reliability** — if this codebase already tracks a driver reliability/acceptance-rate signal anywhere (not confirmed this session — flagged in §D), reuse it; otherwise this factor is deferred to a later iteration rather than inventing a new reliability metric as part of this proposal.
4. **Existing dispatch score**, if `findAvailableDrivers()`/`nearest_drivers()` already computes one beyond raw distance (not confirmed this session, since `nearest_drivers()` is a live-only, uncommitted RPC — §D).
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

---

# PART D — Open items needing confirmation before implementation

Carried over from the investigation phase, plus new ones surfaced while incorporating Part B:

1. `preferred_drivers`'s actual live columns were never confirmed this session (Supabase MCP tool access was gated by a recurring `MCP error -32003: MCP tool call requires approval` throughout this investigation) — moot for the recommended path (§B.1 option b, build fresh) but should still be confirmed/documented before any future decision to consolidate or drop the old table.
2. Whether `online=true` on the `drivers` table already fully captures "not currently on another ride," or whether a separate mid-trip flag exists — needed to confirm §B.7 factor 1 isn't double-counting something `findAvailableDrivers()` already guarantees.
3. Whether any existing driver reliability/acceptance-rate metric already exists anywhere in this codebase, for §B.7 factor 3 — not found this session, not confirmed absent either.
4. Whether `nearest_drivers()` (live-only, uncommitted RPC) computes any score beyond raw distance, for §B.7 factor 4.
5. Exact terminal "completed" ride status value in the `RIDE_STATUS` enum (`lib/rideDispatch.js`), to precisely gate §B.9's "real completed ride" check.
6. Whether a separate emergency-dispatch code path exists outside ordinary `dispatchRide()` (§A.6, A.14) — not conclusively located this session.
7. Legal/policy review outcome for Part A (§A.10) — a hard gate independent of engineering readiness.
8. Exact wait-bound decisions for Part A's "continue waiting" choice (§A.6, A.14) — product decisions, not engineering ones.

---

# Implementation sequence (combined, both features)

Recommend building and shipping independently, not as one big-bang PR — consistent with this session's established pattern of narrow, reviewable, individually-mergeable phases (e.g., the RBAC Phase 1/2 split):

1. **Schema-only PRs** (additive, RLS-hardened, no application code reads/writes them yet): `rider_preferences`, driver opt-in columns/table, `rider_favorite_drivers`. Independently reviewable and, like Phase 1 RBAC, safe to merge with zero behavioral effect.
2. **Rider/driver self-service routes** (Part A §A.11, Part B §B.4) — CRUD only, no dispatch integration yet. Fully testable in isolation (§A.13/§B.10's non-dispatch tests).
3. **Pure scoring functions** (`lib/matchingPreferences.js`) — built and unit-tested against synthetic candidate arrays, not yet wired into `dispatchRide()`. Mirrors this session's `lib/*.js` + `lib/*.test.js` discipline exactly.
4. **Shadow-mode wiring into `dispatchRide()`** — compute what the reordering *would* produce, log it, but don't actually reorder the live array yet (both flags stay off; a separate shadow-logging flag could gate this if useful) — validates real-world signal (are there ever enough favorites/participating drivers in a given area to matter) before affecting real riders.
5. **Enable behind flags**, one feature at a time (`favorite_driver_preference_enabled` first, since it has no legal-review gate; `women_driver_preference_enabled` only after §A.10's legal/policy sign-off), starting with a narrow rollout if this codebase's flag system supports partial rollout, otherwise a short monitored full rollout with an immediate rollback plan (§ below).
6. **"Wait longer for a favorite driver" future mode** (§B.8) — explicitly deferred past v1, its own design pass later.
7. **HTAF admin-assignment hint** (§A.8) — explicitly deferred past v1, its own design pass later.

# Rollback strategy

Both features are additive and flag-gated at every layer:
- Disabling either `system_flags` entry immediately reverts dispatch to today's unmodified nearest-driver behavior — no code deploy needed for an emergency rollback, matching the existing `dispatch_paused`-style operational lever already in this codebase.
- The pure scoring functions never mutate data — a rollback of the scoring step alone has zero data cleanup implications.
- The new tables (`rider_preferences`, driver opt-in fields, `rider_favorite_drivers`) can remain in place harmlessly while flags are off; no destructive rollback is required at the schema layer even in a full feature abandonment scenario — they simply stop being read.
- If a driver's or rider's stored preference/opt-in data itself needed to be purged (e.g., a driver fully rescinding consent, not just toggling off), that's a deletion of their own row(s), already covered by the "changeable/removable at any time" requirement (§A.3, §B.2) — not a schema rollback.

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

**Both:** full test suite green, `node -c server.js` clean, new `lib/*.test.js` coverage for every pure function, and this document's open items (Part D) either resolved or explicitly re-flagged as accepted risk before implementation begins.
