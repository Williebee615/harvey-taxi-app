# Delivery with a merchant portal: plan for owner review

**Prepared:** 2026-10-17 (UTC).

**[Owner decision 2026-10-17]** Delivery must work end to end for merchants, riders and drivers, through a **merchant portal**: stores sign up, receive orders, mark them ready and get paid through Harvey Taxi. Delivery booking is **paused** until this is built and tested (#260, live since 2026-10-17).

Labels: **[Verified]** = checked in the code or the production database on the date shown. **[Decision]** = needed from the owner. **[To confirm]** = needs an accountant, counsel or the provider.

---

## 1. What exists today **[Verified 2026-10-17, code]**

| Part | State |
|---|---|
| Rider Delivery Center | Request food or grocery delivery; follow the active delivery; history; support. The rider types the store name, item count and instructions. |
| Pricing | The rider pays a **delivery fee only**, for example $11.50 for 5 mi / 12 min (live quote, 17 Oct). There is no item price, tax or tip on the items. |
| Driver flow | Stages: order accepted → heading to store → waiting for order → heading to customer → arrived → delivered. Handoff by the rider's PIN or a photo. Only drivers set up for food or grocery are offered deliveries. |
| Merchants | **None.** No accounts, portal, menus, order inbox or payouts. "Merchant" is a free-text store name. |
| Who pays the store | **Undefined.** In practice the rider must order and pay the store separately. |
| On/off switches | `ENABLE_DELIVERY` / `ENABLE_FOOD_DELIVERY` / `ENABLE_GROCERY_DELIVERY` were **reported but never enforced**, so delivery could be booked in production while the home page said it couldn't. Fixed in `claude/delivery-pause`: enforced, and off by default. |

## 2. Target flow

1. **Rider** browses approved stores in the Delivery Center, builds a cart and sees a breakdown before paying: items + sales tax + delivery fee + tip.
2. **Payment:** one Stripe charge to the rider; the store's share is held for its payout.
3. **Merchant** gets the order in the portal, with an alert. They accept it with a preparation time, or reject it with a reason, which triggers a full refund.
4. **Dispatch** offers the delivery to an eligible driver timed to the "ready" estimate. The merchant marks the order ready.
5. **Driver** confirms pickup with the order code shown in the portal, so the right driver gets the right bag, then delivers using the existing PIN or photo handoff.
6. **Payouts:** the merchant is paid through Stripe Connect (items, less commission) and the driver through the existing payout.
7. **Problems:** missing or wrong items, refunds (full or per item) and merchant cancellations are handled by support, with records of who decided what.

## 3. Build phases (each a separate PR, each needing your approval to merge)

| Phase | Delivers | Needs |
|---|---|---|
| 1. Merchant accounts | Merchant sign-up, admin approval, store profile (address, hours, contact) and merchant user logins | One migration: `merchants`, `merchant_users`, `merchant_hours` |
| 2. Catalog | Merchants manage items, prices, availability and substitution; CSV import (photos deferred, see §4d) | Migration: `catalog_items` |
| 3. Orders | Rider cart and checkout; the merchant inbox (accept, reject, prep time, ready); the order linked to its delivery trip | Migration: `orders`, `order_items`; the Stripe charge for the full order |
| 4. Driver integration | Dispatch timed to "ready"; a pickup code; item list on the driver screen; reporting an item that's unavailable | Driver app labels need a new build |
| 5. Merchant payouts | Stripe Connect onboarding, payout schedule, commission and reconciliation | A Stripe Connect platform profile; the money-movement agreement |
| 6. Support and pilot | Missing-item refunds, merchant cancellation rules, a pilot with 1–3 Nashville stores, App Review notes | Pilot merchants signed |

**[Recommendation]** Build phases 1–4 in **test mode** (Stripe test keys, synthetic stores) and show you the full flow before phase 5 touches real money.

## 4. Merchant terms

**[Owner decision 2026-10-17]** "Approve the recommended versions" (items 1–6).

1. **Commission:** 12% of the item subtotal (before tax; excluding tip and delivery fee), charged only on completed orders, so a cancelled or fully refunded order pays nothing. Card processing fees come out of Harvey Taxi's 12% (real margin about 9%, an estimate).
2. **Prices:** merchants set their own prices. If a store's Harvey Taxi prices differ from in store, its page shows "Prices may be higher than in store". The application records this.
3. **Excluded items:** alcohol, tobacco and vape; cannabis, hemp and CBD; prescription medicines; weapons and ammunition; gift cards, prepaid cards and lottery tickets; live animals; hazardous materials; oversized, highly fragile or refrigerated/specialized-transport items. Applicants must confirm they won't list them.
4. **Missing items:** automatic customer credit, deducted from the merchant's payout, with a 48-hour dispute window backed by photos. The customer is refunded straight away and never waits for the dispute. If the merchant wins a dispute, Harvey Taxi absorbs that refund. Claims above a set number per customer per month go to manual review (number to be set before phase 6). The deduction must be written into the merchant agreement (counsel).
5. **Substitutions:** the customer chooses per item at checkout: "contact me", "store's best match" or "refund if out of stock". Merchants only mark which items can be substituted. With no answer within 7 minutes, the item is refunded. Grocery orders are authorized with a 15% buffer; only the final amount is captured.
6. **Pilot:** 5 midtown/downtown Nashville stores (3 restaurants, 2 grocery or convenience). Each signs the merchant agreement before going live. Precondition: at least 5 drivers fully verified and able to go online (0 of 19 on 2026-10-17).

**[Owner decision 2026-10-17]** (confirms the two earlier assumptions)

7. **Payouts:** weekly, every Monday, for the prior week's completed orders (Monday to Sunday). Set as the Stripe Connect payout schedule when phase 5 is built.
8. **Fees:** commission only (12% of the item subtotal, per term 1). No monthly, subscription or fixed fee. To be written into the merchant agreement and fee schedule.

**[Recommendation]** An order completed late on Sunday is still inside its 48-hour dispute window when Monday's payout runs. A missing-item amount confirmed after a payout is deducted from the next payout. The merchant agreement should say so.

**[Owner decision 2026-10-17]** The merchant agreement (counsel to draft) includes:
- the 12% commission-only structure;
- weekly Monday payout initiation;
- a clause that adjustments for orders completed late on Sunday, whose 48-hour dispute window runs past Monday's payout, are applied to the following week's payout;
- a statement that Monday is the payout transfer date and bank arrival depends on Stripe and the merchant's bank. The application page says the same.

**[To confirm with Stripe]** "Monday" is when the payout is sent. The day funds reach the merchant's bank depends on Stripe's payout timing for the account and its bank.

**Phase 1a** (PR `claude/merchant-portal-phase1`): public application page, admin review, `merchants` table. Its migration needs separate approval.

## 4b. Refund engine (built ahead of phase 3)

**[Owner decision 2026-10-17]** "Build the refund rules engine."

**[Owner decision 2026-10-17] Term 4 conflict resolved:**
- **Approval:** agent rule 8 (a person approves) takes precedence over "refunded straight away". The engine prepares each missing-item refund as a proposal, and an authorized admin or staff member reviews and approves it before any money moves through Stripe.
- **Claim window:** customers report a missing item within 48 hours of order completion.

`lib/refundEngine.js` holds the money rules as pure functions. They work in whole cents, use Nashville time, and have no Stripe, database or network calls. Phase 3 (orders) will call them.

| Function | Rule |
|---|---|
| `commission` | 12% of the item subtotal, completed orders only (term 1) |
| `itemAuthorizationCents` | Grocery holds the subtotal plus 15% (term 5) |
| `substitutionOutcome` | No answer within 7 minutes → refund the item (term 5) |
| `planMissingItemRefund` | **Refused:** a claim more than 48 hours after completion, an item not in the order, or more than is left unrefunded.<br>**Refund amount:** the items plus their sales tax; tip and delivery fee excluded, and capped at the item's purchase value.<br>**Photo check:** claims are checked against the store's pickup checklist photos. If the photos contradict the claim, or there is no photo, a person reviews it. Over the monthly limit, or with no limit set, a person also reviews it. |
| `buildRefundProposal` | Packages a plan as a frozen proposal: `status: "pending_review"`, `requires_human_approval: true`, with amounts, photo IDs and reasons. It carries a key that is the same every time for the same claim, so a claim can't be paid twice. It never moves money. |
| `merchantDeductionStatus` | Nothing is deducted during the merchant's 48-hour dispute window. A merchant win → Harvey Taxi absorbs; a loss, or no dispute → deduct (term 4) |
| `payoutWeek` | Monday-to-Sunday weeks in Nashville time, paid the following Monday. A late-Sunday adjustment confirmed after Monday rolls over to the next payout (term 7 and its agreement clause) |

**[Recommendation, built in; owner to confirm]** On a missing item, the merchant returns what it was paid for it (price less 12%), and Harvey Taxi gives up its 12% commission on that item. This matches term 1, so the merchant never loses more than it received.

**[Assumption, built in]** "Match the item-checklist photo records" is read as follows: the store's pickup checklist has a photo per item with a packed quantity. A claim the photos contradict, or one without a photo, goes to a person; it is never refused automatically.

**[Owner decision 2026-10-17]** The monthly claim limit is **3 missing-item claims per customer per calendar month**. The 4th and later go to manual admin review. It is `MONTHLY_CLAIM_LIMIT` in `lib/refundEngine.js`.

**[Unresolved: before phase 3 goes live]**
- **Who bears the refunded sales tax:** waits on the accountant's written guidance on Tennessee marketplace-facilitator treatment (item 7 below).
- **The merchant agreement:** waits on counsel's draft (12% commission only, Monday transfers, 48-hour dispute and rollover clause).

## 4a. Still to confirm

7. **[To confirm with an accountant]** Tennessee sales tax on marketplace sales. Tennessee has marketplace-facilitator rules that may require Harvey Taxi to collect and remit sales tax on the stores' sales. Confirm the threshold and how it applies before phase 3 handles real money.
8. **[To confirm with counsel]**
    - a merchant agreement covering food safety, liability for what the store prepares, payouts and data;
    - updates to the rider Terms and Privacy Policy for marketplace purchases.
9. **[To confirm with Stripe]**
    - Connect account type (Express is recommended);
    - who carries chargebacks;
    - payout timing.

## 4c. Phase 1b: store sign-in and hours

**[Owner decision 2026-10-17]** "Proceed with initializing Phase 1b (Merchant Sign-In & Store Hours)."

- **Sign-in access (admin dashboard):** for an approved store, staff click "Give sign-in access" and enter a phone and name. They can remove it again, which ends that person's sessions at once. Both actions are audited.
- **Store portal (`/merchant-portal.html`):** the store enters its phone and receives a one-time code by text (Twilio Verify, the same service riders use). The session is a signed, HttpOnly cookie that lasts 12 hours. Sign-out ends every session for that person.
  - **No enumeration:** a phone that isn't set up gets the same reply, and no text is sent.
  - **Paused stores:** a suspended or rejected store can't sign in or change anything.
- **Hours:** one opening window per weekday, in Nashville time, closing the same day. Saving is audited. **[Limitation]** Hours past midnight (for example 11:00–01:00) and split shifts aren't supported yet.
- **Database (migration `20261017020000_merchant_users_hours.sql`, needs separate approval):**
  - `merchant_users`: one active sign-in per phone; `session_version` for sign-out.
  - `merchant_hours`: one row per store and weekday.
  - `bump_merchant_user_session_version()`.
  - All server-only, with RLS on.
- **Owner setup before stores can sign in [Unresolved]:**
  1. Approve and apply the migration.
  2. Add `MERCHANT_SESSION_SECRET` (a long random value) to the Render web service's environment. Until it is set, the portal says sign-in isn't available.
  3. Each code text is a Twilio Verify charge, as for rider sign-in.

## 4d. Phase 2: store catalog

**[Owner decision 2026-10-17]** "Start phase 2 catalog". Scope: items, prices, availability, substitution flags and CSV import, with excluded-item screening that holds items for staff review and never rejects them automatically. Photos are deferred. One PR; the migration needs separate approval.

- **Store portal (`/merchant-portal.html`, new "Catalog" card):**
  - add an item: name, price, section, and whether it can be substituted (merchant term 5);
  - edit the price, "in stock" and "can be substituted" in the table; remove an item (it is archived, not deleted);
  - CSV import with a preview first. Columns: `name` and `price` (required), `section`, `description`, `available`, `substitutable` (yes/no). Rows are matched to existing items by name, ignoring case; a match updates that item and keeps its name. Bad rows are skipped and listed by line number.
  - Every change is audited.
- **Screening (merchant term 3):** an item whose name, section or description mentions an excluded category is **held** and isn't visible to customers until staff decide. Categories: alcohol; tobacco or vape; cannabis, hemp or CBD; prescription medicine; weapons or ammunition; gift cards, prepaid cards or lottery; hazardous materials; live animals. Matching uses whole words ("ginger ale" isn't held). False alarms such as "rum cake" are expected; resolving them is what the review is for.
  - Editing an item's text screens it again and clears the earlier staff decision.
- **Admin dashboard ("Catalog Items Held for Review"):** staff allow an item, or keep it hidden with a reason of at least 10 characters that the store sees. Both decisions are audited. The store can't edit a hidden item back, or re-import it; it can only remove it.
- **Staff view of a store's full catalog (admin dashboard, "View catalog" on approved and suspended stores):** read-only. It shows every live item in every state (listed, held, hidden by staff) with price, section, in stock and substitutable, who allowed or hid an item and why, and counts. Removed items aren't shown. Viewing changes nothing and isn't audited, like the other admin lists. Held items are still decided in "Catalog Items Held for Review".
- **Onboarding kit (store portal):** a blank template (`/merchant-catalog-template.csv`, header row only, so uploading it unchanged adds nothing) and a separate example file (`/merchant-catalog-example.csv`, four clean sample items). A "How to fill in the file" guide explains each column, saving as CSV (UTF-8), limits, update-by-name, the review of possibly-excluded items, and Preview before Import. Stores that prefer email can send the sheet to support@harveytaxiservice.com. Both files redirect away on the HTAF domain and are disallowed in `robots.txt`.
- **Staff-assisted import (admin dashboard, approved stores only):** "Import a CSV for this store" takes a file a store sent in, with the same preview, screening, limits and per-store hourly limit (shared with the store's own imports). Possibly-excluded items are still held; a staff import never lists one without the review, and never changes an item staff kept hidden. Audited as `catalog_imported_by_staff`. Items appear in the store's own portal.
- **Limits:** up to 1,000 items per store; a price from $0.01 to $1,000.00; up to 500 rows and 200 KB per import; 30 imports per hour per store. One live item per name per store, enforced by the database.
- **Not in phase 2:**
  - photos (deferred by the owner);
  - customers seeing the catalog, and ordering (phase 3);
  - item-level tax categories (waiting on the accountant's sales-tax guidance).
- **Database (migration `20261017030000_catalog_items.sql`, needs separate approval):** `catalog_items`, server-only with RLS on. Until it is applied, the portal hides the Catalog card and the admin section says the catalog isn't set up.

## 5. What happens now

**[Verified 2026-10-17, production]** Phases 1a and 1b are live (applications, admin review, store sign-in, store hours). Delivery booking stays paused (#260).

- Phase 2 (catalog) is PR `claude/merchant-catalog-phase2`. Merging it and applying its migration each need the owner's approval.
- Phase 3 (orders) needs the accountant's sales-tax guidance and counsel's merchant agreement before real orders. Its design is in `docs/merchant-portal-phase3-orders.md` (2026-10-18, for owner review; test mode only until then).
