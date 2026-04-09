const API_BASE_URL = "https://harvey-taxi-app-2.onrender.com";

const DEFAULT_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json"
};

async function safeParseJson(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return { raw: text };
  }
}

async function requestWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    const data = await safeParseJson(response);

    if (!response.ok) {
      const message =
        data?.error ||
        data?.message ||
        `Request failed with status ${response.status}`;
      throw new Error(message);
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function postJson(endpoint, body) {
  return requestWithTimeout(`${API_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: DEFAULT_HEADERS,
    body: JSON.stringify(body)
  });
}

async function getJson(endpoint) {
  return requestWithTimeout(`${API_BASE_URL}${endpoint}`, {
    method: "GET",
    headers: DEFAULT_HEADERS
  });
}

async function tryPostEndpoints(endpoints, body) {
  const errors = [];

  for (const endpoint of endpoints) {
    try {
      return await postJson(endpoint, body);
    } catch (error) {
      errors.push(`${endpoint}: ${error.message}`);
    }
  }

  throw new Error(errors.join(" | "));
}

export async function healthCheck() {
  try {
    return await getJson("/api/health");
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  }
}

export async function riderSignup(payload) {
  return tryPostEndpoints(
    ["/api/rider/signup", "/api/riders/signup"],
    payload
  );
}

export async function driverSignup(payload) {
  return tryPostEndpoints(
    ["/api/driver/signup", "/api/drivers/signup"],
    payload
  );
}

export async function getRiders() {
  return tryPostEndpoints([], {});
}

export async function authorizePayment(payload) {
  return postJson("/api/payments/authorize", payload);
}

export async function getFareEstimate(payload) {
  return postJson("/api/fare-estimate", payload);
}

export async function requestRide(payload) {
  return postJson("/api/request-ride", payload);
}

export { API_BASE_URL };
