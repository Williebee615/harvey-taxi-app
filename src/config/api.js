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
      error: text || "Server returned a non-JSON response."
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
  } catch (error) {
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

export async function getPublicConfig() {
  return request("/api/config/public", {
    method: "GET"
  });
}

/* =========================================================
   RIDERS
========================================================= */

export async function riderSignup(payload) {
  return request("/api/rider/signup", {
    method: "POST",
    body: JSON.stringify({
      first_name: payload?.first_name || payload?.firstName || "",
      last_name: payload?.last_name || payload?.lastName || "",
      email: payload?.email || "",
      phone: payload?.phone || ""
    })
  });
}

export async function getRiderStatus({ riderId, email, phone } = {}) {
  return request("/api/rider/status", {
    method: "POST",
    body: JSON.stringify({
      rider_id: riderId || null,
      email: email || null,
      phone: phone || null
    })
  });
}

export async function getRiderVerificationStatus(riderId) {
  return request(`/api/rider/${encodeURIComponent(riderId)}/status`, {
    method: "GET"
  });
}

/* =========================================================
   DRIVERS
========================================================= */

export async function driverSignup(payload) {
  return request("/api/driver/signup", {
    method: "POST",
    body: JSON.stringify({
      first_name: payload?.first_name || payload?.firstName || "",
      last_name: payload?.last_name || payload?.lastName || "",
      email: payload?.email || "",
      phone: payload?.phone || "",
      driver_type: payload?.driver_type || payload?.driverType || "human"
    })
  });
}

export async function getDriverStatus({ driverId, email, phone } = {}) {
  return request("/api/driver/status", {
    method: "POST",
    body: JSON.stringify({
      driver_id: driverId || null,
      email: email || null,
      phone: phone || null
    })
  });
}

export async function goDriverOnline({ driverId, email, phone } = {}) {
  return request("/api/driver/go-online", {
    method: "POST",
    body: JSON.stringify({
      driver_id: driverId || null,
      email: email || null,
      phone: phone || null
    })
  });
}

export async function goDriverOffline({ driverId, email, phone } = {}) {
  return request("/api/driver/go-offline", {
    method: "POST",
    body: JSON.stringify({
      driver_id: driverId || null,
      email: email || null,
      phone: phone || null
    })
  });
}

export async function updateDriverLocation({
  driverId,
  email,
  phone,
  latitude,
  longitude
}) {
  return request("/api/driver/location", {
    method: "POST",
    body: JSON.stringify({
      driver_id: driverId || null,
      email: email || null,
      phone: phone || null,
      latitude,
      longitude
    })
  });
}

export async function getDriverCurrentRide(driverId) {
  return request(`/api/driver/${encodeURIComponent(driverId)}/current-ride`, {
    method: "GET"
  });
}

export async function getDriverEarnings(driverId) {
  return request(`/api/driver/${encodeURIComponent(driverId)}/earnings`, {
    method: "GET"
  });
}

/* =========================================================
   FARE / PAYMENTS / RIDES
========================================================= */

export async function getFareEstimate(payload) {
  return request("/api/fare-estimate", {
    method: "POST",
    body: JSON.stringify({
      pickup_address: payload?.pickup_address || payload?.pickupAddress || "",
      dropoff_address: payload?.dropoff_address || payload?.dropoffAddress || "",
      pickup_latitude: payload?.pickup_latitude ?? payload?.pickupLatitude ?? null,
      pickup_longitude: payload?.pickup_longitude ?? payload?.pickupLongitude ?? null,
      dropoff_latitude: payload?.dropoff_latitude ?? payload?.dropoffLatitude ?? null,
      dropoff_longitude: payload?.dropoff_longitude ?? payload?.dropoffLongitude ?? null,
      ride_type: payload?.ride_type || payload?.rideType || "standard",
      requested_mode: payload?.requested_mode || payload?.requestedMode || "driver"
    })
  });
}

export async function authorizePayment(payload) {
  return request("/api/payments/authorize", {
    method: "POST",
    body: JSON.stringify({
      rider_id: payload?.rider_id || payload?.riderId || null,
      email: payload?.email || null,
      phone: payload?.phone || null,
      amount: payload?.amount ?? payload?.estimated_total ?? 0,
      estimated_total: payload?.estimated_total ?? payload?.amount ?? 0
    })
  });
}

export async function requestRide(payload) {
  return request("/api/request-ride", {
    method: "POST",
    body: JSON.stringify({
      rider_id: payload?.rider_id || payload?.riderId || null,
      email: payload?.email || null,
      phone: payload?.phone || null,
      pickup_address: payload?.pickup_address || payload?.pickupAddress || "",
      dropoff_address: payload?.dropoff_address || payload?.dropoffAddress || "",
      pickup_latitude: payload?.pickup_latitude ?? payload?.pickupLatitude ?? null,
      pickup_longitude: payload?.pickup_longitude ?? payload?.pickupLongitude ?? null,
      dropoff_latitude: payload?.dropoff_latitude ?? payload?.dropoffLatitude ?? null,
      dropoff_longitude: payload?.dropoff_longitude ?? payload?.dropoffLongitude ?? null,
      requested_mode: payload?.requested_mode || payload?.requestedMode || "driver",
      ride_type: payload?.ride_type || payload?.rideType || "standard",
      notes: payload?.notes || "",
      scheduled_at: payload?.scheduled_at || payload?.scheduledAt || null
    })
  });
}

export async function getRideLiveState(rideId) {
  return request(`/api/rides/${encodeURIComponent(rideId)}/live`, {
    method: "GET"
  });
}

export async function startDispatch(rideId) {
  return request("/api/dispatch/start", {
    method: "POST",
    body: JSON.stringify({
      ride_id: rideId
    })
  });
}

export async function addRideTip(rideId, tipAmount) {
  return request(`/api/rides/${encodeURIComponent(rideId)}/tip`, {
    method: "POST",
    body: JSON.stringify({
      tip_amount: tipAmount
    })
  });
}

/* =========================================================
   PAYMENTS
========================================================= */

export async function capturePaymentByRide({
  rideId,
  amount,
  tipAmount = 0
}) {
  return request("/api/payments/capture", {
    method: "POST",
    body: JSON.stringify({
      ride_id: rideId,
      amount,
      tip_amount: tipAmount
    })
  });
}

export async function releasePayment({ rideId, paymentId }) {
  return request("/api/payments/release", {
    method: "POST",
    body: JSON.stringify({
      ride_id: rideId || null,
      payment_id: paymentId || null
    })
  });
}

/* =========================================================
   DISPATCH / MISSION ACTIONS
========================================================= */

export async function acceptMission({
  driverId,
  dispatchId = null,
  missionId = null,
  email = null,
  phone = null
}) {
  return request("/api/mission/accept", {
    method: "POST",
    body: JSON.stringify({
      driver_id: driverId || null,
      dispatch_id: dispatchId,
      mission_id: missionId,
      email,
      phone
    })
  });
}

export async function declineMission({
  driverId,
  dispatchId = null,
  missionId = null,
  reason = "declined_by_driver",
  email = null,
  phone = null
}) {
  return request("/api/mission/decline", {
    method: "POST",
    body: JSON.stringify({
      driver_id: driverId || null,
      dispatch_id: dispatchId,
      mission_id: missionId,
      reason,
      email,
      phone
    })
  });
}

export async function markDriverEnroute(missionId) {
  return request("/api/mission/en-route", {
    method: "POST",
    body: JSON.stringify({
      mission_id: missionId
    })
  });
}

export async function markDriverArrived(missionId) {
  return request("/api/mission/arrived", {
    method: "POST",
    body: JSON.stringify({
      mission_id: missionId
    })
  });
}

export async function startTrip(missionId) {
  return request("/api/mission/start-trip", {
    method: "POST",
    body: JSON.stringify({
      mission_id: missionId
    })
  });
}

export async function completeTrip(missionId) {
  return request("/api/mission/complete", {
    method: "POST",
    body: JSON.stringify({
      mission_id: missionId
    })
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

export async function getAdminHealthDeep(adminEmail, adminPassword) {
  return request("/api/admin/health/deep", {
    method: "GET",
    headers: buildAdminHeaders(adminEmail, adminPassword)
  });
}

export async function getAdminAnalyticsOverview(adminEmail, adminPassword) {
  return request("/api/admin/analytics/overview", {
    method: "GET",
    headers: buildAdminHeaders(adminEmail, adminPassword)
  });
}

export async function getAdminAiOperations(adminEmail, adminPassword) {
  return request("/api/admin/ai/operations", {
    method: "GET",
    headers: buildAdminHeaders(adminEmail, adminPassword)
  });
}

export async function approveRider(riderId, adminEmail, adminPassword) {
  return request("/api/admin/rider/approve", {
    method: "POST",
    headers: buildAdminHeaders(adminEmail, adminPassword),
    body: JSON.stringify({
      rider_id: riderId
    })
  });
}

export async function approveDriver(driverId, adminEmail, adminPassword) {
  return request("/api/admin/driver/approve", {
    method: "POST",
    headers: buildAdminHeaders(adminEmail, adminPassword),
    body: JSON.stringify({
      driver_id: driverId
    })
  });
}

export async function verifyDriverContact(driverId, adminEmail, adminPassword) {
  return request("/api/admin/driver/verify-contact", {
    method: "POST",
    headers: buildAdminHeaders(adminEmail, adminPassword),
    body: JSON.stringify({
      driver_id: driverId
    })
  });
}

/* =========================================================
   FAQ
========================================================= */

export async function getSupportFaq() {
  return request("/api/support/faq", {
    method: "GET"
  });
}
