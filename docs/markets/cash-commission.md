# Cash trips with a driver commission ledger (assessment)

Status: **assessment and sandbox preview only.** Cash is disabled in every
market, and nothing is wired to dispatch, the driver app or a live provider.
Zimbabwe comes first. Nigeria and Ghana use the same model through their own
approved provider, once approved separately. **US payments are unchanged:**
Nashville has no cash option and no `cash_commission` settings. Prepared
2026-10-10. This is not legal, tax or financial advice.

## How it works

1. The rider pays the driver **cash** at the end of the trip.
2. When the trip is **completed**, Harvey Taxi records three amounts: the fare
   the driver collected, the driver's earnings and the **commission owed** to
   Harvey Taxi. The driver gets a numbered receipt (for example `HT-ZW-000001`).
3. **Before the next shift**, the driver must pay what they owe through the
   market's approved provider. In Zimbabwe that is EcoCash, via Paynow express
   checkout: the driver gets a PIN prompt and pays Harvey Taxi.
4. **Only a verified provider confirmation clears the balance.** That means a
   signature-checked callback or status poll, with the right reference and
   amount, counted once. Then the driver can go online.
5. **An accepted or active trip is never interrupted.** Checks happen only at
   the start of a shift and before new cash offers.

### Safeguards (all in the sandbox code and tests)

| Requirement | How it is handled |
|---|---|
| Unpaid-balance limit | At or over the limit, the driver gets **no new cash offers**. A trip already accepted or in progress carries on, and in-app paid offers are unaffected. The limit is a per-market setting, currently **not set**. |
| Settle before the next shift | `canStartShift` blocks only while the driver is offline. It always allows a driver with an accepted or active trip. |
| Receipts | A receipt for each cash trip (fare, earnings, commission) and for each settlement (amount, provider reference, trips covered), numbered per country. |
| Disputes | The driver disputes a trip's commission, for example "rider didn't pay". By default the disputed amount is set aside and doesn't block the shift. A named reviewer then **upholds** it (removed or reduced) or **rejects** it (owed again). |
| Cancellations | A trip cancelled before completion owes nothing. A completed trip voided later has its commission reversed. If it was already paid, the amount becomes credit. |
| Audit | Append-only log: who, what, when, amounts and the balance afterwards. |
| Duplicate payments | One open settlement per driver; the same idempotency key returns it. Repeated or unverified confirmations are ignored, and a wrong amount is held. A late payment for a closed settlement becomes **credit**, never a second clearing. |
| No double commission | **EcoCash-paid (in-app) rides are not charged here.** Their commission is kept when the rider pays (`lib/payments/marketplaceLedger.js`). |

### Code

- `lib/payments/cashCommission.js`: the ledger (per market, sandbox only).
- `lib/payments/cashCommissionPreview.js`: a scripted driver day for the admin preview.
- `lib/payments/cashCommission.test.js`: 14 sandbox tests.
- Admin preview: **Markets → Cash with driver commission (sandbox) → Preview
  a driver's cash day**, served by `GET /api/admin/markets/:id/cash-commission-preview`.
  It is admin-only and stores nothing.
- Settings per market in `lib/markets.js`, under `cash_commission`:
  - `enabled`, `approved`: both false;
  - `settlement_provider`: Zimbabwe Paynow/EcoCash, unconfirmed; Nigeria and Ghana not chosen;
  - `settlement_currency`;
  - `unpaid_limit_minor`: not set;
  - `settle_before_next_shift`: true;
  - `disputed_blocks_shift`: false.
- The commission rate is not set in any pilot market. Nigeria and Ghana's
  illustrative 70% driver share is removed too, so no market has a rate until
  you approve one.

## Provider and local requirements

### Zimbabwe

| Requirement | Finding | Status |
|---|---|---|
| Driver pays Harvey Taxi by EcoCash | This is an **ordinary merchant payment**: Harvey Taxi is paid for its own service. That differs from the in-app model, which collects for drivers. Paynow documents EcoCash express checkout with a test mode ([Paynow](https://developers.paynow.co.zw/docs/initiate_mobile_transaction.html)). | Supported in principle. Still confirm in writing that commission from independent drivers is an acceptable use. |
| Paynow terms | The terms exclude processors "collecting payments on behalf of merchants" ([terms PDF](https://www.paynow.co.zw/Content/downloads/Terms_and_Conditions_for_Paynow_Service_v1.pdf)). In the cash model Harvey Taxi collects only **its own** commission. | Likely outside the exclusion. Confirm with Paynow. |
| Fees | Paynow's EcoCash fee is reported at 2.5% ([fees](https://www.paynow.co.zw/Home/Fees)). | Unconfirmed. Decide who carries it. |
| Settlement | Wallet payments settle the next day to a Zimbabwean bank account; unverified merchants are paid weekly ([FAQ](https://www.paynow.co.zw/home/merchanttutorial)). | Needs a **local bank account** and Paynow merchant verification. |
| Transfer tax (IMTT) | From 1 Jan 2026: 2% on foreign-currency (USD) electronic transfers and 1.5% on ZiG. It applies to mobile money ([AllAfrica](https://allafrica.com/stories/202511280037.html)). | It adds to the driver's cost of paying commission. Counsel to confirm who bears it. |
| VAT and fiscal receipts | VAT is reported at 15.5% from 2026. VAT-registered operators must **fiscalise** sales through ZIMRA's FDMS, using a device or the virtual/API option ([ZIMRA](https://www.zimra.co.zw/news/2307-compliance-with-the-zimra-fiscalisation-data-management-system-fdms), [explainer](https://www.zimra.co.zw/domestic-taxes/corporate/fiscalisation-explained)). | The sandbox receipts are **not** fiscal receipts. If registered, Harvey's commission receipts must be fiscalised. Needs a tax adviser. |
| E-hailing rules | A five-month regulatory moratorium (Sept 2026) while regulations are drafted; tax compliance is in scope ([Equity Axis](https://equityaxis.net/post/19447/2026/9/)). | Not permission to operate (see zimbabwe.md). |
| Market practice | Bolt launched in Harare taking cash; inDrive drivers reported problems paying through EcoCash cards. Reports describe drivers bypassing apps to avoid commission ([Techzim](https://www.techzim.co.zw/2024/02/bolt-agressively-enters-zim-ride-hailing-market-zero-commissions-to-drivers-low-fares-to-riders/), [TZ Perspective](https://www.tzperspective.com/for-almost-three-days-ecocashs-mastercard-issues-left-indrive-drivers-stranded/)). I found no public description of how competitors' drivers settle commission. | Commission leakage is a real risk. The limit and shift gate help. |

### Nigeria and Ghana (same model; provider not chosen)

| Market | Candidate provider | Published fees | Status |
|---|---|---|---|
| Nigeria | Paystack (cards, transfer, direct debit) | 1.5% + ₦100 per local transaction; ₦100 waived under ₦2,500; capped at ₦2,000 ([Paystack](https://support.paystack.com/hc/en-us/articles/360009881920-What-are-Paystack-s-transaction-charges)) | Not chosen or approved. Needs a merchant account, KYC, and tax advice (VAT on commission). |
| Ghana | Paystack (MTN MoMo, Telecel Cash, AT Money, cards) | 1.95% per local transaction including mobile money ([Paystack](https://support.paystack.com/hc/en-us/articles/360012174020)) | Not chosen or approved. A direct MTN MoMo integration may cost less (third-party estimate around 1%). |

Each market gets its own provider adapter only after you approve that market
and its provider.

## Option comparison: commission ledger vs prepaid commission credits

| | **Commission ledger** (this design) | **Prepaid credits** |
|---|---|---|
| How it works | The driver owes commission after cash trips and settles before the next shift | The driver tops up credit in advance; each cash trip deducts commission; no new offers at zero |
| Harvey's credit risk | Up to the unpaid limit per driver | None, because commission is paid upfront |
| Driver's cash flow | Better: pays from fares already collected | Worse: pays before earning; harder for new drivers |
| Leakage | Higher if drivers stop using the app while owing | Lower |
| Regulation | Simple receivable, with a merchant payment when the driver settles | **Holding drivers' prepaid money may be stored value or e-money.** RBZ guidelines require authorisation to issue retail payment instruments, and mobile money licensing sits with the RBZ (SI 80 of 2020, amended by SI 17 of 2025) ([RBZ guidelines](https://www.rbz.co.zw/documents/nps/payment-systems-guidelines-august-2017.pdf), [MMM Law](https://www.mmmlawfirm.co.zw/understanding-zimbabwes-new-licensing-regulations-for-money-transmission-mobile-banking-and-money-interoperability/)). Needs counsel. |
| Refunds | Credits or reversals inside the ledger | Unused credit must be refundable when a driver leaves |
| Tax | Receipt and VAT when commission is earned | Is VAT due at top-up or at use? Needs a tax adviser |
| Build effort | Done in the sandbox | Moderate: top-ups, balance, zero-balance gate and refunds |

**Recommendation:** use the **commission ledger** with a modest unpaid limit
and settlement before every shift. It avoids holding drivers' money, so it
avoids the possible stored-value licence question that prepaid credits raise,
and it is easier on new drivers' cash flow. Revisit prepaid credits only if
leakage proves high and counsel confirms that no licence is needed.

## Before anything is enabled (owner approval per market)

1. Approve cash for that market (`cash_bookings`, `cash_commission.enabled` and `approved`).
2. Set the commission rate and the unpaid-balance limit.
3. Choose the settlement provider and confirm with it in writing (Zimbabwe: Paynow EcoCash merchant account for commission from drivers).
4. Tax: VAT registration and fiscal receipts (Zimbabwe ZIMRA FDMS); IMTT treatment.
5. Driver terms: commission, settlement before the shift, the unpaid limit, disputes, and credit or refund of overpayments.
6. Build: database tables, the provider adapter with signature verification, the driver app's "pay commission" screen and shift gate, and admin dispute review. Each step needs your approval.
