const API_BASE_URL = "https://harvey-taxi-app-2.onrender.com";

async function apiRequest(endpoint, method = "GET", body = null) {
  try {
    const options = {
      method,
      headers: {
        "Content-Type": "application/json"
      }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Request failed");
    }

    return data;
  } catch (error) {
    console.error(`API Error on ${endpoint}:`, error.message);
    throw error;
  }
}

export async function getRiders() {
  return apiRequest("/api/riders", "GET");
}

export async function getFareEstimate(payload) {
  return apiRequest("/api/fare-estimate", "POST", payload);
}

export async function authorizePayment(payload) {
  return apiRequest("/api/payments/authorize", "POST", payload);
}

export async function requestRide(payload) {
  return apiRequest("/api/request-ride", "POST", payload);
}
