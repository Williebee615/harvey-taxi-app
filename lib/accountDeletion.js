// Account-deletion decisions, kept pure so they can be unit tested.
// server.js supplies a freshly loaded database row; nothing here ever
// trusts a client-supplied id or flag.

const DELETION_STATUS = Object.freeze({
  PENDING: "pending",
  COMPLETED: "completed",
  REJECTED: "rejected",
  REVIEW_SIMULATED: "review_simulated"
});

const DELETION_MODE = Object.freeze({
  REVIEW_SIMULATED: "review_simulated",
  RIDER_IMMEDIATE: "rider_immediate",
  DRIVER_PENDING: "driver_pending"
});

const REVIEW_DELETION_MESSAGE =
  "App Review mode: your account deletion request was received and recorded. " +
  "This designated review account is preserved so review can continue; no data was removed.";

// Designated App Review accounts (is_review_account === true on the
// stored row) never lose data: the request is recorded and confirmed,
// but the account is kept. Everyone else gets the real flow.
function planAccountDeletion({ row, userType }) {
  if (row && row.is_review_account === true) {
    return { mode: DELETION_MODE.REVIEW_SIMULATED };
  }
  return {
    mode: userType === "driver" ? DELETION_MODE.DRIVER_PENDING : DELETION_MODE.RIDER_IMMEDIATE
  };
}

// The SMS path resolves the account from the verified phone number, so
// exactly one match is required: none means no account, several means
// the number can't identify one account safely.
function resolveAccountByVerifiedPhone(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) {
    return { ok: false, statusCode: 404, message: "No account was found for that phone number." };
  }
  if (list.length > 1) {
    return {
      ok: false,
      statusCode: 409,
      message: "More than one account uses this phone number. Please contact support to delete your account."
    };
  }
  return { ok: true, row: list[0] };
}

function isDeletionConfirmed(value) {
  return typeof value === "string" && value.trim().toUpperCase() === "DELETE";
}

module.exports = {
  DELETION_STATUS,
  DELETION_MODE,
  REVIEW_DELETION_MESSAGE,
  planAccountDeletion,
  resolveAccountByVerifiedPhone,
  isDeletionConfirmed
};
