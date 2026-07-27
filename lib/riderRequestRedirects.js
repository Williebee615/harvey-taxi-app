// Pure logic for the legacy rider-request redirects — request-ride.html,
// request-food.html, and request-groceries.html were deleted (their
// functionality moved into rider-dashboard.html's wizard overlay), but
// old bookmarks, push notifications, and search-engine links to those
// paths must keep working. This module is the single source of truth
// for what each legacy path redirects to, so server.js's route
// registration and this file's regression tests both consume the same
// logic instead of the redirect targets being duplicated/hand-typed
// in two places.

// mode: null means "don't force a mode, just forward whatever query
// string was already present" (request-ride's own behavior, since a
// mode is usually already in the URL, e.g. ?mode=driver). A non-null
// mode means "force this mode regardless of what was in the query
// string" (request-food/request-groceries' behavior).
const LEGACY_RIDER_REQUEST_ROUTES = [
  { path: "/request-ride", mode: null },
  { path: "/request-ride.html", mode: null },
  { path: "/request-food", mode: "food" },
  { path: "/request-food.html", mode: "food" },
  { path: "/request-groceries", mode: "grocery" },
  { path: "/request-groceries.html", mode: "grocery" }
];

function buildLegacyRedirectTarget(mode, query) {
  const params = new URLSearchParams(query || {});

  if (mode) {
    params.set("mode", mode);
  }

  const qs = params.toString();

  return `/rider-dashboard.html${qs ? `?${qs}` : ""}`;
}

module.exports = {
  LEGACY_RIDER_REQUEST_ROUTES,
  buildLegacyRedirectTarget
};
