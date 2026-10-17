# Delivery with a merchant portal: plan for owner review

**Prepared:** 2026-10-17 (UTC).

**[Owner decision 2026-10-17]** Delivery must work end to end for merchants, riders and drivers, through a **merchant portal**: stores sign up, receive orders, mark them ready and get paid through Harvey Taxi. Delivery booking is **paused** until this is built and tested (PR `claude/delivery-pause`).

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

## 4. Decisions needed from you

1. **[Decision] Commission:** what percentage of item sales Harvey Taxi keeps, and whether there is a monthly merchant fee.
2. **[Decision] Prices:** whether stores may charge more on Harvey Taxi than in store. It is common; it must be disclosed.
3. **[Decision] What is excluded:** recommended alcohol, tobacco, cannabis or hemp products, prescriptions and weapons. Each would need licences and age checks.
4. **[Decision] Missing items:** who pays for a refund when the store left an item out (the store, Harvey Taxi, or split).
5. **[Decision] Grocery substitutions:** allowed, with the rider's approval in the app, or not at all.
6. **[Decision] Pilot stores:** which Nashville restaurants or stores you can sign first.
7. **[To confirm with an accountant]** Tennessee sales tax on marketplace sales. Tennessee has marketplace-facilitator rules that may require Harvey Taxi to collect and remit sales tax on the stores' sales. Confirm the threshold and how it applies before phase 3 handles real money.
8. **[To confirm with counsel]**
    - a merchant agreement covering food safety, liability for what the store prepares, payouts and data;
    - updates to the rider Terms and Privacy Policy for marketplace purchases.
9. **[To confirm with Stripe]**
    - Connect account type (Express is recommended);
    - who carries chargebacks;
    - payout timing.

## 5. What happens now

- PR `claude/delivery-pause` (this change) pauses delivery booking until the portal is ready. It covers:
  - the server refuses delivery quotes and orders;
  - the rider Delivery Center shows a "Delivery is paused" notice with a waitlist email;
  - deliveries already in progress are unaffected.
- After your decisions above, phase 1 is the next PR. Its migration needs your separate approval before it is applied.
