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
   RIDER AUTH / STATUS / PROFILE
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

export async function getRiderStatus({ riderId, email, phone } = {}) {
  const params = new URLSearchParams();

  if (riderId) params.set("rider_id", riderId);
  if (email) params.set("email", email);
  if (phone) params.set("phone", phone);

  const query = params.toString() ? `?${params.toString()}` : "";

  return request(`/api/rider-status${query}`, {
    method: "GET"
  });
}

export async function getRiderVerificationStatus(riderId) {
  return getRiderStatus({ riderId });
}

export async function getRiderById(riderId) {
  return request(`/api/riders/${encodeURIComponent(riderId)}`, {
    method: "GET"
  });
}

export async function updateRiderProfile(riderId, payload) {
  return request(`/api/riders/${encodeURIComponent(riderId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function updateRiderPassword(riderId, payload) {
  return request(`/api/riders/${encodeURIComponent(riderId)}/update-password`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function canRiderRequestRide(riderId) {
  return request(
    `/api/riders/${encodeURIComponent(riderId)}/can-request-ride`,
    {
      method: "GET"
    }
  );
}

export async function startRiderVerification(riderId) {
  return request(
    `/api/riders/${encodeURIComponent(riderId)}/start-verification`,
    {
      method: "POST"
    }
  );
}

export async function refreshRiderVerification(riderId) {
  return request(
    `/api/riders/${encodeURIComponent(riderId)}/refresh-verification`,
    {
      method: "POST"
    }
  );
}

export async function getRiderRides(riderId) {
  return request(`/api/riders/${encodeURIComponent(riderId)}/rides`, {
    method: "GET"
  });
}

export async function getRiderDashboard(riderId) {
  return request(`/api/riders/${encodeURIComponent(riderId)}/dashboard`, {
    method: "GET"
  });
}

export async function getRiderPayments(riderId) {
  return request(`/api/riders/${encodeURIComponent(riderId)}/payments`, {
    method: "GET"
  });
}

/* =========================================================
   DRIVER AUTH / STATUS / PROFILE
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

export async function getDriverStatus({ driverId, email, phone } = {}) {
  const params = new URLSearchParams();

  if (driverId) params.set("driver_id", driverId);
  if (email) params.set("email", email);
  if (phone) params.set("phone", phone);

  const query = params.toString() ? `?${params.toString()}` : "";

  return request(`/api/driver-status${query}`, {
    method: "GET"
  });
}

export async function getDriverVerificationStatus(driverId) {
  return getDriverStatus({ driverId });
}

export async function getDriverById(driverId) {
  return request(`/api/drivers/${encodeURIComponent(driverId)}`, {
    method: "GET"
  });
}

export async function updateDriverProfile(driverId, payload) {
  return request(`/api/drivers/${encodeURIComponent(driverId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function updateDriverPassword(driverId, payload) {
  return request(`/api/drivers/${encodeURIComponent(driverId)}/update-password`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function startDriverVerification(driverId) {
  return request(
    `/api/drivers/${encodeURIComponent(driverId)}/start-verification`,
    {
      method: "POST"
    }
  );
}

export async function refreshDriverVerification(driverId) {
  return request(
    `/api/drivers/${encodeURIComponent(driverId)}/refresh-verification`,
    {
      method: "POST"
    }
  );
}

export async function sendDriverEmailCode(driverId) {
  return request("/api/driver/send-email-code", {
    method: "POST",
    body: JSON.stringify({
      driver_id: driverId
    })
  });
}

export async function verifyDriverEmail(driverId, code) {
  return request("/api/driver/verify-email", {
    method: "POST",
    body: JSON.stringify({
      driver_id: driverId,
      code
    })
  });
}

export async function sendDriverSmsCode(driverId) {
  return request("/api/driver/send-sms-code", {
    method: "POST",
    body: JSON.stringify({
      driver_id: driverId
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

export async function setDriverStatus(driverId, status) {
  return request(`/api/drivers/${encodeURIComponent(driverId)}/set-status`, {
    method: "POST",
    body: JSON.stringify({
      status
    })
  });
}

export async function updateDriverAvailability(driverId, available) {
  return setDriverStatus(driverId, available ? "available" : "offline");
}

export async function canDriverReceiveDispatch(driverId) {
  return request(
    `/api/drivers/${encodeURIComponent(driverId)}/can-receive-dispatch`,
    {
      method: "GET"
    }
  );
}

export async function getAvailableDrivers(requestedMode = "human") {
  return request(
    `/api/drivers/available/list?requestedMode=${encodeURIComponent(requestedMode)}`,
    {
      method: "GET"
    }
  );
}

export async function getDriverCurrentMission(driverId) {
  return request(`/api/drivers/${encodeURIComponent(driverId)}/current-mission`, {
    method: "GET"
  });
}

export async function getDriverMissions(driverId) {
  return request(`/api/drivers/${encodeURIComponent(driverId)}/missions`, {
    method: "GET"
  });
}

export async function getDriverEarnings(driverId) {
  return request(`/api/drivers/${encodeURIComponent(driverId)}/earnings`, {
    method: "GET"
  });
}

export async function getDriverTips(driverId) {
  return request(`/api/drivers/${encodeURIComponent(driverId)}/tips`, {
    method: "GET"
  });
}

export async function getDriverDashboard(driverId) {
  return request(`/api/drivers/${encodeURIComponent(driverId)}/dashboard`, {
    method: "GET"
  });
}

/* =========================================================
   FARE / PAYMENTS / RIDES
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

export async function getRideDispatchStatus(rideId) {
  return request(`/api/rides/${encodeURIComponent(rideId)}/dispatch-status`, {
    method: "GET"
  });
}

export async function getRideLiveStatus(rideId) {
  return getRideDispatchStatus(rideId);
}

export async function dispatchRide(rideId) {
  return request(`/api/rides/${encodeURIComponent(rideId)}/dispatch`, {
    method: "POST"
  });
}

export async function cancelRide(rideId, reason = "cancelled_by_user") {
  return request(`/api/rides/${encodeURIComponent(rideId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}

export async function addRideTip(
  rideId,
  amount,
  source = "post_trip"
) {
  return request(`/api/rides/${encodeURIComponent(rideId)}/tip`, {
    method: "POST",
    body: JSON.stringify({
      amount,
      source
    })
  });
}

export async function linkLatestPaymentToRide(rideId) {
  return request(`/api/rides/${encodeURIComponent(rideId)}/link-latest-payment`, {
    method: "POST"
  });
}

/* =========================================================
   PAYMENTS
========================================================= */

export async function capturePayment(paymentId) {
  return request(`/api/payments/${encodeURIComponent(paymentId)}/capture`, {
    method: "POST"
  });
}

export async function releasePayment(paymentId) {
  return request(`/api/payments/${encodeURIComponent(paymentId)}/release`, {
    method: "POST"
  });
}

/* =========================================================
   DISPATCH ACTIONS
========================================================= */

export async function acceptDispatch(dispatchId, driverId = null) {
  return request(`/api/dispatches/${encodeURIComponent(dispatchId)}/accept`, {
    method: "POST",
    body: JSON.stringify(
      driverId
        ? {
            driver_id: driverId
          }
        : {}
    )
  });
}

export async function declineDispatch(
  dispatchId,
  reason = "declined_by_driver"
) {
  return request(`/api/dispatches/${encodeURIComponent(dispatchId)}/decline`, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}

/* =========================================================
   MISSION / TRIP LIFECYCLE
========================================================= */

export async function markDriverEnroute(missionId) {
  return request(`/api/missions/${encodeURIComponent(missionId)}/en-route`, {
    method: "POST"
  });
}

export async function markDriverArrived(missionId) {
  return request(`/api/missions/${encodeURIComponent(missionId)}/arrived`, {
    method: "POST"
  });
}

export async function startTrip(missionId) {
  return request(`/api/missions/${encodeURIComponent(missionId)}/start`, {
    method: "POST"
  });
}

export async function completeTrip(missionId) {
  return request(`/api/missions/${encodeURIComponent(missionId)}/complete`, {
    method: "POST"
  });
}

export async function getRideTimeline(rideId) {
  return request(`/api/rides/${encodeURIComponent(rideId)}/timeline`, {
    method: "GET"
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
      page: payload?.page || payload?.pageContext || "general",
      rider_id: payload?.riderId || payload?.rider_id || null,
      driver_id: payload?.driverId || payload?.driver_id || null,
      ride_id: payload?.rideId || payload?.ride_id || null
    })
  });
}

/* =========================================================
   ADMIN
========================================================= */

function buildAdminHeaders(adminEmail, adminPassword) {
  const headers = {};

  if (adminEmail) {
    headers["x-admin-email"] = adminEmail;
  }

  if (adminPassword) {
    headers["x-admin-password"] = adminPassword;
  }

  return headers;
}

export async function getAdminAnalyticsOverview(adminEmail, adminPassword) {
  return request("/api/admin/analytics/overview", {
    method: "GET",
    headers: buildAdminHeaders(adminEmail, adminPassword)
  });
}

export async function getAdminLogs(adminEmail, adminPassword, limit = 100) {
  return request(`/api/admin/logs?limit=${encodeURIComponent(String(limit))}`, {
    method: "GET",
    headers: buildAdminHeaders(adminEmail, adminPassword)
  });
}

export async function getAdminTripEvents(adminEmail, adminPassword, limit = 100) {
  return request(
    `/api/admin/trip-events?limit=${encodeURIComponent(String(limit))}`,
    {
      method: "GET",
      headers: buildAdminHeaders(adminEmail, adminPassword)
    }
  );
}

export async function approveRider(riderId, adminEmail, adminPassword) {
  return request(`/api/admin/riders/${encodeURIComponent(riderId)}/approve`, {
    method: "POST",
    headers: buildAdminHeaders(adminEmail, adminPassword)
  });
}

export async function rejectRider(
  riderId,
  reason,
  adminEmail,
  adminPassword
) {
  return request(`/api/admin/riders/${encodeURIComponent(riderId)}/reject`, {
    method: "POST",
    headers: buildAdminHeaders(adminEmail, adminPassword),
    body: JSON.stringify({
      reason: reason || "Verification rejected."
    })
  });
}

export async function approveDriver(driverId, adminEmail, adminPassword) {
  return request(`/api/admin/drivers/${encodeURIComponent(driverId)}/approve`, {
    method: "POST",
    headers: buildAdminHeaders(adminEmail, adminPassword)
  });
}

export async function rejectDriver(
  driverId,
  reason,
  adminEmail,
  adminPassword
) {
  return request(`/api/admin/drivers/${encodeURIComponent(driverId)}/reject`, {
    method: "POST",
    headers: buildAdminHeaders(adminEmail, adminPassword),
    body: JSON.stringify({
      reason: reason || "Driver rejected."
    })
  });
}

export async function adminSetRiderPersonaDecision(
  riderId,
  personaStatus,
  inquiryId,
  adminEmail,
  adminPassword
) {
  return request(
    `/api/admin/riders/${encodeURIComponent(riderId)}/persona-decision`,
    {
      method: "POST",
      headers: buildAdminHeaders(adminEmail, adminPassword),
      body: JSON.stringify({
        persona_status: personaStatus,
        inquiry_id: inquiryId || null
      })
    }
  );
}

export async function adminSetDriverPersonaDecision(
  driverId,
  personaStatus,
  inquiryId,
  adminEmail,
  adminPassword
) {
  return request(
    `/api/admin/drivers/${encodeURIComponent(driverId)}/persona-decision`,
    {
      method: "POST",
      headers: buildAdminHeaders(adminEmail, adminPassword),
      body: JSON.stringify({
        persona_status: personaStatus,
        inquiry_id: inquiryId || null
      })
    }
  );
}
