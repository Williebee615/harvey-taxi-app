# Nigeria (pilot city: Lagos): readiness checklist

Status: **test mode only. Not approved to operate.** Prepared 2026-10-10
from public sources found by web search; not legal advice. Every item needs
confirmation by Nigerian counsel before launch.

## Verified (public sources, as reported)

| Topic | Finding | Source |
|---|---|---|
| Operator permit (Lagos) | Lagos regulates e-hailing under an amended 2023 regulation: CAC incorporation, then a permit (an app-only platform falls under the "Service Entity" category), renewal starting three months before expiry, and quarterly meetings with the Ministry of Transportation. In August 2025 the State ordered operators to complete licensing by 30 September 2025. | [AA Law](https://aalawsng.com/insights/criteria-for-creation-of-e-hailing-businesses-in-lagos-state-nigeria/), [Metalex](https://metalexlegal.com/publication/article/establishing-an-e-hailing-service-legal-framework-and-compliance.166), [Channels TV](https://www.channelstv.com/2025/08/10/lagos-orders-mandatory-checks-for-e-hailing-drivers/) |
| Drivers (Lagos) | At least 21; valid driver's licence; annual LASDRI certificate of competence and LASDRI card; LASRRA card; driver's badge; literate. Vehicles registered in Lagos and inspected. | Same sources |
| Data protection | Nigeria Data Protection Act 2023; NDPC. Its 2024 guidance treats a controller processing data of more than 200 people in six months as of "major importance", which must **register** and file annual compliance audits. Cross-border transfers need adequacy or another basis (binding corporate rules, contract clauses, codes, certification). | [KPMG copy of the Act](https://assets.kpmg.com/content/dam/kpmg/ng/pdf/nigeria-data-protection-act2023.pdf), [NDPC guidance (KPMG)](https://assets.kpmg.com/content/dam/kpmg/ng/pdf/2024/03/Nigeria%20Data%20Protection%20Commission%E2%80%99s%20Guidance%20Notice%20on%20Registration%20of%20Data%20ProcessorsControllers%20of%20Major%20Importance.pdf) |
| SMS sign-in | NCC do-not-disturb rules; Twilio routes OTP traffic to DND numbers; **sender ID registration required**. | [Twilio Nigeria guidelines](https://www.twilio.com/en-us/guidelines/ng/sms) |
| Phone numbers | +234; mobile 70x, 80x, 81x, 90x, 91x (10 digits after +234). | Numbering plan (as configured) |

## Unresolved

1. **Permit:** which Lagos permit category applies to Harvey Taxi, fees, timeline, and whether the 2023 regulation is still current.
2. **Company presence:** CAC incorporation, tax (FIRS and Lagos State), VAT on commissions.
3. **Pricing:** local fare levels (current values are illustrative).
4. **Payments:** choose a provider (for example Paystack or Flutterwave): merchant onboarding, fees, settlement and refunds. Cash: driver remittance and receipts. **Not enabled until known.**
5. **Emergency numbers:** 112 is widely listed; Lagos 767 is listed by MTN. Confirm which work from mobiles in Lagos.
6. **Driver documents and expiry:** confirm the list (NIN, licence, LASDRI, LASRRA, badge, vehicle registration, inspection, insurance) and how to verify each (LASDRI lookup?).
7. **Identity and background checks:** Persona and Checkr coverage for Nigeria not confirmed; local KYC (NIN verification) may be needed.
8. **Privacy:** NDPC registration, a Nigeria privacy notice, transfer basis for US hosting and for AI (AI off until assessed).
9. **Maps and traffic:** address quality and routing in Lagos; travel-time assumptions (simulation uses 18 km/h, a placeholder).
10. **Insurance.**

## Technical readiness

Same as [Zimbabwe](zimbabwe.md#technical-readiness), with NGN, Africa/Lagos, +234 and 112; payments via a local provider instead of EcoCash.
