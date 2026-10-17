# Notes for App Review: draft for the next submissions (October 2026)

**Status:** draft, prepared 2026-10-17 (UTC) after Apple's 16 October 2026 guideline update, which adds 2.5.19 (no hidden, dormant or undocumented features). Paste the relevant part into "Notes for Review" in App Store Connect and Google Play for:
- **Harvey Taxi Mobile** (the rider app);
- **Harvey Taxi Driver** (the driver app).

**Never put review-account passwords in this file.** Enter them only in the store consoles' sign-in fields.

**[Owner decision]** Before submitting, the owner confirms that each statement below matches what is live.

---

## Text to paste (rider app)

> Harvey Taxi Mobile lets riders in Nashville, Tennessee request rides with licensed human drivers (early access), view their trips, contact support, and use a help assistant that answers from Harvey Taxi's published pages.
>
> **Autonomous rides are not available.** The "Autonomous rides" card in the Ride Center is labelled "Coming soon" and only opens an email to join a waitlist. No autonomous ride can be requested; the server refuses that ride type.
>
> **Server-controlled settings.** Some features are switched on or off on our server without an app update. None of them adds functionality that isn't described here:
> - App Review sign-in. The "App Review Access" panel lets reviewers sign in with the demo account supplied in these notes. Review rides, payments and earnings are simulated.
> - Ride history (on).
> - Help assistant. It answers by quoting Harvey Taxi's published policy and support pages and citing them. An AI writing model is used only for designated test accounts. Off-topic questions get "not covered".
> - Food and grocery delivery: shown only where enabled, and clearly labelled.
> - Refunds are issued by staff, not in the app.
>
> **Payments** are for rides, a physical service used outside the app, so they use card payment through Stripe (Guideline 3.1.3(e)).
>
> **Safety.** Emergencies are directed to 911. Riders can contact support from the app, and support contact details are published at harveytaxiservice.com/support.html.

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

- **Delivery:** whether food and grocery delivery is enabled in production (`ENABLE_DELIVERY` / `ENABLE_FOOD_DELIVERY` / `ENABLE_GROCERY_DELIVERY` on Render). The home page currently says delivery is planned and can't be booked. The rider app wording must match whichever is live.
- **Persona:** verification is required to go online, but no Persona key is configured. Reviewers using the demo driver account are not affected. Confirm before submitting the driver app.
- **Minimum rider age:** awaiting the owner's decision. It is needed for the age rating questionnaire and for safety wording under Guideline 5.
