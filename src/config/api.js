import { Platform } from "react-native";

const FALLBACK_RENDER_URL = "https://harvey-taxi-app-2.onrender.com";

function normalizeBaseUrl(url) {
  return String(url || "")
    .trim()
    .replace(/\/+$/, "");
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
  } catch (error) {
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
  } catch (error) {
    throw new Error(
      `Network request failed. Check API base URL and backend health. Base URL: ${API_BASE_URL}`
    );
  }

  const data = await parseJsonSafely(response);

  if (!response.ok) {
    throw new Error(
      data?.message ||
        `Request failed with status ${response.status}.`
    );
  }

  return data;
}

export async function healthCheck() {
  return request("/api/health", {
    method: "GET"
  });
}

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
