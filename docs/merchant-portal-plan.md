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
| 2. Catalog | Merchants manage items, prices, availability and photos; menu import from a spreadsheet | Migration: `catalog_items` |
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

## 4a. Still to confirm

7. **[To confirm with an accountant]** Tennessee sales tax on marketplace sales. Tennessee has marketplace-facilitator rules that may require Harvey Taxi to collect and remit sales tax on the stores' sales. Confirm the threshold and how it applies before phase 3 handles real money.
8. **[To confirm with counsel]**
    - a merchant agreement covering food safety, liability for what the store prepares, payouts and data;
    - updates to the rider Terms and Privacy Policy for marketplace purchases.
9. **[To confirm with Stripe]**
    - Connect account type (Express is recommended);
    - who carries chargebacks;
    - payout timing.

## 5. What happens now

- Delivery booking is paused (#260, verified live 2026-10-17).
- Phase 1a (applications and admin review) is PR `claude/merchant-portal-phase1`. Its `merchants` migration needs the owner's separate approval before it is applied.
- Phase 1b (merchant sign-in, store hours) follows after phase 1a is merged.
