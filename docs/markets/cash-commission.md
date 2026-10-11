# Cash trips with a driver commission ledger (assessment)

Status: **assessment and sandbox preview only.**
- Cash, the commission ledger and all live payments are **disabled in every African market** (Zimbabwe, Nigeria, Ghana). Nothing is connected to dispatch, the driver app or a live provider.
- **US payments are unchanged.** Nashville has no cash option and no `cash_commission` settings.
- This is not legal, tax or financial advice. Prepared 2026-10-10, updated 2026-10-11.

> **Demonstration values.** The **15% commission**, the unpaid limits and the dispute allowances used in tests and in the admin preview are **demonstration values, not approved rates**. No market has a commission rate, unpaid limit or dispute allowance set. They stay unset until the owner approves them, separately for each market.

> **Unconfirmed statements.** Provider eligibility, fees, settlement terms and tax points below come from web search summaries and secondary sources. The provider sites were not reachable from the build environment. They stay **unconfirmed** until supported by **current official sources or written advice** from the provider, a tax adviser or counsel.

## Dependencies

Each PR is stacked on the one before it:

| Order | PR | What it contains |
|---|---|---|
| 1 | **#213** | Markets: Nashville unchanged; Harare, Lagos and Accra in simulated test mode |
| 2 | **#216** | Zimbabwe: in-app EcoCash payment design and sandbox; commission configurable and unset |
| 3 | **#217** | This: cash trips with a driver commission ledger, sandbox and admin preview |

They are reviewed and merged in that order (#213 → #216 → #217), only with the owner's approval. All are drafts.

## How it works (sandbox)

1. **The rider pays the driver directly**, in cash or to the driver's own EcoCash wallet.
2. **When the trip is completed**, the ledger records the fare collected, the driver's earnings and the **commission owed**, and issues a numbered receipt (for example `HT-ZW-000001`).
3. **Before the next shift**, the driver pays what is owed through the market's approved provider. For Zimbabwe the candidate is EcoCash via Paynow, which is **unconfirmed**.
4. **Only a verified provider confirmation clears the balance.** It must carry a checked signature, the right reference and amount, and is counted once.
5. **An accepted or active trip is never interrupted.** Checks happen only when a shift starts and before new cash offers.

## Safeguards

| Requirement | How it is handled |
|---|---|
| **Payments made directly to the driver** | Cash, EcoCash to the driver's own wallet (`direct_to_driver`), or an in-app payment not yet verified all record **commission owed**. |
| **In-app rides excluded only when collection is verified** | Excluded only with evidence: `verified: true`, a provider reference, and a collected state in the in-app ledger (#216). If an unverified in-app trip is verified later, its entry is reversed, or credited if already paid, so nothing is charged twice. Unknown payment labels are refused. |
| **Unpaid-balance limit** | At or over the limit, **no new cash offers**. Disputed amounts **count toward the limit**. An accepted or in-progress trip carries on, and in-app paid offers aren't affected. The limit is a per-market setting, **not set**. |
| **Settle before the next shift** | Checked only while the driver is offline. It always allows a driver with an accepted or active trip. |
| **Disputes can't be used to skip payment** | Each trip can be disputed **once**, and a resolved dispute can't be reopened. A disputed amount is set aside before the next shift **only within owner-set allowances**: maximum open disputes, maximum disputed amount, and maximum rejected disputes. **None are set, so today every disputed amount is still due**, unless an admin decides the dispute or grants an override. Exceeding any allowance makes everything due again. Each rejected dispute counts toward the driver's history. |
| **Admin override** | Lets one next shift start, or allows cash offers over the limit, for **at most 24 hours**. It needs a named admin (`admin:…`) and a written reason. Granting and using it are **audited**. A next-shift override is used up when the driver goes online. It **never reduces what is owed**. |
| **Receipts** | For each trip (with payment type, fare, earnings and commission) and for each settlement (amount, provider reference, trips covered). Numbered per country. These are **not fiscal receipts** (see Tax). |
| **Disputes: decision** | A named reviewer upholds (removes or reduces the commission) or rejects (owed again). |
| **Cancellations** | A trip cancelled before completion owes nothing. A voided completed trip is reversed, or credited if already paid. |
| **Audit** | Append-only and frozen: who, what, when, amounts and the balance afterwards. Covers overrides and in-app verifications. |
| **Duplicate payments** | One open settlement per driver, with an idempotency key. Repeated, unverified, unknown-reference and wrong-amount confirmations never clear a balance. A late payment becomes credit. |

### Code

- **Ledger:** `lib/payments/cashCommission.js`, per market and sandbox only. There is no live mode: it refuses to run unless sandbox is set, and it refuses any provider that isn't the sandbox.
- **Preview scenario:** `lib/payments/cashCommissionPreview.js`, a scripted driver day.
  - Cash trips, a direct-to-driver trip and a verified in-app trip.
  - A dispute that still counts toward the limit and is still due.
  - The shift block, payment with duplicate protection, and an ignored unverified message followed by a verified confirmation.
- **Tests:** `lib/payments/cashCommission.test.js`, 18 sandbox tests.
- **Admin preview:** **Markets → Cash with driver commission (sandbox) → Preview a driver's cash day** (`GET /api/admin/markets/:id/cash-commission-preview`). Admin-only; nothing is stored; the demonstration rate is labelled.
- **Settings** (`lib/markets.js` → `cash_commission`):
  - `enabled` and `approved` are false;
  - `settlement_provider` is unconfirmed;
  - `unpaid_limit_minor` is null;
  - `dispute_policy` has every allowance null;
  - `settle_before_next_shift` is true;
  - `pricing.commission.rate` is null.

## Provider and local requirements: all unconfirmed

Every row needs **current official sources or written advice** before it can be relied on.

### Zimbabwe

| Topic | What was reported (search summaries / secondary sources) | What confirms it |
|---|---|---|
| Driver pays Harvey Taxi by EcoCash (Paynow) | Paynow documents EcoCash express checkout with a test mode ([Paynow developer hub](https://developers.paynow.co.zw/docs/initiate_mobile_transaction.html)). Whether commission from independent drivers is an accepted use for a merchant account is **not documented**. | Written confirmation from Paynow |
| Paynow terms | The terms PDF is reported to exclude processors "collecting payments on behalf of merchants" ([terms PDF](https://www.paynow.co.zw/Content/downloads/Terms_and_Conditions_for_Paynow_Service_v1.pdf), not opened directly). Harvey would collect only its own commission, but whether the exclusion applies is **unconfirmed**. | Paynow, in writing |
| Fees | EcoCash via Paynow is reported at 2.5% ([fees page](https://www.paynow.co.zw/Home/Fees), not opened directly). EcoCash's own charges may come on top. | Paynow's current fee schedule or contract |
| Settlement | Reported: next-day settlement for wallet payments to a Zimbabwean bank account, and weekly payment for unverified merchants ([merchant FAQ](https://www.paynow.co.zw/home/merchanttutorial), not opened directly). | Paynow, in writing |
| Transfer tax (IMTT) | Reported from 1 Jan 2026: 2% on USD and 1.5% on ZiG electronic transfers, including mobile money ([AllAfrica](https://allafrica.com/stories/202511280037.html), news report). Who bears it is unknown. | Zimbabwe tax adviser / ZIMRA guidance |
| VAT and fiscal receipts | VAT is reported at 15.5% for 2026. ZIMRA says VAT-registered operators must fiscalise through FDMS ([ZIMRA](https://www.zimra.co.zw/news/2307-compliance-with-the-zimra-fiscalisation-data-management-system-fdms)). Whether and how it applies to Harvey's commission is **unconfirmed**. | Zimbabwe tax adviser |
| Holding funds / prepaid value | RBZ guidelines require authorisation to issue retail payment instruments ([RBZ](https://www.rbz.co.zw/documents/nps/payment-systems-guidelines-august-2017.pdf)). How that applies to prepaid credits is **unconfirmed**. | Zimbabwe counsel |
| Permission to operate | A five-month e-hailing moratorium is reported (Sept 2026). It is not permission to operate. | Zimbabwe counsel / Ministry of Transport |

### Nigeria and Ghana: provider not chosen

| Market | Candidate | Reported fees (Paystack support pages, via search) | Status |
|---|---|---|---|
| Nigeria | Paystack | 1.5% + ₦100; ₦100 waived under ₦2,500; capped at ₦2,000 ([Paystack](https://support.paystack.com/hc/en-us/articles/360009881920-What-are-Paystack-s-transaction-charges)) | Unconfirmed: eligibility, current fees, KYC and tax need written confirmation |
| Ghana | Paystack (mobile money) | 1.95% including mobile money ([Paystack](https://support.paystack.com/hc/en-us/articles/360012174020)) | Unconfirmed, as above |

## Commission ledger vs prepaid commission credits

| | **Commission ledger** (this design) | **Prepaid credits** |
|---|---|---|
| Harvey's credit risk | Up to the unpaid limit per driver | None (prepaid) |
| Driver cash flow | Pays from fares already collected | Pays before earning |
| Dispute abuse | Contained by the safeguards above | Less relevant |
| Regulation | A receivable, settled by a merchant payment | Holding drivers' money may be stored value (**unconfirmed**; counsel) |
| Build | Sandbox done | Not built |

**Recommendation:** use the commission ledger, with a modest unpaid limit, settlement before every shift, and the dispute safeguards. This depends on the confirmations above.

## Remaining implementation steps (each needs owner approval; nothing done yet)

1. **Confirmations:** written answers from Paynow (or EcoCash) on driver commission payments, fees, settlement and refunds; tax advice (VAT, fiscal receipts, IMTT); counsel (operating permission, holding funds).
2. **Database:** tables for commission entries, disputes, settlements, overrides and the audit log (append-only, server-only), with a `market_id` on each.
3. **Provider adapter** for the approved provider, with signature/hash verification of callbacks and polling. Sandbox first, then live only after approval.
4. **In-app evidence:** store verified collection evidence from the in-app ledger (#216) so the cash ledger can check it. The in-app EcoCash marketplace model is itself still unconfirmed.
5. **Server:**
   - a shift-start check in the "go online" path (never during accepted or active trips);
   - a cash-offer filter in dispatch;
   - admin endpoints for disputes and overrides.
6. **Driver app:** commission balance, a "Pay commission" screen, receipts, and a dispute form. This needs a driver build.
7. **Admin:** dispute review queue, override form (reason required), and reconciliation against provider reports.
8. **Fiscal receipts**, if tax advice requires them.
9. **Driver terms:** commission, settlement before shift, unpaid limit, disputes, overrides, credits and refunds.
10. **Per-market enablement** of cash and the ledger: Zimbabwe first, then Nigeria and Ghana with their own approved providers.

## Decisions for the owner (per market)

- [ ] Approve cash for this market (yes/no)
- [ ] Commission rate (the 15% shown is a demonstration only)
- [ ] Unpaid-balance limit
- [ ] Dispute allowances: maximum open disputes, maximum disputed amount, maximum rejected disputes. Or none, so every disputed amount must be resolved or paid before the next shift.
- [ ] Who may grant overrides, and the maximum duration (code maximum: 24 hours)
- [ ] Settlement provider, once its written confirmation arrives
- [ ] Who carries provider fees and IMTT
- [ ] Handling of credit and overpayments (refund vs carry forward)
- [ ] Commission ledger vs prepaid credits (ledger recommended)
