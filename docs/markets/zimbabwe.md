# Zimbabwe (pilot city: Harare): readiness checklist

Status: **test mode only. Not approved to operate.** Prepared 2026-10-10
from public sources found by web search; not legal advice. Every item needs
confirmation by Zimbabwe counsel before launch.

## Verified (public sources, as reported)

| Topic | Finding | Source |
|---|---|---|
| E-hailing regulation | On 8 September 2026 Cabinet approved a **five-month moratorium on e-hailing regulation** while the Ministry of Transport drafts e-hailing regulations through industry consultation. The Ministry said in August that the Road Motor Transportation Act has no provision for e-hailing. | [CITE](https://cite.org.zw/govt-grants-e-hailing-sector-five-month-moratorium/), [NewZimbabwe](https://www.newzimbabwe.com/indrive-bolt-providing-affordable-dignified-services-says-government-as-e-hailing-services-get-five-month-reprieve/), [Daily News](https://dailynews.co.zw/five-month-moratorium-for-e-hailing-operators/) |
| What the moratorium is not | It is an interim pause on regulating the operators already in the market (reports name Bolt, InDrive, Tap & Go, GoFaster, KOSE). Operators are expected to **self-regulate on safety** and **register with ZIMRA**. Reports don't describe it as permission for new entrants. **Harvey Taxi does not treat it as permission to operate.** | Same reports |
| Data protection | Cyber and Data Protection Act [Chapter 12:07]; POTRAZ is the Data Protection Authority. SI 155 of 2024 requires a **data controller licence** from POTRAZ (reported 12-month validity). Cross-border transfers are governed by sections 28–29 (adequacy, or other grounds such as consent). Breach notification to POTRAZ is reported as 24 hours. | [Michalsons](https://www.michalsons.com/blog/zimbabwes-cyber-and-data-protection-act-overview/78795), [MMM Law](https://www.mmmlawfirm.co.zw/?p=26834) |
| Phone numbers | +263; mobile numbers 7X XXX XXXX (Econet 77/78, NetOne 71, Telecel 73). | Numbering plan (as configured) |
| Currency | Multi-currency: USD is used for most transactions alongside ZiG (ZWG); official rate about 25.6 ZiG per USD in early 2026. | Secondary sources only; see unresolved |

## Unresolved (must be answered before live service)

1. **Permission to operate:** is a new e-hailing operator allowed to start during the moratorium, and under what conditions? What do the coming regulations require (operator licence, vehicle and driver permits, fees)?
2. **Tax:** ZIMRA registration, VAT on fares and commissions, and withholding on driver payouts.
3. **Company presence:** whether a local entity, local director or local bank account is required.
4. **Currency:** whether fares are quoted and settled in USD, ZiG or both; exchange-rate source; rounding.
5. **Pricing:** local fare levels (current values are illustrative). **Commission rate: not set**; the owner sets it (no split is computed until then).
6. **Payments: EcoCash only (owner decision, 10 Oct 2026).** Harvey Taxi collects the rider's fare, keeps its commission and pays the driver's share. Neither Paynow nor EcoCash publicly documents that marketplace arrangement, and Paynow's published terms appear to exclude collecting on behalf of others. Written confirmation is required first: see [zimbabwe-payments.md](zimbabwe-payments.md). **Not to be enabled until confirmed.**
7. **No cash bookings in Zimbabwe.** Cash is removed from the plan (owner decision, 10 Oct 2026).
8. **Emergency numbers:** sources agree on 999 (all), 995 police, 994 ambulance, 993 fire, but some say ambulance and fire are landline-only and 999 is unreliable outside Harare. Confirm what a rider's mobile phone can reach in Harare.
9. **Driver documents:** confirm the list (national ID, licence class, defensive driving certificate, police clearance, vehicle registration, ZINARA licence, insurance with passenger cover, any operator or route permit) and which ones expire.
10. **Background checks:** Checkr lists Zimbabwe in its international coverage, check types unknown; Persona coverage of Zimbabwean IDs not confirmed.
11. **SMS sign-in:** Twilio Verify delivery and sender ID rules for Zimbabwe (Twilio's guidance was unclear).
12. **Maps:** Mapbox address quality and routing in Harare; address search is US-only today.
13. **Privacy:** POTRAZ licence; whether hosting in the US is an adequate transfer; whether a transfer notice to POTRAZ is required (one source says so, others don't); a Zimbabwe privacy notice; AI data transfers (the AI model is off for this market until assessed).
14. **Insurance:** commercial passenger cover for drivers and platform liability.

## Technical readiness

| Item | Status |
|---|---|
| Market settings (Harare, Africa/Harare, km, USD/ZiG, +263, 999) | Done (test mode) |
| Simulated rides in the admin preview | Done |
| Market guard (no live estimates or rides) | Done |
| `market_id` isolation migration | Written, not applied |
| Dispatch matches drivers by market | **Not done (blocker)** |
| Address search outside the US | Not done (server change) |
| +263 SMS sign-in | Phone rules done; Twilio delivery unconfirmed |
| Driver app: local emergency number, currency, km | Needs a driver build |
| EcoCash (only method; no cash) | Sandbox ledger and tests only; no provider adapter; disabled |
| Driver document upload, review, expiry | Settings only; not built |
