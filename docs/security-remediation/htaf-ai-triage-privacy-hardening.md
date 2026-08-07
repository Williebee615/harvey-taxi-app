# HTAF Fix 3 of 3 — AI Triage Privacy Hardening

Status: **third and final fix from `docs/security-remediation/
htaf-admin-pii-audit.md`** (finding 6). Scoped narrowly to the triage
payload and its recommendation vocabulary. Admin roles, rider auth,
rate limiting, HTAF eligibility rules, OpenAI configuration generally,
and any UI beyond what falls out naturally from the new response
vocabulary are untouched.

## Review round 2 (before merge)

One correction: **`household_size_band` and `monthly_income_band` were
removed entirely from `buildHtafTriageFacts()` and the prompt — not
coarsened, excluded.** The first pass banded these instead of sending
exact values, but once AI triage is explicitly limited to operational
categorization/completeness/workflow prioritization rather than
eligibility, income and household size have no necessary function in
that scope at all — a coarse band still exposes socioeconomic
information and still invites the model to reason about financial
circumstances (the prompt had explicitly told it to flag "an
inconsistent household_size_band/monthly_income_band pairing," which is
exactly that kind of reasoning). No replacement financial/household
proxy was added. The system prompt's evaluation scope is now stated as
an explicit, closed list — missing operational information, service-area
inconsistencies, past/invalid ride dates, missing/vague
transportation-need detail, and workflow/data inconsistencies — with an
explicit instruction that it must not evaluate financial need, household
composition, medical need, or eligibility.

Also reworded one code-comment claim per review: "the AI is never given
a protected or sensitive trait" overstated the guarantee, since
`program_type` itself can sometimes imply a sensitive circumstance (e.g.
`medical`, `disability`) and is kept anyway because triage needs some
operational category to function. The comment now reads: "The AI is not
provided direct identifiers, exact financial information, street-level
location, medical narrative, or other unnecessary sensitive details, and
is prohibited from using operational categories to infer protected or
sensitive characteristics" — a claim about what's excluded and what the
model is instructed not to do, not a claim that the payload contains
nothing sensitive at all.

The marker-string regression test was strengthened to assert
`household_size`/`monthly_income`, in any form (exact or banded), are
absent from the payload's own keys, not just absent as substrings of the
JSON. Full suite re-run: 389/389 passing after this round.

## Step 1: trace the exact object sent to OpenAI, before changing anything

Read `triageHtafApplication()` (`server.js`, pre-change) directly. The
`facts` object it built and sent as the `user` message, verbatim:

```js
const facts = {
  application_code: application.application_code,
  status: application.status,
  program_type: application.program_type,
  applicant_type: application.applicant_type,
  county: application.county,
  city: application.city,
  pickup_city: application.pickup_city,
  destination: application.destination,
  ride_date: application.ride_date,
  household_size: application.household_size,
  monthly_income: application.monthly_income,
  transportation_need: application.transportation_need,
  existing_notes: application.notes || null,
  submitted_at: application.created_at
};
```

Confirmed via code reading (not assumed) that `first_name`, `last_name`,
`email`, `phone`, and `ride_id` were already excluded — that part of the
original design was sound. The rest is classified below.

## Step 2: field-by-field classification

| Field | Classification | Disposition |
|---|---|---|
| `application_code` | Unnecessary/removable | Dropped entirely. The route already knows which application it's triaging via the URL param; the AI's response doesn't need to echo an identifier back, and this is a per-application identifier the AI has no operational need for. |
| `status` | Necessary for triage | Kept as-is — low sensitivity, helps the AI calibrate (e.g. don't suggest anything for an already-decided application). |
| `program_type` | Necessary for triage | Kept as-is. Already a closed 8-value enum (`normalizeProgramType()`), the core operational categorization this whole feature exists to help with. Removing it would defeat the purpose of triage. |
| `applicant_type` | Useful but replaceable | Normalized against the known dropdown values (`self`/`parent`/`caregiver`/`caseworker`/`socialworker`) server-side; anything else collapses to `"unspecified"`. The public form's `<select>` already constrains this in normal use, but the server never validated it at submission time — this closes that gap defensively for the one place it now matters most. |
| `county` (home) | Unnecessary/sensitive as raw text | Never included raw. Used only internally to derive `home_in_service_area` (boolean). |
| `city` (home) | Unnecessary/sensitive as raw text | Same treatment as `county` — internal-only fallback for the same derived boolean. |
| `pickup_city` | Unnecessary/sensitive as raw text | Never included raw. Despite the label, this field is used elsewhere in this codebase (the create-ride route) as a fallback full pickup **address**, not just a city name — so passing it through as "just a city" would have been unsafe. Used only internally to derive `pickup_in_service_area` (boolean). |
| `destination` | Unnecessary/sensitive as raw text | Never included raw. The form's own placeholder ("Hospital, School, Employer") shows this is a venue/destination name, not a city — e.g. a specific clinic name can itself reveal a medical condition. Used only internally to derive `destination_in_service_area` (boolean). |
| `ride_date` | Necessary for triage | Kept as-is. A single future/past date has low re-identification risk on its own, and it's the field the original design already used for a real, useful check ("is this ride date in the past"). |
| `household_size` | Unnecessary/removable, not merely coarsen-able | **Excluded entirely (not banded — see review round 2).** Once triage is limited to operational categorization/completeness/prioritization rather than eligibility, household composition has no necessary function in that scope, and even a coarse band still exposes and invites reasoning about a socioeconomic circumstance. |
| `monthly_income` | Unnecessary/removable, not merely coarsen-able | **Excluded entirely (not banded — see review round 2).** Same reasoning as `household_size`: no necessary operational function once eligibility judgment is out of scope, and a band is still financial information the model can reason about. |
| `transportation_need` (free text) | Unnecessary/sensitive, removable as raw text | Never included raw — this is applicant-authored free text that can contain medical detail. Replaced with `transportation_need_detail`: `missing` / `brief` / `detailed`, preserving the original "flag a missing/vague need description" check via presence and rough length instead of content. |
| `existing_notes` (`application.notes`) | Unnecessary/sensitive, removable as raw text | Never included raw. This is **admin-authored** free text with no schema constraint at all — an admin could have written anything into it, including medical detail they were personally told. Not called out explicitly in the original scope list, but excluded here under the same "no unnecessary free text" principle, since sending it served no clearly necessary triage purpose. Replaced with `has_prior_admin_notes` (boolean): does prior context exist, without revealing what it says. |
| `submitted_at` (`created_at`) | Necessary, low-risk | Kept as-is — a timestamp doesn't reveal identity and is useful for staleness/ordering context. |

**Result: no name, email, phone, application code, street address,
income (exact or banded), household size (exact or banded), or
unconstrained free text is ever sent to OpenAI for HTAF triage.**

## Step 3: the minimized payload

`buildHtafTriageFacts(application)` (new, `lib/htafOperations.js`) is
now the **only** place in the codebase that decides what an HTAF
application looks like to OpenAI. Built and called entirely
server-side (`triageHtafApplication()` → this function) — the browser
never sees or influences this payload; there is no client-side
parameter that could add a field back.

```js
{
  status,                          // pass-through, closed operational state
  program_type,                    // pass-through, closed 8-value enum
  applicant_type,                  // normalized to known values or "unspecified"
  home_in_service_area,            // boolean|null, derived from county/city text
  pickup_in_service_area,          // boolean|null, derived from pickup_city text
  destination_in_service_area,     // boolean|null, derived from destination text
  ride_date,                       // pass-through, a single date
  transportation_need_detail,      // "missing" | "brief" | "detailed"
  has_prior_admin_notes,           // boolean
  submitted_at                     // pass-through, a timestamp
}
```

No household-size or income field, exact or banded, appears anywhere in
this object — there is no key for it at all.

The service-area booleans are the one place this design goes slightly
beyond simple removal: rather than just dropping the original "is this
outside Nashville/Davidson County" check along with the address text it
needed, `textMentionsServiceArea()` reads the raw
`county`/`city`/`pickup_city`/`destination` strings **internally only**
and returns a boolean — the strings themselves never appear anywhere in
the function's return value. This is the "operational categorization
... not raw narrative text" principle applied directly: the check the
original design cared about survives; the address/venue text it used to
require does not.

## Step 4: the recommendation vocabulary — an explicit policy choice

The original recommendation enum was `approve | deny | request_info |
review`. This hardening pass changes it to:

```
ready_for_review | request_info | priority_review | data_inconsistency
```

**`approve` and `deny` were removed entirely, not just data-minimized.**
This is the "important policy choice" flagged explicitly: HTAF triage
should help a human categorize and prioritize incoming applications, it
should not produce anything shaped like an eligibility decision, even
as a "mere suggestion" a busy admin might rubber-stamp. Read narrowly,
"cannot approve/deny/rank based on protected traits" could be satisfied
by just telling the model not to *use* protected traits while still
letting it recommend `approve`/`deny` — but given the same instruction
also says triage "should ideally help with operational categorization
and prioritization — not make eligibility decisions or medical
judgments," the safer and more literal reading is that the vocabulary
itself should not be able to express an eligibility decision at all.
Removing `approve`/`deny` from what the model can even say enforces
that boundary structurally, not just through a prompt instruction that
could be ignored or drift over time. **Flagging this interpretation
explicitly in case it should be read more narrowly** — the fields feeding
the model are minimized either way; only this taxonomy choice is a
judgment call beyond the literal field-removal list.

No admin-facing UI code needed to change: `admin-htaf.html` only ever
runs `formatStatus()` (generic underscore-to-space + capitalization) on
`lastTriage.recommendation` — it renders whatever string comes back
without any hardcoded comparison against `approve`/`deny`/etc. Confirmed
by grep before making this change.

## Explicit guardrails documented in code

All of the following are stated directly in `server.js`'s HTAF AI
TRIAGE header comment, immediately above the code that enforces them —
not just in this doc:

- **Advisory only.** The route never writes to `htaf_applications`; a
  recommendation only ever reaches the database if and when an admin
  manually clicks "Insert Into Notes" and then a status/notes save —
  both pre-existing, human-driven actions this PR doesn't touch.
- **The AI cannot approve, deny, or rank applicants based on protected
  or sensitive traits.** Enforced by removing `approve`/`deny` from the
  vocabulary it can even express (see Step 4) and by the code comment's
  precise claim: "The AI is not provided direct identifiers, exact
  financial information, street-level location, medical narrative, or
  other unnecessary sensitive details, and is prohibited from using
  operational categories to infer protected or sensitive
  characteristics." That wording is deliberate — `program_type` itself
  can sometimes imply a sensitive circumstance (e.g. `medical`,
  `disability`) and is kept anyway because triage needs some
  operational category to function, so claiming the payload contains
  "nothing sensitive" would overstate the guarantee. The system prompt
  additionally instructs the model not to let `program_type` (or
  anything else) function as a proxy for a protected characteristic.
- **Human admin makes the final decision.** Unchanged from the original
  design — the AI's output is a suggestion for a human to read and
  choose to act on or ignore.
- **No claim of "HIPAA compliant" processing** — stated explicitly in
  the code comment. Sending even minimized categorical data to a
  third-party model is a data-sharing decision that deserves its own
  legal/compliance review independent of this PR; this hardening
  reduces exposure, it does not resolve this codebase's pre-existing
  HIPAA/BAA legal-review TODO.
- **Auditable without storing unnecessary applicant PII in logs.** The
  audit log for every triage call (`htaf_application_ai_triaged`) now
  includes the exact `facts_sent` payload alongside the recommendation.
  This is safe specifically *because* `buildHtafTriageFacts()`'s
  allow-list — enforced by the tests below — guarantees it never
  contains PII; logging it gives a complete, inspectable record of
  exactly what left the server for every triage call.

## Tests

`lib/htafOperations.test.js`, new `describe("buildHtafTriageFacts (AI
triage privacy hardening)")` block (8 tests). The central test
constructs a full application row where **every** direct identifier and
sensitive field is set to a unique, greppable marker string (e.g.
`first_name: "MarkerFirstName"`, `pickup_city: "123 Marker Street,
Nashville Dialysis Center"`, `transportation_need: "Needs dialysis
three times a week, has MarkerCondition"`) and asserts those markers
**cannot appear anywhere** in `JSON.stringify(buildHtafTriageFacts(...))`
— proving the guarantee holds even when the forbidden data is present
on the input, not just when it happens to be absent. Also covered:
household size and monthly income — exact, banded, or under any key
name — are absent from the payload's own keys entirely, not just
absent as JSON substrings; the service-area booleans derive correctly
from marker text that itself never appears in the output; an
unrecognized/free-text `applicant_type` collapses to `"unspecified"`
instead of passing through; and a fully empty application degrades to
explicit `"unspecified"`/`"missing"`/`null` values rather than
throwing.

Full suite: **389/389 passing** (`npx jest`), no regressions. `node -c
server.js` clean.

### What these tests do not cover, and why

As with every prior HTAF PR in this sequence, this doesn't include a
live call to OpenAI or a route-level integration test — `server.js`
isn't `require()`-able without booting a real listener, and this
codebase has no mocked-OpenAI test harness. The pure-function tests
above cover the actual guarantee (what can and can't reach the payload,
and that the recommendation vocabulary is closed to
`HTAF_TRIAGE_RECOMMENDATIONS`); the route's wiring
(`triageHtafApplication()` → `buildHtafTriageFacts()` → OpenAI call →
audit log) was verified by direct code reading.

## Rollback plan

Trivial revert — no migration, no flag, no data touched. Reverting
restores the old `facts` shape and the `approve`/`deny`/`request_info`/
`review` vocabulary exactly as they were (including the original
privacy gap).

## Next items (separate, larger projects — not started here)

Per the agreed sequence: admin RBAC redesign (named roles — HTAF
caseworker, dispatcher, finance, support, compliance, super-admin —
replacing the flat `requireAdmin` model) and trusted-proxy/rate-limit
hardening (`getClientIp()`'s unvalidated `X-Forwarded-For` trust,
affecting every rate-limited endpoint app-wide). Both remain their own
dedicated PRs.
