# HTAF and Harvey Taxi: current dependencies and separation plan

**Date: 2026-10-12 (UTC).** Prepared for owner and counsel review. Nothing in this plan has been carried out: no page has moved, no host or DNS has changed, and no redirect has been added.

Labels: **[Verified]** (with how) · **[Unresolved]** · **[Recommendation]**.

Sharing infrastructure (one hosting service, one database, one code repository) is common for a small charity and a related business. It is not, by itself, evidence of improper private benefit. What matters is that the arrangement is documented, priced or donated on stated terms, approved by the charity's board without conflicted votes, and that the charity's data and money stay under the charity's control. This plan is about making that clear and auditable. It is not a finding that anything is wrong.

## 1. What exists today

### Legal status
- **[Verified 2026-10-12, owner-provided IRS Letter 947 dated 2026-04-15]** Harvey Transportation Assistance Foundation, EIN 41-5115030, is exempt under IRC 501(c)(3), effective 2026-04-10. It is a public charity under 170(b)(1)(A)(vi), contributions are deductible, and Form 990/990-EZ/990-N filing is required. Address on the letter: 1617 Lebanon Pike Suite A32, Nashville, TN 37210.

### Domains and hosting
- **[Verified in code, `server.js` lines 165–166 and 680–780]** `harveytransportationfoundation.com` and `www.` are served by the **same Render web service** as `harveytaxiservice.com`.
  - The server chooses content by host name. On the foundation host, `/` serves `foundation.html`; `/privacy.html`, `/terms.html` and `/service-providers.html` serve HTAF's own versions; and Harvey Taxi pages such as `/support.html` and `/app-review.html` redirect to HTAF's contact page.
  - The HTAF legal file names redirect to the foundation domain from every host.
- **[Unresolved]** The live DNS and Render custom-domain settings for the foundation domain. This environment's network policy blocks the domain, and a host-header check through the shared service returned 403.
- HTAF pages (`foundation.html`, `htaf-application.html`, `contact.html`, `leadership.html`) are also reachable on the Harvey Taxi domain, and the Harvey Taxi home page links to them.

### Applications
- **[Verified in code]** The form `htaf-application.html` posts to `POST /api/foundation/apply`, which writes to the `htaf_applications` table in the **same Supabase project** as Harvey Taxi (`orgahzncmzptljapqffj`).
  - Applicants check status by code (`/api/foundation/status/:code`), or by email/phone per `contact.html`.
- **[Verified in code]** Staff review in `admin-htaf.html` through `/api/admin/foundation/applications…`. Every route needs admin sign-in *and* an HTAF capability (`requireHtafCapability`), so a Harvey Taxi admin without the HTAF role can't read applications.
- **[Verified in code]** Creating a Harvey Taxi ride from an HTAF application (`…/create-ride`) and AI triage (`…/triage`, OpenAI) are both **blocked by default** (`lib/htafActivation.js`, #205).

### Contacts
- **[Verified, page text]** HTAF uses its own email address (WillieHtaf@harveytransportationfoundation.com, on `foundation.html`, `contact.html` and the HTAF legal pages) and its own phone number (615-636-6201). Harvey Taxi pages use support@harveytaxiservice.com.
- **[Unresolved]** Whether the address on the IRS letter should appear on HTAF's contact page (the owner decides).

### Donations
- **[Verified, page text]** "Donate" links go to an external PayPal fundraiser page (`paypal.com/us/fundraiser/charity/5906918`) on `foundation.html` and `htaf-application.html`, and inside the Harvey Taxi rider dashboard. No donation is processed by this code or by Harvey Taxi's Stripe account.
- **[Unresolved]** Which PayPal account and charity enrollment receive those funds. The owner confirms that it is HTAF's (PayPal Giving Fund enrollment under EIN 41-5115030).

### Shared services (names only; account ownership **[Unresolved]**)
- Render (hosting), Supabase (database), GitHub (code), Twilio (HTAF SMS via `HTAF_SMS_FROM_NUMBER` and the inbound webhook `/api/htaf/sms/inbound`), SendGrid (email), `HTAF_ADMIN_EMAIL`.
- **[Verified, page scan]** HTAF pages load no Google Analytics or Ads tags; the Harvey Taxi home page and Settings page do.
- The HTAF Information Assistant (approved content only, no AI) is **off** **[Verified 2026-10-11, `/api/htaf/assist/status`]**.

## 2. Separation plan (proposed; each step needs owner approval)

**Step 0: dependency check (no changes).** Before any move, list and confirm, in writing:
- DNS records and registrar for both domains;
- Render custom domains;
- the Twilio number's webhook URL and account owner;
- SendGrid sender domains;
- the PayPal fundraiser owner;
- Google accounts;
- every link or app that points to an HTAF page;
- which Supabase tables hold HTAF data (`htaf_applications`, HTAF audit rows, HTAF SMS consent records).

**Step 1: documentation (no technical change).** **[Recommendation; confirm with counsel]**
- A written services or cost-sharing agreement between Harvey Taxi Service LLC and HTAF. It covers hosting, database, software, staff time, and whether each is donated or reimbursed, and on what basis.
- The HTAF board approves it, with any director who has an interest in the LLC recused, under a written conflict-of-interest policy. The approval is recorded in minutes.
- A data-handling clause: HTAF applicant data belongs to HTAF and is used only for HTAF purposes.

**Step 2: content separation on the current hosting (low risk).**
- On the foundation domain, HTAF pages keep working as they do now.
- On the Harvey Taxi domain, HTAF pages keep one clear "separate organization" link. Done in this PR's home-page wording.
- Later, after Step 0 confirms the foundation domain resolves correctly, HTAF pages requested on the taxi domain can redirect to the same path on the foundation domain. The form endpoint (`/api/foundation/apply`) and status lookups keep working on both hosts during the change.

**Step 3: data separation.**
- Move HTAF tables to an HTAF-owned database project, or at minimum separate keys and an HTAF-only database role, with a tested export/import and a rollback copy.
- Keep the HTAF admin role separate from Harvey Taxi admin roles (already enforced in code).

**Step 4: hosting separation.**
- A separate Render service (or another host) for the foundation domain, under an HTAF-controlled account.
- Order: deploy → test forms, status lookup, SMS inbound webhook and legal pages on a preview URL → switch DNS → update the Twilio webhook → keep the old routes redirecting for at least 90 days.

**Costs:** Steps 3–4 may add hosting or database fees. They need separate approval; none are incurred by this plan.

## 3. Documents needed from the owner
1. HTAF charter or articles of incorporation, and Tennessee Secretary of State status.
2. HTAF bylaws, current board roster, and the minutes approving programs and any related-party arrangement.
3. Conflict-of-interest policy, signed by directors.
4. Any agreement between Harvey Taxi Service LLC and HTAF (services, cost-sharing, trademark or name use).
5. PayPal fundraiser and charity enrollment records, showing the receiving account.
6. Whether Tennessee charitable-solicitation registration applies to HTAF, or an exemption is claimed (counsel to confirm).
7. Account owner for Twilio, SendGrid, Render, Supabase and both domain registrations.
