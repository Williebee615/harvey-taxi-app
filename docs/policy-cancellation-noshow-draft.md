# DRAFT: Harvey Taxi Cancellation and No-Show Policy

**Status: draft for the owner's review. Not published, not in effect, not an approved assistant source.**

- **All cancellations are free.** No cancellation or no-show fee is charged, and the database refuses any fee other than $0.
- **No fee promises are made in the apps.** The apps state only that cancelling is free right now.
- **Do not publish this text** in the Terms, on `/policies.html`, in the assistant's approved knowledge or on app-store listings until:
  1. the owner has decided the items in `docs/proposal-cancellation-fees.md`;
  2. every **[NOT LIVE]** clause below matches tested behavior on all four app targets;
  3. counsel has reviewed it.
- Applies to Harvey Taxi Service LLC's rider and driver apps on iPhone and Android, and to harveytaxiservice.com.
- Recommend review by legal counsel; this draft is not legal advice.

Updated 2026-10-05 to the owner's structure, against the controls built in PR #193.

---

## Policy text (original Harvey Taxi wording)

Markers:
- **[NOT LIVE]**: built, but not switched on or charging; must not be promised until the owner approves.
- **[OWNER DECISION]**: the owner must decide.

### For riders

**Cancelling for free**
You can cancel your ride without charge:
- before a driver accepts it; and
- for 2 minutes after a driver accepts it.

**When a cancellation fee may apply** [NOT LIVE]
After those 2 minutes, a cancellation fee may apply only if your driver is on the way and making progress toward your pickup when you cancel.

**When you won't be charged**
You won't be charged a cancellation fee if:
- your driver isn't making progress toward your pickup;
- your driver is at least 5 minutes later than the pickup time we showed you when they accepted; or
- Harvey Taxi cancels your ride or can't complete it because of a problem on our side, such as no available driver or a technical failure.

If we can't confirm any of these from our records, we don't charge you.

**You'll always see the exact fee first**
The cancel screen shows the exact amount you'll be charged, if any, before you confirm. If the amount changes before you confirm, we ask you to review it again. Today the amount shown is always $0.00.

**No-shows** [NOT LIVE]
If you're not at your pickup, your driver can mark the ride as a no-show only after all three of these:
1. the app has confirmed by location that the driver arrived at your pickup;
2. the driver has waited at least 7 minutes; and
3. the driver has tried to reach you through the app.

[OWNER DECISION: whether a no-show fee applies, and how much.]

**One charge at most**
A cancelled ride is never also charged the trip fare. A cancellation or no-show fee is never combined with a full trip fare or a separate waiting charge for the same ride. Harvey Taxi doesn't currently charge a waiting fee.

**Card holds aren't charges**
When you book, we place a temporary hold on your card for the estimated fare. When you cancel without a fee, the whole hold is released. Some banks keep showing a released hold as "pending" for a few days. A completed charge appears separately on your statement.

**Asking us to review a cancelled ride**
After cancelling, tap **Ask support to review this ride**, or contact support@harveytaxiservice.com. Use it if:
- you cancelled or missed your driver because of a safety concern;
- the pickup location, arrival or driver details we recorded are wrong; or
- you believe you were charged in error.

You review and approve the request before it's sent, and we review the ride's records and reply.
- [OWNER DECISION: target response time.]
- [NOT LIVE: refunding a fee, as no fees are charged.]

**Scheduled rides** [OWNER DECISION]

### For drivers

**Contacting the rider.** Use **Call rider** in the app. The app records that you tried to reach the rider; the call itself isn't recorded.

**Arriving.** When you tap **I've arrived at pickup**, the app records your location to confirm you're at the pickup. You can always mark arrival. A confirmed arrival is needed before a no-show.

**Waiting and no-shows.** The app shows how long you've waited at the pickup. Marking a rider as a no-show [NOT LIVE] is available only after a confirmed arrival, 7 minutes of waiting and an in-app contact attempt. A no-show cancels the ride at no charge to the rider. [OWNER DECISION: no-show fee and driver compensation.]

**If you can't make a pickup.** Tap **I can't make this pickup**. The ride goes back to dispatch for another driver, and the rider is not cancelled or charged. [OWNER DECISION: whether repeated releases affect a driver's standing.]

**When a rider cancels.** [OWNER DECISION: driver compensation for late cancellations and no-shows.] Today drivers aren't paid for cancelled rides.

**Safety first.** Never wait somewhere unsafe to meet a no-show requirement. Leave, then contact support, and we'll review the ride.

---

## What is built and tested (PR #193, not merged)

| Policy element | Control or record | Tested | Live? |
|---|---|---|---|
| Free before acceptance and for 2 minutes after | `accepted_at`; rule `within_free_window` | Unit and server | Records at merge; all cancellations are free regardless |
| Fee only while the driver progresses | `pickup_progress_at` from location updates (≥50 m closer within 3 min) | Unit and server | Recorded only |
| Waived: no progress, 5+ min late, Harvey failure | `eta_at_accept_minutes` / `pickup_due_at`; categories `harvey_service_failure`, `admin_incident`; a missing record waives | Unit and server | Recorded only |
| Exact fee before confirming | `GET /api/rides/:id/cancel-preview`; cancel checks `expected_fee_cents` (409 if changed) | Server and browser | Shows $0.00 |
| Verified arrival | Arrival check on "Arrived" (≤150 m, fix ≤2 min old, accuracy ≤100 m) | Unit, server and driver app | Recorded only |
| Recorded contact attempt | `ride_contact_attempts`; Call rider logs, then dials | Server and driver app | At merge, after a new driver app build |
| 7-minute wait and no-show control | Waiting timer; `POST /api/driver/rides/:id/no-show` | Server and driver app | **Off** (`driver_no_show_enabled`) |
| Support dispute flow | `cancellation_review` request with the rider's cancelled ride attached; admin queue | Server and browser | At merge |
| No duplicate charges | Admin "cancelled + capture" refused; a cancelled ride can't be completed or charged; the hold is released once; DB holds fees at $0 | Server and DB | At merge |
| Release a ride (driver) | "I can't make this pickup" → existing withdraw route | Driver app | After a new driver app build |

**Not verified:**
- **Devices:** nothing has been run on a real iPhone or Android device.
- **Builds:** the driver apps need a new build.
- **Database:** the migration hasn't been applied to production.
