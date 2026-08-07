const HTAF_PENDING_REVIEW_STATUSES = new Set(["submitted", "under_review", "pending_documents"]);

function computeHtafPublicStats(statuses) {
  const list = Array.isArray(statuses) ? statuses : [];
  let pendingReview = 0;
  let approved = 0;
  let scheduled = 0;
  for (const status of list) {
    if (HTAF_PENDING_REVIEW_STATUSES.has(status)) pendingReview++;
    else if (status === "approved") approved++;
    else if (status === "scheduled") scheduled++;
  }
  return {
    applications_submitted: list.length,
    pending_review: pendingReview,
    approved_requests: approved,
    scheduled_rides: scheduled
  };
}

function resolveCreateRideOutcome(rpcResult) {
  switch (rpcResult && rpcResult.outcome) {
    case "created":
      return { statusCode: 201, created: true, ride: rpcResult.ride };
    case "existing":
      return { statusCode: 200, created: false, ride: rpcResult.ride };
    case "not_found":
      return { statusCode: 404, error: "HTAF application not found." };
    case "inconsistent":
      return {
        statusCode: 409,
        error: "This application's ride status is inconsistent and requires manual review.",
        reason: rpcResult.reason
      };
    default:
      return { statusCode: 500, error: "Unexpected response while creating the ride." };
  }
}

// Decides what email (if any) an authenticated rider is allowed to look
// their own HTAF application up by. Deliberately takes ONLY the verified
// session's rider row -- never a request query/body parameter -- so
// there is no code path, present or future, where a client-supplied
// email could stand in for the session's own identity. `extra` exists
// only so callers can be tested against an adversarial payload (e.g. a
// request object with its own `email`/`query.email` bolted on); it is
// always ignored, which is the point of the test coverage below.
function resolveRiderHtafLookup(rider) {
  if (!rider || typeof rider !== "object") {
    return { ok: false, statusCode: 401, error: "Rider authentication required." };
  }
  const email = typeof rider.email === "string" ? rider.email.trim() : "";
  if (!email) {
    // A rider with no email on file cannot have a matching HTAF
    // application by definition -- this is a real "no application"
    // fact, not an auth failure, so it succeeds with a null lookup
    // target rather than erroring.
    return { ok: true, email: null };
  }
  return { ok: true, email };
}

module.exports = {
  HTAF_PENDING_REVIEW_STATUSES,
  computeHtafPublicStats,
  resolveCreateRideOutcome,
  resolveRiderHtafLookup
};
