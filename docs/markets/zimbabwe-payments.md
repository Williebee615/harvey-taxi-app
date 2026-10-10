# Zimbabwe payments: EcoCash only, marketplace model

Status: **design and sandbox tests only.** There is no live collection, payout or
deployment, and no provider adapter. Prepared 2026-10-10. This is not legal or
financial advice, and the provider and regulatory points below need written
confirmation.

## Owner decisions (10 Oct 2026)

- Zimbabwe is **EcoCash only**, with **no cash bookings** (`cash_bookings: false`
  in `lib/markets.js`).
- Harvey Taxi **collects** the rider's payment, **records its commission**, and
  **pays the driver's share** through an arrangement the provider has approved.
- The commission is **configurable** and **not set** (`commission.rate: null`).
  No split is computed until the owner approves a rate.

## Is this marketplace model supported? Not confirmed

I found **no public documentation** from Paynow or EcoCash that covers the
whole model: collecting fares for drivers, keeping a commission, and paying
drivers out. One published Paynow term may exclude it. **Ordinary merchant
approval should not be assumed to cover it.**

| Question | Paynow | EcoCash direct (Econet) |
|---|---|---|
| Collect from the rider's EcoCash wallet | **Yes, documented.** "Express checkout" sends a USSD/PIN prompt to the rider's handset. The integration must have EcoCash enabled. Test mode has published test numbers. ([initiate mobile transaction](https://developers.paynow.co.zw/docs/initiate_mobile_transaction.html), [test mode](https://developers.paynow.co.zw/docs/test_mode.html)) | **Yes, documented by third parties.** The "Instant Payment" API has a charge (MER) and a sandbox at developers.ecocash.co.zw. A merchant account must be approved before API keys are issued. Sources are unofficial guides; the official portal was not reachable from here. ([guide](https://github.com/67even/ecocash-instant-payment-api)) |
| Collecting on behalf of others (marketplace) | **Possibly excluded.** Paynow's terms PDF lists, among transactions it won't support, ones "by payment processors to collect payments on behalf of merchants". It is unclear whether a ride platform paying its drivers falls under this. ([terms PDF](https://www.paynow.co.zw/Content/downloads/Terms_and_Conditions_for_Paynow_Service_v1.pdf), as reported by search; the PDF itself could not be opened from here) | **Not documented.** No public material on a marketplace or sub-merchant model. |
| Split payment at checkout | **Not documented.** Settlement is to the merchant's own Zimbabwean bank account, less fees. ([merchant FAQ](https://www.paynow.co.zw/home/merchanttutorial)) | **Not documented.** |
| Payouts to drivers' wallets | **A product exists, terms unknown.** Paynow's Postman listing describes "Paynow Disbursement", which "enables merchants to disburse funds to their customers via CBZ, InnBucks, Omari, Ecocash, OneMoney and Telecash". No public endpoints, fees, limits or eligibility. Whether drivers count as "customers" for it is unconfirmed. ([Postman](https://www.postman.com/paynow)) | **Bulk payments by contract.** "Payroll and Bulk Payments" works through an application, vetting and a signed contract; the product is called EcoPay (launched 2024). A 2024 proposal mentions a flat rate per payment and a 1.7% cash-out charge for recipients. A 2020 report said an RBZ directive might restrict salary processing to banks. Current position unknown. ([EcoCash](https://ecocash.co.zw/payroll-and-bulk-payments/), [Pindula](https://www.pindula.co.zw/2024/10/23/ecocash-launches-ecopay-for-instant-bulk-transactions/), [Techzim 2020](https://www.techzim.co.zw/2020/08/ecocash-payroll-and-onepay-under-threat-as-rbz-directive-suggests-banning-of-salary-processing/)) |
| Fees | Paynow's fee page lists **EcoCash at 2.5%** (as reported by search; the page could not be opened from here). The merchant chooses to absorb, pass on or split it. A separate EcoCash merchant fee may apply on top. ([fees](https://www.paynow.co.zw/Home/Fees)) | Not published for merchants. Recipients pay their own cash-out fees and the government transfer levy (IMT). |
| Settlement | Paid to a Zimbabwean bank account; mobile-wallet payments settle **one day after** payment. Unverified merchants are paid **weekly, on Tuesday**. ([merchant FAQ](https://www.paynow.co.zw/home/merchanttutorial)) | Not published. |
| Refunds | **Not documented publicly.** The official Paynow SDK has no refund call; it only initiates payments, polls and parses status updates (checked in `paynow` 2.2.2 on npm). | Third-party guides describe a **refund (REF) and reversal (REV)** call that uses the original transaction ID. Unofficial. Reports say EcoCash fees and the 2% IMT levy are not returned on refunds. |
| Currency | USD and ZiG both appear in materials. Which one the integration settles in is unconfirmed. | Guides list USD and ZWG. |
| Regulation | Under the National Payment Systems Act [Chapter 24:23], payment system operators need RBZ authorisation ([RBZ](https://www.rbz.co.zw/index.php/financial-markets/national-payment-system/legal-basis)). Whether a platform that holds riders' money for drivers needs its own authorisation, or is covered by the provider's, is **unknown** and needs Zimbabwe counsel. | Same. |

**Conclusion:** the model is **not confirmed as supported**. Collecting payments
is supported. Payouts exist as products (Paynow Disbursement, EcoCash bulk
payments), but neither provider publicly says it may be used to pay out a
marketplace's sellers from money collected for them. Paynow's terms suggest
caution. Do **not** build a live adapter until one provider confirms the
arrangement in writing.

## Written questions for Paynow and EcoCash (send before choosing)

1. We operate a ride-hailing platform. We charge riders the full fare, keep a
   commission, and pay independent drivers their share. Is this permitted on
   your merchant account? If not, which product or contract allows it?
2. Does your terms' exclusion of "payment processors collecting on behalf of
   merchants" apply to this model?
3. Payouts: can we pay drivers' EcoCash wallets from our collected balance?
   Through which product (Paynow Disbursement or EcoCash bulk/EcoPay)? What
   onboarding and KYC is needed for us, and for drivers? Are there limits per
   payout and per day? What are the fees? Is there an API with a sandbox?
4. Settlement: what is the timing for EcoCash collections, to which account,
   and in USD, ZiG or both? Can payouts be made before settlement?
5. Refunds: is there an API for full and partial refunds, and within what time
   window? Are fees and the IMT levy returned? What happens to a refund after
   the funds have been settled?
6. Fees: what are the total fees per collection, per payout and per refund
   (provider plus EcoCash)?
7. Reconciliation: do you provide transaction reports or exports, and do you
   use webhooks or polling for collections and payouts?
8. Regulation: do we need our own RBZ authorisation to hold funds for drivers,
   or does your licence cover it?

## Payment flow (as designed, sandbox only)

```
Rider books ─▶ fare quoted (USD; commission not shown until a rate is set)
     │
     ▼
collection_pending ── EcoCash PIN prompt on rider's phone
     │  paid (amount checked, update id de-duplicated)   failed/cancelled ─▶ collection_failed (retry allowed)
     ▼
collected ── ledger: provider clearing +(fare − fee), provider fee,
     │        Harvey commission, driver share HELD (not yet owed)
     │  ride completed
     ▼
payable ── driver share moves from held to owed to that driver
     │  after provider settlement (settlement_days) and minimum payout,
     │  only to a verified driver EcoCash wallet
     ▼
payout_pending ── paid ─▶ paid_out      failed ─▶ back to payable (retry)
```

Refunds (full or partial):

- **Before the ride is completed:** the rider is repaid, and the held driver
  share and Harvey's commission shrink in proportion. A full refund leaves the
  driver owed nothing.
- **After completion, before payout:** the driver's owed share shrinks in
  proportion.
- **After payout:** Harvey refunds from its own funds and records the driver's
  part as **owed back** (`driver_recovery`). Recovering it, for example from
  future payouts, needs an owner-approved driver policy.
- The provider's collection fee is not assumed to be returned. Harvey carries
  it on a refund.

Settings per market, none set for Zimbabwe yet:

| Setting | Meaning | Zimbabwe |
|---|---|---|
| `commission.rate` | Harvey's share of the fare after the booking fee (the booking fee is all Harvey's) | **null: owner to set** |
| `fee_bearer` | Who carries the provider's collection fee: `platform`, `driver` or `shared` | Owner to decide |
| `settlement_days` | Wait before a driver payout (until the provider settles) | From the provider's written answer |
| `payout_min_minor` | Smallest payout, in cents | Owner to decide |

Code:

- `lib/payments/marketplaceLedger.js`: the provider-neutral state machine and
  balanced ledger. Money is in whole cents, and every event's entries sum to
  zero. It refuses an unset commission rate and any provider that isn't the
  sandbox.
- `lib/payments/sandboxEcocash.js`: a fake provider with no network access. It
  accepts only Paynow's published test numbers (0771111111 paid after 5 s,
  0772222222 paid after 30 s, 0773333333 failed). Payout and refund behaviour
  in the sandbox is **our assumption**, not the provider's.
- `lib/payments/marketplaceLedger.test.js`: the sandbox tests (the Zimbabwe
  plan, splits, fees, collection, delays, cancellation, duplicates, wrong
  amounts, refunds at each stage, failed payouts, and safety).

Not built: a provider adapter, database tables for the ledger, driver
wallet verification, a payout scheduler, reconciliation against provider
reports, and rider receipts.

## Alternatives if the model isn't supported

| Option | How it works | Trade-offs |
|---|---|---|
| **A. Provider-approved marketplace product** (preferred, if one exists) | The provider confirms a product for collecting for sellers and paying them out, such as Paynow Disbursement or EcoCash bulk payments under a marketplace contract | Matches your design. Needs a contract, KYC and possibly RBZ input. Timeline unknown. |
| **B. Driver-as-merchant** | Each driver has their own EcoCash merchant account. The rider pays the driver directly, and Harvey invoices drivers for commission, collected by EcoCash from the driver or deducted later | Harvey never holds riders' money, which lowers regulatory exposure. But every driver needs a merchant account, and commission collection, failed-payment handling and refunds are harder. |
| **C. Driver subscription instead of commission** | Riders pay drivers directly (as in B). Drivers pay Harvey a fixed weekly or monthly fee through EcoCash | Simple money flow. Changes the business model. Harvey can't control refunds. |
| **D. Licensed payment partner or bank** | A local bank or an RBZ-licensed aggregator holds the funds and does the split and payouts for Harvey | Likely the most compliant. Costs, onboarding and timeline unknown. |
| **E. Delay Zimbabwe payments** | Simulated rides only until A or D is confirmed | No risk. No revenue. |

Recommendation: send the written questions to **both** Paynow and EcoCash and
choose A if either confirms it. Otherwise, ask Zimbabwe counsel to compare
**D** and **B**. Nothing goes live in either case until you approve the
provider, the commission rate, the fee bearer and the driver recovery policy.
