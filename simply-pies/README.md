# Simply Steak and Chicken Pies: Ordering Site

A mobile-first ordering site for the Instagram link in bio. Customers order
and pay on their phone, then tap **I've Arrived** at pickup. The kitchen
sees orders live on a tablet and gets an alert when a customer is outside.

This app is fully separate from the Harvey Taxi app in this repository. It
has its own server, dependencies and deployment.

## What's included

| Brief requirement | Where |
| --- | --- |
| Mobile-first link-in-bio landing page, no app download | `/` (`public/index.html`) |
| Image-led listings for the 5 pies (4-inch round, short crust base, rough puff top) | `config.js` menu, `public/images/` |
| Cart and checkout, multiple quantities per flavor | Cart sheet on `/` |
| Card, Apple Pay and Google Pay payments | Stripe Checkout (hosted, PCI-compliant) |
| Live active order screen | `/order` (updates every few seconds, keeps the screen awake) |
| One-tap "I've Arrived" button | `/order` |
| Kitchen dashboard for tablet or phone | `/kitchen` (New, Preparing, Ready, Finished) |
| Distinct audio and visual arrival alerts | `/kitchen`: repeating alarm, red banner, flashing tab, system notification |

## Run locally (preview mode, no payments)

```bash
cd simply-pies
npm install
npm run dev          # http://localhost:3100, kitchen passcode: kitchen
```

In preview mode, orders go straight to the kitchen and no payment is taken.
The server refuses to start in preview mode when `NODE_ENV=production`.

## Before launch: information needed from the owner

The server lists anything still missing each time it starts. Edit `config.js`:

1. **Prices** for each pie. The $9.00 prices are placeholders. Set
   `PRICES_CONFIRMED = true` once the real prices are in.
2. **Pie descriptions.** The current lines are short drafts. Replace them
   with the real fillings and any allergen information.
3. **Pickup address, pickup instructions, hours, phone, email and Instagram
   handle.** Blank fields are hidden on the site.
4. **Photos:** see `public/images/README.md`.
5. **Sales tax.** Totals do not include tax yet. Confirm with an accountant
   whether prepared food sales need tax collected. If they do, enable Stripe
   Tax or add a tax line.

## Deploy to Vercel

The app is ready for Vercel. The pages in `public/` are served from Vercel's
CDN, and `api/index.js` runs the API as a serverless function. Orders are
stored in Postgres because Vercel functions have no permanent disk.

**Plan note:** Vercel's free Hobby plan is limited to non-commercial,
personal use. A business that takes orders needs the **Pro** plan. Check
current pricing at vercel.com/pricing.

1. **Import the project.** In Vercel choose *Add New → Project*, import this
   GitHub repository, and set **Root Directory** to `simply-pies`. Leave the
   framework as *Other*. `vercel.json` sets the rest.
2. **Add a database.** In the project open *Storage → Create Database* and
   choose a Postgres provider such as Neon. Connect it to the project. This
   adds `DATABASE_URL` automatically. The app creates its tables on first use.
   Any Postgres works, including Supabase. Use the *pooled* connection string.
3. **Add environment variables** (*Settings → Environment Variables*). See
   the table below.
4. **Deploy**, then open `/kitchen` and sign in to confirm it works.
5. **Add the domain** `hellosimplysteakandchickenpies.com` (see *Domain setup* below). Then set
   `PUBLIC_BASE_URL` to `https://hellosimplysteakandchickenpies.com` and redeploy.
6. **Connect Stripe** (see below). Place a test order with test keys first.
7. **Update the Instagram bio link** to the new domain.

## Domain setup

The domain `hellosimplysteakandchickenpies.com` is registered with Squarespace Domains through
Google Workspace, which also runs the business email. The steps below point
the website at Vercel **without touching email**.

1. **Verify the domain contact first.** Squarespace emails a verification
   link after purchase. If it is not confirmed within 15 days, the domain is
   suspended, which takes down both the website and email.
2. In Vercel, open *Settings → Domains* and add `hellosimplysteakandchickenpies.com`. When asked, also
   add `www.hellosimplysteakandchickenpies.com` and have it redirect to the main domain.
3. Vercel then lists the DNS records to create, usually an **A** record for
   the root (`@`) and a **CNAME** record for `www`. Use the exact values
   Vercel shows, because they can differ between projects.
4. Sign in to Squarespace Domains with the domain administrator account. Go
   to *Domains → hellosimplysteakandchickenpies.com → DNS → DNS Settings* and add those records under
   **Custom records**. If Squarespace already has default website records
   for `@` or `www` (Squarespace website presets), remove those so they do
   not conflict.
5. **Do not change the nameservers, and do not delete the Google Workspace
   records** (the MX records and any TXT verification records). Those
   records carry the business email.
6. Back in Vercel, wait until both domains show as valid. DNS changes can
   take from a few minutes to a few hours. Vercel issues the HTTPS
   certificate automatically.

Customer-facing email: consider an alias such as `orders@` or `hello@` on
this domain (created in the Google Workspace Admin console) rather than
publishing the administrator sign-in address. Put it in `config.js` as
`business.email`.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes, on Vercel | Postgres connection string. Added by the Vercel storage integration. `POSTGRES_URL` is also accepted. |
| `STRIPE_SECRET_KEY` | Yes, for live orders | Stripe secret key (`sk_live_...`, or `sk_test_...` for testing) |
| `STRIPE_WEBHOOK_SECRET` | Recommended | Signing secret for the `/api/stripe/webhook` endpoint |
| `KITCHEN_PASSCODE` | Yes | Passcode for the `/kitchen` dashboard. Use a long one. |
| `SESSION_SECRET` | Yes, in production | Long random string that signs kitchen sign-ins (for example, the output of `openssl rand -hex 32`) |
| `PUBLIC_BASE_URL` | Recommended | e.g. `https://order.example.com`, used in Stripe return links |
| `SIMPLY_PIES_DATA_DIR` | Local only | Where `orders.json` is kept when no database is set |
| `DEMO_PAYMENTS` | Local only | `true` to take orders without payment. Refused in production. |

If a required production setting is missing, the API refuses orders rather
than running unsafely. The reason appears in the Vercel function logs.

### Stripe setup

1. Create or verify the Stripe account under the business's legal name.
2. In the Dashboard under **Settings → Payment methods**, turn on Cards,
   Apple Pay and Google Pay. Checkout shows the wallets automatically on
   supported devices. Payment happens on Stripe's hosted checkout page, so
   no Apple Pay domain registration is needed on this site.
3. Under **Developers → Webhooks**, add `https://hellosimplysteakandchickenpies.com/api/stripe/webhook`
   with the events `checkout.session.completed`,
   `checkout.session.async_payment_succeeded` and `checkout.session.expired`.
   Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Place a test order with `sk_test_...` keys and card `4242 4242 4242 4242`,
   and confirm the webhook shows as delivered in Stripe. Then switch to live keys.

The server prices every order from `config.js` and checks that the amount
Stripe charged matches before an order reaches the kitchen. If a webhook is
delayed, the customer's order page also confirms payment with Stripe
directly. Cancelling an order on the dashboard does **not** refund it. Issue
refunds in the Stripe Dashboard.

### How live updates work

The order page checks for updates every 4 seconds, and the kitchen dashboard
every 3 seconds. This fits Vercel's serverless model and needs no extra
service. A busy day with the kitchen dashboard open for 8 hours makes about
10,000 requests, well within Vercel's included usage. Check your plan's
limits if the dashboard runs around the clock.

### Running elsewhere

`npm start` runs the same app as a normal Node server (Render, Railway,
Fly.io and similar). Without `DATABASE_URL` it saves orders to
`data/orders.json`, which needs a persistent disk on those hosts.

## Kitchen dashboard tips

- Open `/kitchen` on a tablet, sign in, and tap **Tap to start alerts**.
  Browsers only allow sound after a tap.
- Keep the tablet plugged in with the volume up. The page asks the device to
  keep the screen on.
- An arrival alarm repeats every 15 seconds until someone taps the red banner
  or marks the order **Handed over**.

## Tests

```bash
npx jest simply-pies   # from the repository root

# Also run the API tests against a real Postgres database:
SIMPLY_PIES_TEST_DATABASE_URL=postgres://... npx jest simply-pies --runInBand
```
