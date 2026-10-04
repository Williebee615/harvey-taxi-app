# DRAFT: Cancellation and No-Show Policy (rider and driver apps, iOS and Android)

**Status: draft for the owner's review. Not published, not in effect, and not an approved assistant source.**

- **No new charges are enabled.** Today every cancellation releases the card hold in full (see the audit).
- **Do not add this text** to `/terms.html`, `/policies.html` or the assistant's knowledge (`/admin-knowledge.html`) until:
  1. the owner has made the decisions marked **[OWNER DECISION]**;
  2. every clause marked **[NOT BUILT]** is implemented and tested on all four app targets;
  3. the wording below has been re-checked against that tested behavior.
- Recommend review by legal counsel before publication; this draft is not legal advice.

Audit date: 2026-10-04, against `main` at merge of PR #190 and the production database.

---

## 1. Audit: what the apps and payment system support today

### Ride states and timestamps

| Policy needs | Today | Evidence |
|---|---|---|
| Know when a driver accepted | **Supported.** `rides.accepted_at` is set when the driver accepts. | `supabase/migrations/20260927220400_accept_driver_offer_atomic.sql` |
| Know when the driver started toward pickup | **Supported.** `enroute_at` is set by the driver's "On my way" step. | `server.js`, `POST /api/driver/rides/:id/enroute` |
| Know when the driver arrived | **Partly.** `arrived_at` is set when the driver **taps** "Arrived". The server does **not** check that the driver is at the pickup location. | `server.js`, `POST /api/driver/rides/:id/arrived` → `performDriverRideTransition` |
| Original pickup estimate | **Not kept.** `driver_eta_to_pickup_minutes` is overwritten as the driver moves (persistence is on in production). The estimate shown at acceptance is not stored separately. | `persistRideEtaToPickup()` in `server.js` |
| Driver progress toward pickup | **Not recorded per ride.** The driver's latest position is stored on the driver record. There is no per-ride location trail to show whether the driver was getting closer. | no location-history table |
| Who cancelled, when and why | **Supported.** `cancelled_at`, `cancelled_by_type` (rider/admin), `cancelled_by_id`, `cancellation_reason`. | `handleRideCancellation()` |

### Cancelling

| Policy needs | Today | Evidence |
|---|---|---|
| Rider cancels before a driver accepts | **Supported, free.** | `lib/rideCancellation.js` (`CANCELLABLE_STATUSES`) |
| Rider cancels after acceptance, before pickup | **Supported, free.** The driver is released and notified. | same |
| Rider cancels after the trip starts | **Not allowed** in the app; admin incident resolution only. | same |
| Rider cancel button in the apps | **Only through the assistant.** The rider web app (shown inside the iOS and Android shell) offers Cancel via the assistant's confirmed button. There is no standalone Cancel button on the ride screen. | `public/agent-assist.js`; the `/api/rides/:id/cancel` route comment |
| Driver ends an accepted ride | **Withdraw only.** This returns the ride to dispatch and does not cancel the rider's request. The route exists, but **neither driver app shows it**. | `POST /api/driver/rides/:id/withdraw`; no use in `driver-app/src` |
| Driver marks a no-show | **Not built.** There is no no-show action, status or record. | none |
| Harvey cancels (service failure) | **Admin only.** An incident resolution can cancel (`cancelled_by_type = admin`). There is no automatic "Harvey couldn't find a driver" cancellation reason. | `server.js` incident resolution |

### Contact, waiting and support

| Policy needs | Today | Evidence |
|---|---|---|
| Record that the driver tried to contact the rider | **Not built.** The driver app's "Call rider" opens the phone dialer with the rider's number. Nothing is logged, and calls aren't masked. | `driver-app/src/screens/HomeScreen.js` |
| Waiting time at pickup | **Not measured.** It can be derived from `arrived_at` → `trip_started_at`, but no timer is shown to the driver or rider. | ride timestamps |
| Separate waiting charge | **None exists.** The fare is base + distance + time (estimated) + booking fee and ride-type adjustments. | `lib/pricing.js` |
| Support review of disputes, safety and incorrect pickups | **Partly.** Riders and drivers can send a support request (case plus email to support@harveytaxiservice.com). There is no "dispute a fee" category, no refund workflow, and no way to reverse a fee. | `lib/agent/handoff.js`; `lib/rideCancellation.js` header ("Refunds are an explicit, separate workflow, not built here") |

### Payments

| Policy needs | Today | Evidence |
|---|---|---|
| Card hold before the ride | **Supported.** A Stripe PaymentIntent with `capture_method: manual` holds the quoted fare. | `server.js` `paymentIntents.create` |
| Charge at trip end | **Supported.** The full hold is captured at completion. | `paymentIntents.capture` |
| Release the hold on cancel | **Supported, always in full.** `paymentIntents.cancel` runs on every cancellation; a captured payment is never auto-reversed. | `reconcileCancellationPayment()` |
| Charge a cancellation or no-show fee | **Not built.** Stripe allows capturing *less* than the hold (`amount_to_capture`), releasing the rest automatically. Usually only **one** capture is allowed, and an online card hold is usually valid for **7 days**. | Stripe docs: "Place a hold on a payment method" |
| Show the fee before the rider confirms | **Not built.** The confirm text today is "There is no cancellation fee in the current phase." | `lib/agent/assistant.js` |
| Scheduled rides | **Partly.** A ride can be held for dispatch at `scheduled_time`. There are no scheduled-ride cancellation rules. | `server.js` scheduled dispatch |
| Driver pay for cancellations | **None.** Driver earnings are written only for completed trips. | `server.js` driver earnings insert |

**Production data (2026-10-04):** 12 rides in total: 11 completed and 1 cancelled by an admin. **None had a card payment attached**, so no cancellation has ever involved a real card hold.

---

## 2. Draft policy text (original wording for Harvey Taxi)

Markers:
- **[NOT BUILT]**: the app can't do this yet; the clause must not be published until it can.
- **[OWNER DECISION]**: the owner must decide.

### Harvey Taxi Cancellation and No-Show Policy

This policy explains when you can cancel a ride without charge, when a cancellation or no-show fee may apply, and how to ask us to review a fee. It applies to the Harvey Taxi rider and driver apps on iPhone and Android and to harveytaxiservice.com.

#### For riders

**1. Free cancellation**
You can cancel without charge:
- any time before a driver accepts your ride; and
- within **2 minutes** after a driver accepts it.

**2. When a cancellation fee may apply** [NOT BUILT]
If you cancel more than 2 minutes after a driver accepted, a cancellation fee may apply, but **only if the driver was making progress toward your pickup** when you cancelled.

**3. When no cancellation fee applies**
You won't be charged a cancellation fee if any of these is true:
- the driver wasn't making progress toward your pickup [NOT BUILT: progress isn't recorded];
- the driver is at least **5 minutes** later than the pickup estimate shown when they accepted [NOT BUILT: the original estimate isn't kept];
- Harvey Taxi cancelled the ride because of a service problem on our side, such as no available driver, a technical failure or a driver withdrawing [NOT BUILT: no automatic service-failure reason].

**4. No-shows** [NOT BUILT]
If you're not at the pickup, the driver may mark the ride as a no-show, and a no-show fee may apply, only when all three of these are true:
1. the app confirmed the driver arrived at the correct pickup location;
2. the driver waited at least **7 minutes** after arriving; and
3. the driver tried to contact you through the app.

**5. You'll see any fee before you confirm** [NOT BUILT]
If a cancellation fee would apply, the app shows the amount on the cancel screen before you confirm. If you don't see a fee there, none will be charged for cancelling.

**6. No double charges**
A cancellation or no-show fee is never charged together with the full trip fare or a separate waiting charge for the same ride. (Harvey Taxi doesn't currently charge a separate waiting fee.)

**7. Card holds and charges**
When you book, we place a temporary hold on your card for the estimated fare. A hold is **not** a charge.
- If you cancel without a fee, we release the whole hold.
- If a fee applies, we charge only the fee, and the rest of the hold is released [NOT BUILT].
- Your bank decides how long a released hold stays visible, and some banks show holds as pending transactions for several days.
- If you see a completed charge you don't recognize, contact support.

**8. Asking us to review a fee or a ride** [PARTLY BUILT]
Contact Harvey Taxi support from the app or at support@harveytaxiservice.com if:
- you had a safety concern that led you to cancel or not meet the driver;
- the pickup location or arrival shown for your ride was wrong; or
- you believe a fee was charged in error.

We'll review the ride records and reply.
- [OWNER DECISION: target response time.]
- [NOT BUILT: fee refund or reversal when a review finds in your favor.]

**9. Fee amount** [OWNER DECISION]
The cancellation fee is [amount]. The no-show fee is [amount]. See Section 4 of this draft for options.

**10. Scheduled rides** [OWNER DECISION]
[Free-cancellation window and fee rules for rides booked in advance.]

#### For drivers

**1. When a rider cancels.** If a rider cancels after you accepted and a cancellation fee applies, [OWNER DECISION: how much of the fee you receive]. If no fee applies, you're not paid for the cancelled ride.

**2. Marking a no-show** [NOT BUILT]
You can mark a rider as a no-show only after:
- the app has confirmed you're at the correct pickup;
- you've waited at least 7 minutes; and
- you've tried to contact the rider through the app.

The app shows a waiting timer and enables the No-show button when these are met.

**3. Withdrawing from a ride.** If you can't complete a ride you accepted, use Withdraw. The ride goes back to dispatch, and the rider isn't charged a cancellation fee because of your withdrawal. [NOT BUILT: Withdraw isn't in the driver apps yet.] [OWNER DECISION: whether repeated withdrawals affect a driver's standing.]

**4. Safety first.** Never wait in an unsafe place to qualify for a no-show. Leave, then contact support; we'll review the ride.

**5. Reviews.** Riders can dispute a fee. Your arrival, waiting and contact records are what support reviews, so keep the app open and use in-app contact.

---

## 3. Implementation gaps (what must be built and tested before publishing)

Each item needs server tests, and a device check on all four targets (rider iOS, rider Android, driver iOS, driver Android) before its clause is published.

| # | Gap | Needed for clause | Size |
|---|---|---|---|
| G1 | Keep the **original pickup estimate** at acceptance (new column, e.g. `eta_at_accept_minutes`, plus `eta_due_at`). | Rider 3 (5-minute late rule) | Small |
| G2 | **Driver progress toward pickup:** store distance-to-pickup samples per ride (or the first and last distance after acceptance) and define "progress" (for example, distance fell by at least 0.1 mi in the last 3 minutes). | Rider 2, 3 | Medium |
| G3 | **Verified arrival:** on "Arrived", compare the driver's current location (fresh, accurate) with the pickup point (for example, within 150 m) and record the result. | Rider 4, Driver 2 | Small–medium |
| G4 | **No-show action:** a new driver route and status or outcome (`no_show`), allowed only when G3, a 7-minute wait and G5 are met; buttons in both driver apps with a waiting timer. | Rider 4, Driver 2 | Medium |
| G5 | **In-app contact attempt logging:** log a "Call rider" or "Message rider" tap on the ride. Masked calling (Twilio Proxy or similar) is an optional, paid upgrade [OWNER DECISION]. | Rider 4, Driver 2 | Small (logging); medium plus cost (masking) |
| G6 | **Fee calculation:** one server function that decides fee or no fee, with the reason, from G1–G5, ride timestamps and who cancelled. Unit-tested against every clause. | all fee clauses | Medium |
| G7 | **Show the fee before confirming:** the cancel preview returns `fee_cents` and the reason, the confirm screen shows it, and the server rejects a cancel whose shown fee doesn't match (price-change protection). Update the assistant's confirm text. | Rider 5 | Medium |
| G8 | **Charge only the fee:** capture `amount_to_capture = fee` from the existing hold (the remainder releases automatically). Idempotent, resumable, audited. Fall back to no fee if the hold expired or the capture fails; never create a new charge without consent. | Rider 7 | Medium |
| G9 | **Never double-charge:** a ride that captured a fee can't capture a fare, and vice versa. One capture per PaymentIntent enforces this, plus a server check and tests. | Rider 6 | Small |
| G10 | **Service-failure cancellations:** a distinct reason (`harvey_service_failure`, `no_driver_found`) set automatically by sweeps and admin, always fee-free. | Rider 3 | Small |
| G11 | **Fee review and refund:** a support case category "Fee review" and an admin action to refund a captured fee (Stripe refund), with an audit trail and rider notice. | Rider 8 | Medium |
| G12 | **Driver Withdraw** in both driver apps (the route exists). | Driver 3 | Small |
| G13 | **Driver share of fees:** an earnings record for a fee-bearing cancellation, per the owner's split. | Driver 1 | Small, after decision |
| G14 | **Scheduled rides:** rules per the owner's decision. | Rider 10 | Depends on decision |
| G15 | **Rider cancel button** on the ride screen (not only through the assistant), showing the G7 preview. | Rider 1, 5 | Small |
| G16 | **Publishing:** Terms / Policies page, an approved assistant article, and app-store description or in-app notice, *after* tests pass. | all | Small |

**Recommended order:**
1. G1, G10, G15, G12. These are free to build and have no new charges.
2. G3, G5, G2.
3. G6, G7, G9.
4. G4.
5. G8, G11, G13: the first that move money. Test them with Stripe test cards and synthetic accounts only.
6. Publish (G16).

---

## 4. Fee options for the owner's decision [OWNER DECISION]

Today's fare inputs (`lib/pricing.js`): base fare, $0.90 per mile, $0.35 per minute, a $2 booking fee, plus ride-type adjustments.

| Option | How the fee is set | Pros | Cons |
|---|---|---|---|
| **A. Flat fee** | One amount for late cancellation (for example $5) and one for no-show (for example $7) | Simple to explain and show; common in the industry | Can be more than a very short trip's fare |
| **B. Flat fee, capped at the fare** | As A, but never more than the ride's estimated fare | Fair on short trips; still simple | Slightly more to explain |
| **C. Time-based** | Booking fee + $0.35 × minutes the driver spent driving to the pickup | Ties the fee to the driver's actual time | Harder to show in advance; depends on G2 data |
| **D. Percentage** | A percentage of the estimated fare (for example 25%) | Scales with the trip | Unpredictable for riders; small on short trips |
| **E. No fees yet** | Keep today's behavior (free cancellation always) and build G1–G7 for transparency only | No payment risk; builds the records first | No compensation for drivers' wasted trips |

**Driver compensation options:**
1. The driver receives 100% of the fee.
2. A fixed split (for example 80% driver / 20% Harvey to cover payment processing).
3. Harvey keeps the fee.

**Card processing note:** Stripe's processing charge applies to a captured fee, so a very small fee loses a larger share. Confirm current rates in the Stripe Dashboard.

**Scheduled-ride options:**
1. Free cancellation until 60 minutes before pickup, then the same rules as on-demand rides.
2. Free until the driver is assigned.
3. A flat late fee within a set window.

**Recommendation for a first version:** Option B for late cancellations and no-shows, with 100% to the driver, launched only after G1–G11 are built and tested.

---

## 5. Before publishing (checklist)

- [ ] Owner decisions recorded: fee amounts, driver share, scheduled rides, support response time, masked calling.
- [ ] G1–G16 built; server tests cover each clause; the regression set is extended with cancellation and no-show questions.
- [ ] Device-tested on rider iOS, rider Android, driver iOS and driver Android, with test data and Stripe test cards. Results recorded in `docs/ai-four-targets.md` style.
- [ ] This text re-checked against tested behavior; every [NOT BUILT] marker removed or its clause cut.
- [ ] Counsel review (consumer-protection and card-network rules on fees and holds).
- [ ] Published on the Terms / Policies page with a "Last updated" date. Approved as an assistant knowledge article. App Store and Google Play listings checked for any statement about fees.
- [ ] The assistant's cancel confirmation updated from "There is no cancellation fee in the current phase".
