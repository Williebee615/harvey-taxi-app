# harveytransportationfoundation.com

Static marketing site for Harvey Transportation Assistance Foundation. Plain HTML/CSS, no build step.

## Deploy on Vercel

1. In the Vercel dashboard, **Add New → Project** and import `williebee615/harvey-taxi-app`.
2. Set **Root Directory** to `foundation-site`.
3. Framework preset: **Other** (static site) — no build command, no output directory override needed.
4. Deploy.
5. Under the project's **Settings → Domains**, add `harveytransportationfoundation.com` (and `www.harveytransportationfoundation.com` if desired) and follow Vercel's DNS instructions (A/CNAME records at your domain registrar).

This is a separate Vercel project from the main Harvey Taxi app (`harveytaxiservice.com`), so the two sites deploy and scale independently even though they live in the same repo.

## Contact details used on the site

- Email: harveytransportationfoundation@gmail.com
- Donate link: PayPal Giving Fund fundraiser (same one used on the in-app HTAF pages)
- EIN 41-5115030

No phone number is published — the Foundation doesn't have one live yet. Add one to the footer and the "Request a ride" section once available.
