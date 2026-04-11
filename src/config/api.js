import { Platform } from "react-native";

const FALLBACK_RENDER_URL = "https://harvey-taxi-app-2.onrender.com";

function normalizeBaseUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function getBaseUrl() {
  const configured =
    process.env.EXPO_PUBLIC_API_BASE_URL ||
    process.env.EXPO_PUBLIC_BACKEND_URL ||
    "";

  if (configured) {
    return normalizeBaseUrl(configured);
  }

  if (__DEV__) {
    if (Platform.OS === "android") {
      return normalizeBaseUrl("http://10.0.2.2:10000");
    }

    return normalizeBaseUrl(FALLBACK_RENDER_URL);
  }

  return normalizeBaseUrl(FALLBACK_RENDER_URL);
}

export const API_BASE_URL = getBaseUrl();

async function parseJsonSafely(response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {
      ok: false,
      message: text || "Server returned a non-JSON response."
    };
  }
}

async function request(path, options = {}) {
  const url = `${API_BASE_URL}${path}`;

  let response;
  try {
    response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });
  } catch {
    throw new Error(
      `Network request failed. Check API base URL and backend health. Base URL: ${API_BASE_URL}`
    );
  }

  const data = await parseJsonSafely(response);

  if (!response.ok) {
    throw new Error(
      data?.error ||
        data?.message ||
        `Request failed with status ${response.status}.`
    );
  }

  return data;
}

/* =========================================================
   HEALTH
========================================================= */

export async function healthCheck() {
  return request("/api/health", {
    method: "GET"
  });
}

/* =========================================================
   RIDER AUTH / VERIFICATION
========================================================= */

export async function riderSignup(payload) {
  return request("/api/rider/signup", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function riderLogin(payload) {
  return request("/api/rider/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getRiderVerificationStatus(riderId) {
  return request(
    `/api/rider/${encodeURIComponent(riderId)}/verification-status`,
    {
      method: "GET"
    }
  );
}

export async function startRiderVerification(riderId) {
  return request(
    `/api/rider/${encodeURIComponent(riderId)}/start-verification`,
    {
      method: "POST"
    }
  );
}

/* =========================================================
   DRIVER AUTH / VERIFICATION
========================================================= */

export async function driverSignup(payload) {
  return request("/api/driver/signup", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function driverLogin(payload) {
  return request("/api/driver/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getDriverVerificationStatus(driverId) {
  return request(
    `/api/driver/${encodeURIComponent(driverId)}/verification-status`,
    {
      method: "GET"
    }
  );
}

export async function verifyDriverEmail(driverId, token) {
  return request("/api/driver/verify-email", {
    method: "POST",
    body: JSON.stringify({
      driver_id: driverId,
      token
    })
  });
}

export async function verifyDriverSmsCode(driverId, code) {
  return request("/api/driver/verify-sms", {
    method: "POST",
    body: JSON.stringify({
      driver_id: driverId,
      code
    })
  });
}

export async function resendDriverEmailVerification(driverId) {
  return request(
    `/api/driver/${encodeURIComponent(driverId)}/resend-email-verification`,
    {
      method: "POST"
    }
  );
}

export async function resendDriverSmsVerification(driverId) {
  return request(
    `/api/driver/${encodeURIComponent(driverId)}/resend-sms-verification`,
    {
      method: "POST"
    }
  );
}

/* =========================================================
   RIDER DATA
========================================================= */

export async function getRiderById(riderId) {
  return request(`/api/riders/${encodeURIComponent(riderId)}`, {
    method: "GET"
  });
}

export async function getRiderRides(riderId) {
  return request(`/api/rider/${encodeURIComponent(riderId)}/rides`, {
    method: "GET"
  });
}

export async function getRiderReceipts(riderId) {
  return request(`/api/rider/${encodeURIComponent(riderId)}/receipts`, {
    method: "GET"
  });
}

/* =========================================================
   DRIVER DATA
========================================================= */

export async function getDriverById(driverId) {
  return request(`/api/drivers/${encodeURIComponent(driverId)}`, {
    method: "GET"
  });
}

export async function getDriverCurrentRide(driverId) {
  return request(`/api/driver/${encodeURIComponent(driverId)}/current-ride`, {
    method: "GET"
  });
}

export async function getDriverMissions(driverId) {
  return request(`/api/driver/${encodeURIComponent(driverId)}/missions`, {
    method: "GET"
  });
}

export async function updateDriverAvailability(driverId, available) {
  return request(`/api/driver/${encodeURIComponent(driverId)}/availability`, {
    method: "POST",
    body: JSON.stringify({
      is_available: available,
      availability_status: available ? "available" : "offline"
    })
  });
}

export async function updateDriverLocation(driverId, latitude, longitude) {
  return request(`/api/driver/${encodeURIComponent(driverId)}/location`, {
    method: "POST",
    body: JSON.stringify({
      latitude,
      longitude
    })
  });
}

export async function getDriverEarnings(driverId) {
  return request(`/api/driver/${encodeURIComponent(driverId)}/earnings`, {
    method: "GET"
  });
}

export async function getDriverPayouts(driverId) {
  return request(`/api/driver/${encodeURIComponent(driverId)}/payouts`, {
    method: "GET"
  });
}

/* =========================================================
   RIDES / PAYMENTS / DISPATCH
========================================================= */

export async function getFareEstimate(payload) {
  return request("/api/fare-estimate", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function authorizePayment(payload) {
  return request("/api/payments/authorize", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function requestRide(payload) {
  return request("/api/request-ride", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getRideById(rideId) {
  return request(`/api/rides/${encodeURIComponent(rideId)}`, {
    method: "GET"
  });
}

export async function getRideLiveStatus(rideId) {
  return request(`/api/rides/${encodeURIComponent(rideId)}/live-status`, {
    method: "GET"
  });
}

export async function dispatchRide(rideId) {
  return request(`/api/rides/${encodeURIComponent(rideId)}/dispatch`, {
    method: "POST"
  });
}

export async function retryRideDispatch(rideId) {
  return request(`/api/rides/${encodeURIComponent(rideId)}/dispatch/retry`, {
    method: "POST"
  });
}

export async function markDriverEnroute(rideId) {
  return request(`/api/rides/${encodeURIComponent(rideId)}/driver-enroute`, {
    method: "POST"
  });
}

export async function markDriverArrived(rideId) {
  return request(`/api/rides/${encodeURIComponent(rideId)}/driver-arrived`, {
    method: "POST"
  });
}

export async function startTrip(rideId) {
  return request(`/api/rides/${encodeURIComponent(rideId)}/start`, {
    method: "POST"
  });
}

export async function completeTrip(rideId) {
  return request(`/api/rides/${encodeURIComponent(rideId)}/complete`, {
    method: "POST"
  });
}

export async function cancelRide(rideId, reason = "cancelled_by_user") {
  return request(`/api/rides/${encodeURIComponent(rideId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}

export async function addRideTip(rideId, amount, note = "Tip added by rider") {
  return request(`/api/rides/${encodeURIComponent(rideId)}/tip`, {
    method: "POST",
    body: JSON.stringify({
      amount,
      note
    })
  });
}

export async function getRideReceipt(rideId) {
  return request(`/api/rides/${encodeURIComponent(rideId)}/receipt`, {
    method: "GET"
  });
}

export async function captureRidePayment(rideId) {
  return request(`/api/rides/${encodeURIComponent(rideId)}/capture-payment`, {
    method: "POST"
  });
}

export async function releaseRidePayment(rideId) {
  return request(`/api/rides/${encodeURIComponent(rideId)}/release-payment`, {
    method: "POST"
  });
}

/* =========================================================
   DRIVER DISPATCH ACTIONS
========================================================= */

export async function acceptDispatch(dispatchId) {
  return request(`/api/dispatch/${encodeURIComponent(dispatchId)}/accept`, {
    method: "POST"
  });
}

export async function declineDispatch(dispatchId, reason = "declined_by_driver") {
  return request(`/api/dispatch/${encodeURIComponent(dispatchId)}/decline`, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}

/* =========================================================
   SUPPORT / INCIDENTS / SAFETY
========================================================= */

export async function createSupportCase(payload) {
  return request("/api/support/cases", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getSupportCases(status = "") {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return request(`/api/support/cases${query}`, {
    method: "GET"
  });
}

export async function reportIncident(payload) {
  return request("/api/incidents/report", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getIncidents(filters = {}) {
  const params = new URLSearchParams();

  if (filters.status) {
    params.set("status", filters.status);
  }

  if (filters.severity) {
    params.set("severity", filters.severity);
  }

  const query = params.toString() ? `?${params.toString()}` : "";

  return request(`/api/incidents${query}`, {
    method: "GET"
  });
}

export async function triggerRideEmergency(rideId, payload = {}) {
  return request(`/api/rides/${encodeURIComponent(rideId)}/emergency`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

/* =========================================================
   HARVEY AI
========================================================= */

export async function askHarveyAI(payload) {
  return request("/api/ai/support", {
    method: "POST",
    body: JSON.stringify({
      message: payload?.message || "",
      pageContext: payload?.pageContext || "homepage",
      rider_id: payload?.riderId || null,
      driver_id: payload?.driverId || null,
      ride_id: payload?.rideId || null
    })
  });
}

/* =========================================================
   ADMIN
========================================================= */

export async function getAdminAnalyticsOverview(adminApiKey) {
  return request("/api/admin/analytics/overview", {
    method: "GET",
    headers: adminApiKey
      ? {
          "x-admin-api-key": adminApiKey
        }
      : {}
  });
}

export async function getAdminAnalyticsLive(adminApiKey) {
  return request("/api/admin/analytics/live", {
    method: "GET",
    headers: adminApiKey
      ? {
          "x-admin-api-key": adminApiKey
        }
      : {}
  });
}

export async function getOpenAdminDispatches(adminApiKey) {
  return request("/api/admin/dispatches/open", {
    method: "GET",
    headers: adminApiKey
      ? {
          "x-admin-api-key": adminApiKey
        }
      : {}
  });
}

export async function getSearchingAdminRides(adminApiKey) {
  return request("/api/admin/rides/searching", {
    method: "GET",
    headers: adminApiKey
      ? {
          "x-admin-api-key": adminApiKey
        }
      : {}
  });
}

export async function adminAssignDriverToRide(rideId, driverId, adminApiKey) {
  return request(`/api/admin/rides/${encodeURIComponent(rideId)}/assign-driver`, {
    method: "POST",
    headers: adminApiKey
      ? {
          "x-admin-api-key": adminApiKey
        }
      : {},
    body: JSON.stringify({
      driver_id: driverId
    })
  });
}

export async function adminRedispatchRide(rideId, adminApiKey) {
  return request(`/api/admin/rides/${encodeURIComponent(rideId)}/redispatch`, {
    method: "POST",
    headers: adminApiKey
      ? {
          "x-admin-api-key": adminApiKey
        }
      : {}
  });
}

export async function adminForceCompleteRide(rideId, adminApiKey) {
  return request(`/api/admin/rides/${encodeURIComponent(rideId)}/force-complete`, {
    method: "POST",
    headers: adminApiKey
      ? {
          "x-admin-api-key": adminApiKey
        }
      : {}
  });
}

export async function adminForceCancelRide(rideId, reason, adminApiKey) {
  return request(`/api/admin/rides/${encodeURIComponent(rideId)}/force-cancel`, {
    method: "POST",
    headers: adminApiKey
      ? {
          "x-admin-api-key": adminApiKey
        }
      : {},
    body: JSON.stringify({
      reason: reason || "admin_cancelled"
    })
  });
}

export async function adminMarkPayoutPaid(payoutId, adminApiKey) {
  return request(`/api/admin/payouts/${encodeURIComponent(payoutId)}/mark-paid`, {
    method: "POST",
    headers: adminApiKey
      ? {
          "x-admin-api-key": adminApiKey
        }
      : {}
  });
}

export async function askAdminHarveyAI(message, adminApiKey) {
  return request("/api/admin/ai/operations", {
    method: "POST",
    headers: adminApiKey
      ? {
          "x-admin-api-key": adminApiKey
        }
      : {},
    body: JSON.stringify({
      message
    })
  });
}
