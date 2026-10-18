# Notes for App Review: draft for the next submissions (October 2026)

**Status:** draft, prepared 2026-10-17 (UTC) after Apple's 16 October 2026 guideline update, which adds 2.5.19 (no hidden, dormant or undocumented features). Paste the relevant part into "Notes for Review" in App Store Connect and Google Play for:
- **Harvey Taxi Mobile** (the rider app);
- **Harvey Taxi Driver** (the driver app).

**Never put review-account passwords in this file.** Enter them only in the store consoles' sign-in fields.

**Updated 2026-10-18 (UTC):** the home-screen "App Review Access" panel was removed. Only a small "App Review Sign-In" link remains, in the footer, shown while signed out ([Owner decision] 2026-10-18: hide the panel, keep the sign-in link). The rider text below says where to find it.

**Updated 2026-10-18 (UTC), Just-in-Time booking (#294) and the sign-in requirement (#295):**
- Requesting a ride now needs a signed-in rider (#295, live). Reviewers sign in with the App Review link, as before.
- Phone sign-up at "Confirm Ride" (#294) is built and **switched off** (`jit_booking_enabled`; [Owner decision] 2026-10-18: keep it off). Guideline 2.5.19 asks for dormant, server-switched features to be described, so the rider text below lists it as off. Use the alternative paragraph below only if it has been switched on before the submission.

**[Owner decision]** Before submitting, the owner confirms that each statement below matches what is live.

---

## Text to paste (rider app)

> Harvey Taxi Mobile lets riders in Nashville, Tennessee request rides with licensed human drivers (early access), view their trips, contact support, and use a help assistant that answers from Harvey Taxi's published pages.
>
> **Autonomous rides are not available.** The "Autonomous rides" card in the Ride Center is labelled "Coming soon" and only opens an email to join a waitlist. No autonomous ride can be requested; the server refuses that ride type.
>
> **Server-controlled settings.** Some features are switched on or off on our server without an app update. None of them adds functionality that isn't described here:
> - App Review sign-in. While signed out, scroll to the bottom of the rider home screen and tap the small "App Review Sign-In" link in the footer, then sign in with the demo account supplied in these notes. Review rides, payments and earnings are simulated.
> - Phone sign-up at booking (currently **off**). When switched on, a visitor can see the map and a fare estimate without an account. Tapping "Confirm Ride" asks for a first name and a US mobile number, and a one-time code is sent by text message to confirm it. The confirmed number creates or signs in to the rider account, which can then add a card and request the ride. Staff can suspend an account. Nothing else about the app changes when this is on, and the App Review sign-in is unaffected.
> - Ride history (on).
> - Help assistant. It answers by quoting Harvey Taxi's published policy and support pages and citing them. An AI writing model is used only for designated test accounts. Off-topic questions get "not covered".
> - Food and grocery delivery: shown only where enabled, and clearly labelled.
> - Refunds are issued by staff, not in the app.
>
> **Payments** are for rides, a physical service used outside the app, so they use card payment through Stripe (Guideline 3.1.3(e)).
>
> **Safety.** Emergencies are directed to 911. Riders can contact support from the app, and support contact details are published at harveytaxiservice.com/support.html.

### Alternative paragraph (rider app), only if phone sign-up is switched on for the submission

Replace the "Phone sign-up at booking" item above with:

> - Phone sign-up at booking (**on**). New riders can see the map and a fare estimate without an account. "Confirm Ride" asks for a first name and a US mobile number and sends a one-time code by text message (message and data rates may apply). The confirmed number creates the rider account, which can then add a card and request the ride. Accounts can be deleted in the app: Settings → "Request Account Deletion". Reviewers can still use the App Review sign-in link at the bottom of the home screen; the demo account is not affected, and no text message is needed for it.

## Text to paste (driver app)

> Harvey Taxi Driver is for approved drivers: go online, receive and accept ride offers, navigate, and see earnings. Every Harvey Taxi trip has a licensed human driver.
>
> The sign-up page mentions a planned **Autonomous Vehicle Owner Program**. It is labelled "planned, not available" and only opens an email to register interest. No autonomous driving or vehicle-dispatch feature exists in the app.
>
> **Server-controlled settings:**
> - App Review demo sign-in and simulated ride offers for reviewers.
> - Native push notifications for ride offers.
> - Identity and background checks (Persona, Checkr), run by our back end only. The app has no buttons for them.

## [Unresolved] items to confirm before submitting

- **Phone sign-up (Just-in-Time booking):** confirm with `GET https://harveytaxiservice.com/api/rider/jit-config` on the day (`enabled: false` → keep the "currently off" text; `true` → use the alternative paragraph). [Verified 2026-10-18 12:51 UTC] `enabled: false`; `POST /api/rider/quick/start` answered 404.
- **If phone sign-up is on for a submission:**
  - Confirm "Request Account Deletion" in Settings works for a phone-only account (no email); not yet tested.
  - Phone codes are a first-party sign-in, not a third-party login, so Sign in with Apple (Guideline 4.8) isn't triggered by this feature.
  - Reviewers outside the US can't receive a US code, so the demo account remains the review path.

- **Delivery:** whether food and grocery delivery is enabled in production (`ENABLE_DELIVERY` / `ENABLE_FOOD_DELIVERY` / `ENABLE_GROCERY_DELIVERY` on Render). The home page currently says delivery is planned and can't be booked. The rider app wording must match whichever is live.
- **Persona:** verification is required to go online, but no Persona key is configured. Reviewers using the demo driver account are not affected. Confirm before submitting the driver app.
- **Minimum rider age:** awaiting the owner's decision. It is needed for the age rating questionnaire and for safety wording under Guideline 5.
