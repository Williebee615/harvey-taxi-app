// Rider ratings of drivers (owner decisions 2026-10-22: "1-5 stars after
// trip", "Score + staff review"). One rating per completed ride, within 7
// days. A driver's score is the average of their last 100 counted ratings,
// shown once there are 5. A score below 4.6 is flagged for staff to review;
// nothing happens to a driver automatically. Off unless
// driver_ratings_enabled is "true". Pure rules; server.js does the I/O.

const RATINGS_FLAG = "driver_ratings_enabled";
const RATING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SCORE_WINDOW = 100;
const MIN_RATINGS_FOR_SCORE = 5;
const REVIEW_THRESHOLD = 4.6;
const TAGS = Object.freeze({
  safe_driving: "Safe driving",
  clean_car: "Clean car",
  friendly: "Friendly",
  great_route: "Great route",
  late: "Late",
  route_issue: "Route issue",
  unsafe_driving: "Unsafe driving",
  rude: "Rude"
});

const fail = (error, statusCode = 400) => ({ ok: false, error, statusCode });

function validateRating(body = {}) {
  const stars = Number(body.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return fail("Choose 1 to 5 stars.");
  const rawTags = Array.isArray(body.tags) ? body.tags : [];
  const tags = [...new Set(rawTags.map((t) => String(t)))];
  if (tags.some((t) => !Object.prototype.hasOwnProperty.call(TAGS, t))) return fail("Unknown rating tag.");
  const comment = typeof body.comment === "string" ? body.comment.replace(/\s+/g, " ").trim().slice(0, 500) : "";
  return { ok: true, stars, tags, comment: comment || null };
}

function ratingEligibility(ride, riderId, { now = Date.now() } = {}) {
  if (!ride || String(ride.rider_id || "") !== String(riderId || "")) return fail("Ride not found.", 404);
  if (!ride.driver_id) return fail("This ride has no driver to rate.", 409);
  if (ride.status !== "completed") return fail("You can rate your driver once the trip is complete.", 409);
  const done = Date.parse(ride.completed_at || ride.updated_at || "");
  if (Number.isFinite(done) && now - done > RATING_WINDOW_MS) return fail("Ratings can be left up to 7 days after a trip.", 409);
  return { ok: true };
}

// ratings: rows for one driver, any order. Only counted rows are used.
function driverScore(ratings = []) {
  const counted = ratings
    .filter((r) => r.counted)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, SCORE_WINDOW);
  const count = counted.length;
  const shown = count >= MIN_RATINGS_FOR_SCORE;
  const average = count ? Math.round((counted.reduce((s, r) => s + Number(r.stars), 0) / count) * 100) / 100 : null;
  const tagCounts = {};
  for (const r of counted) for (const t of r.tags || []) tagCounts[t] = (tagCounts[t] || 0) + 1;
  return {
    count,
    score: shown ? average : null,
    shown,
    needs_review: shown && average < REVIEW_THRESHOLD,
    tag_counts: tagCounts
  };
}

module.exports = {
  RATINGS_FLAG,
  RATING_WINDOW_MS,
  SCORE_WINDOW,
  MIN_RATINGS_FOR_SCORE,
  REVIEW_THRESHOLD,
  TAGS,
  validateRating,
  ratingEligibility,
  driverScore
};
