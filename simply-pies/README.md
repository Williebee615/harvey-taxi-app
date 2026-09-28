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
| Live active order screen | `/order` (live updates, keeps the screen awake) |
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

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Yes, for live orders | Stripe secret key (`sk_live_...`, or `sk_test_...` for testing) |
| `STRIPE_WEBHOOK_SECRET` | Recommended | Signing secret for the `/api/stripe/webhook` endpoint |
| `KITCHEN_PASSCODE` | Yes | Passcode for the `/kitchen` dashboard. Use a long one. |
| `SESSION_SECRET` | Yes, in production | Long random string that signs kitchen sign-ins |
| `PUBLIC_BASE_URL` | Recommended | e.g. `https://order.example.com`, used in Stripe return links |
| `SIMPLY_PIES_DATA_DIR` | Optional | Where `orders.json` is stored (default `./data`) |
| `PORT` | Optional | Default `3100` |
| `DEMO_PAYMENTS` | Local only | `true` to take orders without payment |

### Stripe setup

1. Create or verify the Stripe account under the business's legal name.
2. In the Dashboard under **Settings → Payment methods**, turn on Cards,
   Apple Pay and Google Pay. Checkout shows the wallets automatically on
   supported devices.
3. Under **Developers → Webhooks**, add `https://<your-domain>/api/stripe/webhook`
   with the events `checkout.session.completed`,
   `checkout.session.async_payment_succeeded` and `checkout.session.expired`.
   Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Place a test order with `sk_test_...` keys and card `4242 4242 4242 4242`
   before switching to live keys.

The server prices every order from `config.js` and checks that the amount
Stripe charged matches before an order reaches the kitchen. Cancelling an
order on the dashboard does **not** refund it. Issue refunds in the Stripe
Dashboard.

## Deployment notes

- Any Node 20+ host works (Render, Railway, Fly.io and similar). Use root
  directory `simply-pies`, build command `npm install` and start command
  `npm start`.
- Orders are saved to a JSON file. On hosts with temporary disks (such as
  Render's default), attach a persistent disk and point
  `SIMPLY_PIES_DATA_DIR` at it, or orders will be lost on redeploy. For
  higher volume, move storage to a database (for example Supabase/Postgres).
  `lib/orderStore.js` is the only file that would change.
- Run a single instance. Live updates are held in memory.
- Put the site on its own domain or subdomain and add it to the Instagram bio.

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
```
