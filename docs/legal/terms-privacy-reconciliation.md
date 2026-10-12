# Terms and Privacy: reconciliation for legal review

**Date: 2026-10-12 (UTC).** Prepared for owner and counsel review. Not legal advice. Nothing here is published. Policy pages are not edited in this PR, so this doesn't conflict with PR #207.

Labels: **[Verified]** (with how) · **[Unresolved]** · **[Recommendation]** · **[Draft provision]** (for counsel to accept, edit or reject).

## 1. Which documents exist today

| URL (Harvey Taxi domain) | File | Linked from | Status |
|---|---|---|---|
| `/privacy.html` | `public/privacy.html`, "Effective Date: May 2026" | Website footers | Short. Doesn't name the providers below. Describes payments as going through "sandboxed third-party networks (like Stripe or Apple Pay)". |
| `/privacy-policy.html` | `public/privacy-policy.html` | Driver app build 13 (`LINKS.privacy`), App Store listing | Fuller. **PR #207** edits this file (AI section and provider list); unpublished pending owner checks. |
| `/terms.html` | `public/terms.html`, "Effective Date: April 5, 2026" | Website and apps | Short; gaps listed in section 4. |
| Foundation domain `/privacy.html`, `/terms.html`, `/service-providers.html` | `htaf-*.html` | HTAF pages | Separate HTAF documents (`docs/htaf-separation-plan.md`). |

**[Verified 2026-10-12, byte comparison]** Production serves the same files as `main` at `8bee024`.
`robots.txt` disallows `/privacy-policy.html`, the policy the app and store listing link to. Search engines may therefore index the shorter policy rather than the fuller one.

**[Recommendation]**
- One Harvey Taxi privacy policy. After #207 is approved, make `privacy-policy.html` the single policy and redirect `/privacy.html` to it on Harvey Taxi hosts, leaving the foundation host's override untouched.
- Remove the `robots.txt` block for it.
- Do this in #207, or in a follow-up after #207 merges, not in parallel.

## 2. What the platform actually collects and sends (from code)

**[Verified in code, `main` at `8bee024`, 2026-10-12]**

| Data | Purpose | Recipient |
|---|---|---|
| Name, email, phone, password hash or sign-in codes | Accounts and sign-in | Supabase (database), Twilio (SMS codes), SendGrid (email) |
| Driver identity documents and selfie | Identity check | Persona, when `ENABLE_PERSONA` is on (on in production) |
| Driver background-check information | Background check | Checkr, when `ENABLE_CHECKR` is on (on in production) |
| Vehicle make, model, year and plate | Driver profile | Supabase |
| Pickup and drop-off addresses, live location during trips | Dispatch, tracking, fares | Supabase, Mapbox (maps), Google Maps Platform Routes API when `GOOGLE_ROUTES_API_KEY` is set **[Unresolved: production value]** |
| Payment card details | Payment authorization | Stripe (card data does not reach our server) |
| Push notification tokens | Ride alerts | Expo, Apple, Google, browser push services |
| Harvey Assistant messages and the account's own ride facts | AI answers for test accounts only | Anthropic (Claude Haiku 4.5); consent is pending #210 |
| Old website chat messages | Support chat | OpenAI, if `OPENAI_API_KEY` is set **[Unresolved]**; #219 turns it off |
| Page visits | Analytics and ad measurement | Google Analytics `G-814LXYV9DN` and Google Ads `AW-18161547185` on the home and Settings pages. **[Unresolved]** what is collected or shared depends on the Google account settings. |
| HTAF applications | Assistance review | Supabase (`htaf_applications`), HTAF staff |

## 3. Privacy gaps against the code (for #207 and the single policy)
1. **Providers.** The `/privacy.html` page names only Stripe and Apple Pay. **[Unresolved]** Whether Apple Pay is actually offered. #207's list (updated 2026-10-11) names the rest.
2. **"Sandboxed".** Production payments are not sandboxed. **[Draft provision]** "Card payments are processed by Stripe. We don't receive or store full card numbers."
3. **Advertising.** "We do not broker, trade, or expose … to outside advertising companies" sits alongside a live Google Ads tag. **[Unresolved, legal]** Whether this is a "sale" or "sharing" under applicable state laws depends on the tag's configuration and data use. That needs the Google account settings, not just the tag's presence. Counsel decides the wording and whether a cookie notice or opt-out is needed.
4. **AI.** Describe the assistant, the provider, what is sent, consent (once #210 ships), and how to turn it off. This is in #207's draft.
5. **Screening.** **[Draft provision]** "Drivers must complete an identity check through Persona and a background check through Checkr before they can go online. We receive the result of these checks, not the full report, unless the law requires otherwise." **[Unresolved]** What Checkr and Persona actually return to us under our accounts; counsel and the owner confirm. Any FCRA notices belong to the Checkr flow.
6. **Retention.** **[Unresolved]** No retention periods are written down for ride records, location history, support cases, AI chat records, consent records or HTAF applications. **[Recommendation]** The owner sets periods per data type; the policy states them; a scheduled deletion job enforces them (separate work).
7. **Contact.** Two addresses appear: support@harveytaxiservice.com (public pages, store listing) and Williebee@harveytaxiservice.com (`/api/config/public` `support_email`). **[Unresolved]** Which is the privacy contact. The policy should give one address and a postal address.
8. **Children.** State the minimum age (counsel to set; rider and driver ages may differ).
9. **Effective date and change notice.** Use one dated version per publication.

## 4. Terms gaps
**[Verified, page text of `public/terms.html`]** The Terms don't cover:
- driver relationship (independent contractor or otherwise);
- governing law and venue;
- dispute resolution;
- the cancellation policy (draft in #192, unpublished);
- the AI assistant;
- SMS terms (STOP/HELP);
- minimum age;
- account termination;
- a contact address;
- insurance;
- operating authorization.

**[Draft provisions]** for counsel to accept, edit or reject. Each is worded so that it doesn't assert a fact we can't support:
- **Operator.** "The Harvey Taxi platform is operated by Harvey Taxi Service LLC, a Tennessee limited liability company." **[Unresolved]** Owner to confirm state of organization and good standing.
- **Service status.** "Ride requests are available in early access in Nashville, Tennessee. Delivery and autonomous rides are not offered."
- **Driver checks.** "Drivers must pass an identity check and a background check and be approved before they can go online. A completed check is not a guarantee of future conduct."
- **AI assistant.** "Harvey Assistant gives automated answers that may be incomplete or wrong. It can't book, cancel or change anything; you confirm every action. In an emergency, call 911."
- **Translations.** "Translations of this site are automatic and may contain errors. The English version of these Terms controls."
- **Waitlists.** "Joining a waitlist by email doesn't create an account or a booking. We'll use your email only to tell you about that service."
- **HTAF.** "Harvey Transportation Assistance Foundation is a separate nonprofit organization. Its assistance program has its own terms."

**Not drafted because they need owner documents first:**
- **Insurance:** what coverage applies, during which trip periods.
- **Operating authorization:** what state or Metro Nashville permit or license is held for passenger transport.
- **Airport:** **[Owner decision 2026-10-12]** Airport service is available through Harvey Taxi Service (owner-confirmed). The site says only "Available. Request an airport trip the same way as any other ride." **[Unresolved]** The permit or agreement and its scope (which airport, pickups and/or drop-offs, pickup locations, conditions). No airport name, pickup location or permit coverage is published until that is documented.
- **Governing law and dispute resolution.**

## 5. Owner documents needed to support public claims

| Claim or provision | Document |
|---|---|
| HTAF is a 501(c)(3) public charity, EIN 41-5115030 | **Received 2026-10-12:** IRS Letter 947 dated 2026-04-15 (photo). Keep the original on file. |
| HTAF governance and board | Bylaws, board roster, minutes, conflict-of-interest policy |
| Harvey Taxi Service LLC organization and good standing | Tennessee Secretary of State record |
| Authority to carry passengers for hire in Nashville | State or Metro Nashville permit or license |
| Airport trips (availability owner-confirmed 2026-10-12) | Airport permit or operating agreement, with its scope: which airport, pickups and/or drop-offs, locations, conditions, expiry |
| Insurance | Commercial auto or TNC policy declarations and the trip periods covered |
| Driver screening | Active Checkr and Persona accounts, and the compliance terms of each (FCRA flow) |
| AI provider terms | Anthropic Console data settings and commercial terms; OpenAI account status (or its removal) |
| Payments | Stripe account status and the business named on it; whether Apple Pay is enabled |
| SMS | Twilio A2P 10DLC registration for each sending number |
| Donations | PayPal charity enrollment for HTAF |
