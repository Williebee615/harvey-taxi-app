# PROPOSAL: Cancellation fees, driver compensation and scheduled rides

**For the owner's decision. Nothing here is active or promised.**

- Every cancellation is free today, and the database refuses any non-zero fee.
- The rules that would decide *whether* a fee applies are in `docs/policy-cancellation-noshow-draft.md` and are recorded (not charged) since PR #193 (live 2026-10-04).
- This proposal covers the three things only the owner can decide: **fee amounts**, **driver compensation** and **scheduled-ride rules**.

Prepared 2026-10-05. **No future fee activation is approved by this document;** each step below needs the owner's separate approval.

## Facts this is based on
- **Fare rules** (`lib/pricing.js`): $5 base fare + $0.90 per mile + $0.35 per minute + a $2 booking fee, with an $8 minimum fare. Drivers receive 70% of the eligible fare.
- **Production trips so far:** 11 completed, averaging $25.11 (lowest $9.50, highest $40.69). This is too small a sample to set prices from; treat it as a rough guide only.
- **Card payments:** the fare is held on the rider's card when they book (Stripe manual capture) and charged when the trip ends. Stripe's documentation says:
  - a business can capture *less* than the hold, and the remainder is released automatically;
  - usually only **one** capture is allowed per hold;
  - an online card hold usually lasts **7 days**;
  - some card statements don't separate holds from charges.

  So a fee would be taken from the existing hold with no second card entry. This is unverified for Harvey's account and must be tested in Stripe test mode first.
- **Processing costs:** Stripe charges a fee on every captured payment, so a small cancellation fee loses a larger share to processing. Check current rates in the Stripe Dashboard; they aren't quoted here.

## Decision 1: fee amounts

| Option | Late cancellation | No-show | Pros | Cons |
|---|---|---|---|---|
| **A. Flat** | $5 | $7 | Simple to show and explain | Can be a large share of an $8–10 trip |
| **B. Flat, capped at the fare** *(recommended)* | $5, never more than the trip's estimated fare | $7, same cap | Fair on short trips; still simple | Slightly longer to explain |
| **C. Booking fee + driver time** | $2 + $0.35 × minutes the driver drove toward the pickup | Same, plus waiting time | Matches the driver's actual time | Harder to show as one exact amount in advance; depends on progress records |
| **D. Percentage** | 25% of the estimated fare | 35% | Scales with the trip | Small on short trips; less predictable |
| **E. No fees yet** | $0 | $0 | No payment risk; collect records first | Drivers are not compensated for wasted trips |

**Recommendation:** start with **E** (no fees) for 30 days using the records from #193. Then move to **B** with amounts set from that data.
- Report to review first: how many cancellations the draft rules would have charged, how many were waived and why, and how often arrival verification fails.
- The amounts above are placeholders for discussion, not a recommendation of specific prices.

## Decision 2: driver compensation

| Option | What the driver gets | Notes |
|---|---|---|
| **1. 100% of the fee** *(recommended)* | The whole cancellation or no-show fee | Simplest, and clearly fair to drivers; Harvey absorbs processing |
| **2. Same split as trips** | 70% (today's `DRIVER_PAYOUT_PERCENT`) | Consistent with fares; Harvey covers processing from its 30% |
| **3. Fixed minimum** | For example $4 per qualifying no-show, even if the fee is waived for the rider | Protects drivers when a fee is waived; Harvey pays it |
| **4. None** | Nothing (today's behavior) | Drivers bear the cost of wasted trips |

**Also to decide:**
- whether a driver who releases rides often ("I can't make this pickup") is reviewed, and at what threshold;
- whether no-show compensation is paid when the rider's fee is later refunded after a support review.
- the no-show rule relies on a **dial attempt** (the driver tapped Call rider). That isn't proof the call connected; decide whether that's enough evidence for a fee, or whether in-app calling that confirms a connection is needed first (a paid service).

## Decision 3: scheduled rides

| Option | Free until | After that |
|---|---|---|
| **A** *(recommended)* | 60 minutes before the scheduled pickup | Same rules as on-demand rides |
| **B** | A driver is assigned | Same rules as on-demand rides |
| **C** | 24 hours before | A flat late fee |

**Also to decide:** what happens if Harvey can't assign a driver for a scheduled ride. Recommended: always free, recorded as a Harvey service failure.

## What approval would unlock (not started)
Each item below is built and tested with Stripe test cards and synthetic accounts, then device-tested on all four targets, before anything is published or charged:
1. **Turn on the fee:** a migration relaxing `rides_cancellation_fee_not_active_check`, plus the amounts in `lib/cancellationRecords.js` (the preview then shows the real amount).
2. **Charge only the fee:** capture `amount_to_capture` = the fee from the existing hold, and never a fee together with a fare.
3. **Refunds:** a refund action for fees reversed after a support review.
4. **Driver pay:** earnings records for the driver's share.
5. **Scheduled rides:** cancellation rules for scheduled rides.
6. **No-show switch:** turn on `driver_no_show_enabled` after device testing.
7. **Publish:** the policy text in the Terms and Policies, as an approved assistant answer, and on app-store listings; counsel review first.
