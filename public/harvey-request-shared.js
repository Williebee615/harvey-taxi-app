/**
 * Harvey Taxi — shared rider-request helpers.
 *
 * rider-dashboard.html embeds two independent script contexts (the
 * ride/food/grocery wizard, wrapped in its own IIFE, and the dashboard's
 * own top-level script). Both previously computed the API base URL with
 * their own separate copy of similar-looking logic. This file is the
 * single source of truth for that computation, loaded before either
 * script so both can call window.resolveHarveyApiBase() instead of
 * maintaining separate copies.
 *
 * The two pre-existing copies were NOT quite equivalent: the dashboard's
 * own version fell back to a hardcoded "https://harveytaxiservice.com"
 * for any hostname other than *.onrender.com / *harveytaxiservice*
 * (including localhost during local dev/testing, or any other domain
 * this same Express app is served from), which would send API calls
 * cross-origin instead of same-origin. The wizard's own version just
 * used window.location.origin, which is same-origin everywhere and
 * happens to produce the exact same result as the dashboard's version
 * on every hostname this page is actually served from in production
 * (window.HARVEY_API_BASE is never set on rider-dashboard.html, so
 * both reduce to "the current origin" there). This shared helper keeps
 * the wizard's safer, universally-correct form.
 */
window.resolveHarveyApiBase = function resolveHarveyApiBase() {
  return window.HARVEY_API_BASE ||
    window.location.origin ||
    "https://harveytaxiservice.com";
};
