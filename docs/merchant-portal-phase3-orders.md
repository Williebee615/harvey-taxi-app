# Phase 3: orders (design for owner review)

**Prepared:** 2026-10-18 (UTC). **Status:** design only. No code, no migration, no Stripe change.

**[Owner decision 2026-10-18]** "Start the Phase 3 orders design document."

Labels: **[Verified]** = checked in the code or production on the date shown. **[Decision]** = needed from the owner. **[Recommendation]** = what I propose. **[Blocked]** = waits on the accountant, counsel or Stripe. **[Unresolved]** = open, no one assigned yet.

Related: `docs/merchant-portal-plan.md` (phases, merchant terms 1–8, refund engine §4b, catalog §4d), `docs/agent-action-rules.md` (rule 8: a person approves money movements), `docs/delivery-center.md`.

---

## 1. Summary

Phase 3 lets a rider order items from an approved store and pay once for items, tax, delivery fee and tip. The store accepts or rejects the order and marks it ready. The order is linked to a delivery trip that uses the existing driver flow.

- **Test mode only.** Phase 3 is built and demonstrated with Stripe test keys and synthetic stores. Real orders need: the accountant's sales-tax advice, counsel's merchant agreement and rider-terms update, phase 5 (store payouts), and at least 5 verified drivers (pilot precondition, term 6).
- **Off by default.** A new switch `ENABLE_MERCHANT_ORDERS` (default off) gates everything. Delivery booking stays paused (#260) until the owner turns both on.
- **No new money rules.** Commission, the grocery buffer, substitution timeouts, missing-item refunds and payout weeks already live in `lib/refundEngine.js` (§4b of the plan). Phase 3 calls them.
- **People approve money.** Placing an order authorizes the card. Capturing the final amount is automatic and bounded by what the rider authorized. Every refund except a full release before capture goes through a staff-approved proposal (agent rule 8).

## 2. What exists today **[Verified 2026-10-18, code]**

| Part | State | Phase 3 use |
|---|---|---|
| Stores | `merchants` (applications, approval), `merchant_users` (phone sign-in), `merchant_hours` (one window per weekday, Nashville time). Live in production. | Only approved stores that are open now can take orders. |
| Catalog | `catalog_items`: price in cents, `available`, `substitutable`, `review_status` (`listed` / `held` / `blocked`). Live in production; 0 items. | Only `listed`, `available` items can be ordered. Prices are copied into the order at checkout. |
| Rider payment | Rides use a Stripe PaymentIntent with `capture_method: manual`: the card is authorized at booking and captured later. | Orders use the same pattern, one authorization per order. |
| Delivery trip | `rides` with `ride_type` food or grocery, `delivery_stage` (order accepted → heading to store → arrived → waiting for order → picked up → heading to customer → arrived → delivered), PIN or photo handoff, `merchant_name` and `item_count` as free text, `tip_amount`. | The order creates and links its delivery trip; free-text store fields are filled from the order. |
| Switches | `ENABLE_DELIVERY`, `ENABLE_FOOD_DELIVERY`, `ENABLE_GROCERY_DELIVERY`: enforced, off by default. | Unchanged; orders also need `ENABLE_MERCHANT_ORDERS`. |
| Money rules | `lib/refundEngine.js`: `commission`, `itemAuthorizationCents`, `substitutionOutcome`, `planMissingItemRefund`, `buildRefundProposal`, `merchantDeductionStatus`, `payoutWeek`. | Called as-is. |

## 3. Order lifecycle

```
placed ──► accepted ──► ready ──► picked_up ──► delivered ──► completed
  │           │           │
  │           └► cancelled_by_store (before pickup)
  ├► rejected (store says no)
  ├► expired  (store doesn't answer in time)
  └► cancelled_by_rider (before the store accepts)
```

| State | Entered when | Money |
|---|---|---|
| `placed` | The rider confirms checkout and the card authorization succeeds. | Card authorized for the order total (grocery: items + 15% buffer, term 5). Nothing captured. |
| `accepted` | The store accepts with a preparation time (5–90 minutes). | No change. The delivery trip is created now (§6). |
| `rejected` / `expired` / `cancelled_by_rider` | The store declines with a reason; the store doesn't answer within the response window (**[Decision D1]**); or the rider cancels before acceptance. | Authorization released in full. Nothing charged, no commission (term 1). |
| `ready` | The store marks the bag ready. | No change. |
| `cancelled_by_store` | The store cancels after accepting but before pickup (for example it can't fill the order). | Authorization released in full. Recorded against the store for review. |
| `picked_up` | The driver confirms pickup. | No change. (Phase 4 adds the pickup code shown in the portal.) |
| `delivered` | The existing PIN or photo handoff completes. | Final amount captured (§5.3). |
| `completed` | Capture succeeds. | Commission recorded; payout week assigned (`payoutWeek`); the 48-hour missing-item window starts. |

Rules:
- Every change of state is a conditional update from the expected previous state, so two people (or a person and a timer) can't both move an order. A lost race gets "This order changed. Reload."
- Every change is written to `order_events` (who, when, from, to, reason). Nothing is deleted.
- A rider cancellation after the store accepts is **[Decision D2]**.

## 4. Rider experience (Delivery Center)

1. **Stores:** approved stores that are open now and have at least one orderable item. A store whose prices may differ from in store shows "Prices may be higher than in store" (term 2).
2. **Store page:** items grouped by section; out-of-stock items shown but not addable.
3. **Cart:** one store per cart. Quantities 1–20 per item.
4. **Substitutions (term 5):** for each item the store marked substitutable, the rider picks "contact me", "store's best match" or "refund if out of stock". Other items are refunded if out of stock.
5. **Checkout breakdown, before paying:** items, sales tax (**[Blocked: accountant]**, §8), delivery fee (the existing quote), tip (**[Decision D3]**), total. Grocery orders also show "Your card may be held for up to 15% more to cover weights and substitutions; you pay only the final amount."
6. **Pay:** one authorization (**[Decision D4]**). The order key sent with checkout makes a double tap or retry create one order, not two.
7. **Tracking:** order state and, once a driver is assigned, the existing delivery tracking.

## 5. Payment design

### 5.1 One authorization per order **[Recommendation, Decision D4]**
One PaymentIntent (manual capture) covers items, tax, delivery fee and tip. The linked delivery trip doesn't create its own. Riders see one hold and one charge; a store rejection releases everything in one step.

### 5.2 What is authorized
- Non-grocery: items + tax + delivery fee + tip.
- Grocery: `itemAuthorizationCents` (items + 15%) + tax on that + delivery fee + tip.

### 5.3 What is captured at delivery
Fulfilled items (after substitutions and out-of-stock refunds) + their tax + delivery fee + tip, never more than was authorized. If substitutions would exceed the authorization, the store can't confirm that substitution; it is treated as out of stock and refunded under the rider's choice. Capture is automatic; it is the amount the rider already agreed to, so it isn't a refund or a payout and doesn't need a person (agent rule 8 covers refunds and payouts).

### 5.4 After capture
- **Missing items:** the rider reports within 48 hours of completion. `planMissingItemRefund` and `buildRefundProposal` prepare a proposal; staff approve it in the admin dashboard; only then does Stripe refund. Over 3 claims per customer per month go to manual review (`MONTHLY_CLAIM_LIMIT`).
- **Store's share:** recorded per order (item subtotal − 12% commission), adjusted by `merchantDeductionStatus`, assigned to a payout week with `payoutWeek`. **No money moves to stores in phase 3**; transfers are phase 5 (Stripe Connect).

### 5.5 Not decided by this design **[Blocked]**
- Who carries chargebacks, and the Connect account type (Stripe; phase 5).
- **[To confirm with Stripe]** How long a card authorization stays valid. Orders complete the same day, but a test should confirm the hold outlives a slow store.

## 6. Store experience (store portal)

- **Orders card:** new orders at the top with a sound and a page-title badge while the portal is open. Polling every 10 seconds (the portal already uses plain requests; no new infrastructure). An SMS alert per order is **[Decision D6]** (a Twilio cost per text).
- **What the store sees:** order number, the rider's first name, items, quantities, substitution choices and notes. **Not** the rider's address, phone or email (the driver has the address; the store doesn't need it).
- **Accept** with a preparation time, or **reject** with a reason (from a short list plus free text). Accepting creates the delivery trip with `merchant_name`, `item_count` and the pickup address from the store.
- **While preparing:** mark an item out of stock, or, where the rider chose "store's best match", record the substitute and its price (within the authorization). For "contact me", the rider is asked in the app; no answer in 7 minutes refunds the item (`substitutionOutcome`).
- **Mark ready.** Phase 4 times dispatch to this and adds the pickup code; in phase 3 the trip is offered to drivers when the store accepts, as deliveries are today.
- Every store action is audited, as in phases 1–2.

## 7. Staff experience (admin dashboard)

- **Orders list:** all orders with state, store, totals, and age in the current state; filters for stuck orders (for example `accepted` for longer than its preparation time + 20 minutes).
- **Order detail:** the event timeline, items, amounts (authorized, captured, refunded) and the linked trip.
- **Refund proposals:** approve or decline missing-item proposals (existing engine; a person decides).
- **Cancel an order** before pickup, with a reason: releases the authorization; audited. Staff can't change prices or capture amounts by hand.

## 8. Sales tax **[Blocked: accountant]**

The design keeps tax as a separate per-item amount, computed by one function, so the accountant's answer changes one place:

- `tax_cents` per order item and in the order totals; the rate source is configurable (a single Nashville combined rate, or per-item categories if the accountant says some items, such as groceries, are taxed differently).
- Whether Harvey Taxi collects and remits as a marketplace facilitator, and who bears refunded tax, is the open question in §4a item 7 and §4b of the plan.

**Until the accountant answers, ordering stays in test mode.** The test-mode rate is a placeholder clearly marked as such, never shown to real riders.

## 9. Data model (one migration, needs separate owner approval)

All server-only with RLS on and no client access, like phases 1–2.

**`orders`**
- `id`, `order_number` (short, human-readable), `merchant_id`, `rider_id`, `ride_id` (the linked trip, once accepted)
- `status` (§3), `order_type` (food / grocery)
- `prep_minutes`, `accepted_at`, `ready_at`, `picked_up_at`, `delivered_at`, `completed_at`, `cancelled_at`, `cancel_reason`
- Money, all whole cents: `items_subtotal_cents`, `tax_cents`, `delivery_fee_cents`, `tip_cents`, `authorized_cents`, `captured_cents`, `refunded_cents`, `commission_cents`, `merchant_share_cents`
- `payment_intent_id`, `client_order_key` (unique per rider; makes checkout safe to retry)
- `payout_week_start` (from `payoutWeek`)
- `rider_notes` (≤ 300 characters)
- `created_at`, `updated_at`

**`order_items`**
- `order_id`, `catalog_item_id`, `name` and `unit_price_cents` **copied at checkout** (later catalog edits don't change a placed order), `quantity`, `tax_cents`
- `substitution_choice` (contact / best_match / refund), `fulfilment` (pending / packed / substituted / out_of_stock / refunded), `substitute_name`, `substitute_price_cents`

**`order_events`**
- `order_id`, `from_status`, `to_status`, `actor_type` (rider / merchant_user / admin / system), `actor_id`, `reason`, `created_at`. Append-only.

Checks in the database: amounts never negative; `captured_cents ≤ authorized_cents`; `refunded_cents ≤ captured_cents`; status from the fixed list; a rejected or cancelled order has a reason.

## 10. Safety, privacy and abuse

- **Excluded items (term 3):** only `listed` items can be ordered, so held or hidden items can't be bought. The server re-checks every item at checkout; the browser's cart is never trusted for price or availability.
- **Store hours:** checked at checkout and at acceptance.
- **Store privacy for riders:** stores see first names only (§6).
- **Limits:** checkout rate-limited per rider and per address; one open unpaid checkout per rider.
- **Paused stores:** a store suspended mid-order can't accept new orders; open orders stay visible to staff to finish or cancel.
- **Records:** orders and their events are kept until the retention review (standing rule: no deleting historical records before it).

## 11. Decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| D1 | How long a store has to accept before the order expires and the hold is released | 8 minutes (long enough for a busy counter; the rider isn't left waiting) |
| D2 | Rider cancelling after the store accepts | Free until the store marks it ready; after that, only through support, decided by staff. Charging a cancellation fee would need counsel's terms update. |
| D3 | Tip | Optional, chosen at checkout (none / 10% / 15% / 20% / custom), no preset selection, 100% to the driver. **[Verified 2026-10-18, code]** Ride tips are already added in full to the driver's earning. |
| D4 | One charge for items + fee + tip, or separate charges | One authorization and one capture (§5.1) |
| D5 | Minimum order | None during the pilot; revisit with pilot data |
| D6 | Store alerts | Sound and tab badge in the portal (free); SMS per order optional per store (Twilio cost per text) |
| D7 | When the final amount is captured | At delivery confirmation (PIN or photo), not at pickup |

## 12. Build plan (each a separate PR; each merge, the migration and turning on the switch need the owner's approval)

| Step | Delivers |
|---|---|
| 3a | Migration (`orders`, `order_items`, `order_events`); server: checkout with test-mode authorization, the state machine, store inbox (accept, reject, ready), automatic expiry, staff orders list. Switch off. |
| 3b | Rider cart, substitution choices and checkout breakdown in the Delivery Center; order tracking. |
| 3c | Substitutions while preparing, capture at delivery, missing-item reports wired to the refund-proposal review, store-share ledger and payout weeks. |
| Demo | A full test-mode walkthrough (synthetic store, test card, test driver) shown to the owner before phase 4. |

Tests for each step: unit tests for amounts and transitions, server tests for every state change and race, database tests for the constraints, and browser tests for rider checkout and the store inbox at phone width.

## 13. Before real orders **[Blocked / Unresolved]**

1. Accountant: Tennessee marketplace-facilitator collection and refund treatment (§8).
2. Counsel: merchant agreement (12% commission, Monday payouts, 48-hour dispute and rollover) and rider Terms and Privacy updates for marketplace purchases.
3. Stripe: Connect account type, chargeback responsibility and payout timing (phase 5).
4. Drivers: at least 5 fully verified and able to go online (term 6; 0 of 19 on 2026-10-17).
5. Pilot stores signed, with catalogs (0 applications on 2026-10-17; the daily onboarding check reports the first).
6. Owner approval to turn on `ENABLE_MERCHANT_ORDERS` and the delivery switches.
