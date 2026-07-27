# harveytransportationfoundation.com

Static marketing site for Harvey Transportation Assistance Foundation. Plain HTML/CSS, no build step, no framework.

Pages: `index.html` (home), `mission.html`, `programs.html`, `get-involved.html`, `donate.html`, `contact.html`. Shared styles live in `styles.css`. This is a real multi-page site (not anchor sections on one page) — Google for Nonprofits rejected an earlier single-page version for exactly that reason.

## Deploy on Vercel

1. In the Vercel dashboard, **Add New → Project** and import `williebee615/harvey-taxi-app`.
2. Set **Root Directory** to `foundation-site`.
3. Framework preset: **Other** (static site) — no build command, no output directory override needed.
4. Deploy.
5. Under the project's **Settings → Domains**, add `harveytransportationfoundation.com` (and `www.harveytransportationfoundation.com` if desired) and follow Vercel's DNS instructions (A/CNAME records at your domain registrar).

This is a separate Vercel project from the main Harvey Taxi app (`harveytaxiservice.com`), so the two sites deploy and scale independently even though they live in the same repo.

## Contact details used on the site

- Email: harveytransportationfoundation@gmail.com
- Mailing address: 1617 Lebanon Pike, Nashville, TN 37210 (from the officers' address on the TN charitable solicitation registration, apartment number omitted for the public site)
- Donate link: PayPal Giving Fund fundraiser (same one used on the in-app HTAF pages)
- EIN 41-5115030

No phone number is published — the Foundation doesn't have one live yet. Add one to the footer and the "Request a ride" section once available.

## Re-submitting to Google for Nonprofits

Google's rejection cited two issues, both addressed here:
1. "Single-page layout" → now six real pages with their own URLs (see above).
2. Missing physical address / clear mission statement → address is on the Contact page and in every page footer; a labeled "Mission statement" callout is on the Home and Mission pages.

After deploying, re-check the live site, then reply to the Google for Nonprofits support email to ask them to re-review.
