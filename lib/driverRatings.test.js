const r = require("./driverRatings");

const NOW = Date.parse("2026-10-22T14:00:00Z");

test("validateRating: 1-5 stars, known tags only, comment trimmed", () => {
  expect(r.validateRating({ stars: 5, tags: ["friendly", "friendly", "clean_car"], comment: "  Great   ride " })).toEqual({ ok: true, stars: 5, tags: ["friendly", "clean_car"], comment: "Great ride" });
  expect(r.validateRating({ stars: 0 }).ok).toBe(false);
  expect(r.validateRating({ stars: 4.5 }).ok).toBe(false);
  expect(r.validateRating({ stars: 3, tags: ["made_up"] }).ok).toBe(false);
  expect(r.validateRating({ stars: 3 })).toEqual({ ok: true, stars: 3, tags: [], comment: null });
});

test("eligibility: own completed ride with a driver, within 7 days", () => {
  const ride = { rider_id: "U1", driver_id: "D1", status: "completed", completed_at: "2026-10-20T00:00:00Z" };
  expect(r.ratingEligibility(ride, "U1", { now: NOW }).ok).toBe(true);
  expect(r.ratingEligibility(ride, "U2", { now: NOW }).statusCode).toBe(404);
  expect(r.ratingEligibility({ ...ride, status: "in_progress" }, "U1", { now: NOW }).statusCode).toBe(409);
  expect(r.ratingEligibility({ ...ride, completed_at: "2026-10-10T00:00:00Z" }, "U1", { now: NOW }).statusCode).toBe(409);
});

const rating = (stars, i, over = {}) => ({ stars, counted: true, tags: [], created_at: `2026-10-${String(10 + (i % 10)).padStart(2, "0")}T00:00:${String(i % 60).padStart(2, "0")}Z`, ...over });

test("score: hidden under 5 counted ratings; review rides never count", () => {
  const four = [5, 5, 5, 4].map((s, i) => rating(s, i));
  expect(r.driverScore(four)).toMatchObject({ count: 4, score: null, shown: false, needs_review: false });
  const withReview = [...four, rating(1, 9, { counted: false })];
  expect(r.driverScore(withReview).count).toBe(4);
  expect(r.driverScore([...four, rating(5, 5)])).toMatchObject({ count: 5, score: 4.8, shown: true, needs_review: false });
});

test("score below 4.6 is flagged for staff review only", () => {
  const rows = [5, 4, 4, 4, 5].map((s, i) => rating(s, i, { tags: s === 4 ? ["late"] : [] }));
  expect(r.driverScore(rows)).toMatchObject({ score: 4.4, needs_review: true, tag_counts: { late: 3 } });
});

test("score uses only the latest 100 ratings", () => {
  const old = Array.from({ length: 50 }, (_, i) => ({ stars: 1, counted: true, created_at: `2026-01-01T00:00:${String(i).padStart(2, "0")}Z` }));
  const recent = Array.from({ length: 100 }, (_, i) => ({ stars: 5, counted: true, created_at: `2026-10-01T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z` }));
  expect(r.driverScore([...old, ...recent])).toMatchObject({ count: 100, score: 5 });
});
