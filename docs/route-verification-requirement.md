# Ride Quote Integrity — Current State and Pre-Launch Requirement

**Status: current state documented, follow-up requirement NOT implemented.** This records exactly what the ride-quote token system (`lib/rideQuote.js`, PR #92) does and does not prove, so that distinction can't get lost by the time general public launch is being considered.

## What the quote token proves

Every fare a rider can pay or dispatch against now comes from a server-issued, HMAC-signed token (`estimate_token`) minted by `POST /api/rides/estimate` and required by `POST /api/rides/payment-intent` and `POST /api/rides/request`. The token freezes `ride_type`, `miles`, `minutes`, pickup/destination coordinates, the rider it was issued to, and the fully computed fare/fee breakdown at the moment of issuance.

This guarantees:
- A rider is charged exactly the fare they were quoted — payment-intent and ride-request read pricing exclusively from the token, never from resubmitted `miles`/`minutes`/fare/fee fields.
- A quote can't be altered after issuance (signature-verified) or reused past its short TTL (15 minutes by default), for a different rider, a different service type, or a different pickup/destination (`quoteMatchesSubmission`, `lib/rideQuote.js`).

## What the quote token does NOT prove

**The distance frozen inside the token is not independently verified by the server against a routing provider.** It is whatever `rider-dashboard.html`'s own browser-side call to Google Maps' Distance Matrix API returned (see `ensureTripDistance()`) at the moment the rider requested an estimate. The server signs and locks that number in — it does not re-derive it from Google Routes/Distance Matrix itself, and has no way to detect a distance that was wrong (not necessarily malicious — a stale cache, a client bug, a compromised/modified client) at the moment it was computed.

Every estimate response is labeled honestly to reflect this: `quote_source: "browser_calculated"`.

**Concretely, this means:** the quote-integrity system closes "a client resubmitted different numbers than what was quoted." It does not close "the browser's original Distance Matrix call itself returned or was made to return a wrong distance." Both are real trust boundaries; only the first is closed as of this document.

## Pre-launch requirement

**Before general public launch**, `POST /api/rides/estimate` must independently obtain (or verify) the route distance server-side against an approved routing provider (Google Routes API or Distance Matrix API, server-side key — distinct from `GOOGLE_MAPS_BROWSER_KEY`) before signing a quote token, rather than trusting the browser-supplied `miles`/`minutes` values as-is.

This is deliberately **not implemented in PR #92** per explicit instruction not to enable paid routing flags without separate approval — server-side Google Routes/Distance Matrix calls are billed per-request and distinct from the existing client-side Maps JS key. Implementing this is a follow-up PR, gated on:
1. Explicit approval to enable a server-side routing API key and accept its cost.
2. A decision on fallback behavior if the server-side routing call itself fails (this system's existing fail-closed principle — "no valid route + no verified fare = no payment and no dispatch" — should extend to this case too, not silently fall back to the browser's unverified number).
3. Updating `quote_source` to `"server_verified"` (or similar) once the server is the actual source of truth for the distance, so the estimate response continues to tell the truth about where the number came from.

Until this is done, `general public launch` should be treated as gated on this requirement the same way it is currently gated on rider-authentication enforcement (`docs/rider-auth-design-proposal.md`) and the Phase 1 hardening audit (`docs/production-hardening-phase1-audit.md`).
