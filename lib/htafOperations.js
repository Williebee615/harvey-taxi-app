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

module.exports = {
  HTAF_PENDING_REVIEW_STATUSES,
  computeHtafPublicStats,
  resolveCreateRideOutcome
};
