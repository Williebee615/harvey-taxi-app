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
   RIDER AUTH
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

/* =========================================================
   DRIVER AUTH
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

/* =========================================================
   RIDER DATA
========================================================= */

export async function getRiderById(riderId) {
  return request(`/api/riders/${encodeURIComponent(riderId)}`, {
    method: "GET"
  });
}

export async function getRiderActiveTrip(riderId) {
  return request(`/api/riders/${encodeURIComponent(riderId)}/active-trip`, {
    method: "GET"
  });
}

export async function getRiderPaymentStatus(riderId) {
  return request(`/api/riders/${encodeURIComponent(riderId)}/payment-status`, {
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

export async function getDriverCurrentMission(driverId) {
  return request(
    `/api/drivers/${encodeURIComponent(driverId)}/current-mission`,
    {
      method: "GET"
    }
  );
}

export async function updateDriverAvailability(driverId, available) {
  return request(`/api/driver/${encodeURIComponent(driverId)}/availability`, {
    method: "PATCH",
    body: JSON.stringify({ available })
  });
}

/* =========================================================
   DRIVER VERIFICATION
========================================================= */

export async function getDriverVerificationStatus(driverId) {
  return request(
    `/api/driver/verification-status/${encodeURIComponent(driverId)}`,
    {
      method: "GET"
    }
  );
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

export async function resendDriverEmailVerification(driverId, email) {
  return request("/api/driver/resend-email-verification", {
    method: "POST",
    body: JSON.stringify({
      driver_id: driverId,
      email
    })
  });
}

export async function resendDriverSmsVerification(driverId, phone) {
  return request("/api/driver/resend-sms-verification", {
    method: "POST",
    body: JSON.stringify({
      driver_id: driverId,
      phone
    })
  });
}

/* =========================================================
   RIDES / PAYMENTS
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

/* =========================================================
   HARVEY AI
========================================================= */

export async function askHarveyAI(payload) {
  return request("/api/ai/chat", {
    method: "POST",
    body: JSON.stringify({
      message: payload?.message || "",
      page: payload?.page || "mobile_app",
      userType: payload?.userType || "general",
      riderId: payload?.riderId || null,
      driverId: payload?.driverId || null,
      history: Array.isArray(payload?.history) ? payload.history : []
    })
  });
}
