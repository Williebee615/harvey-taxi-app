export const API_BASE = "https://harvey-taxi-app-2.onrender.com";

async function parseJsonSafe(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

export async function getRiders() {
  const response = await fetch(`${API_BASE}/api/riders`);
  const data = await parseJsonSafe(response);

  if (!response.ok) {
    throw new Error(data.error || "Unable to load riders.");
  }

  return data;
}

export async function getFareEstimate(payload) {
  const response = await fetch(`${API_BASE}/api/fare-estimate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJsonSafe(response);

  if (!response.ok) {
    throw new Error(data.error || "Unable to calculate fare.");
  }

  return data;
}

export async function authorizePayment(payload) {
  const response = await fetch(`${API_BASE}/api/payments/authorize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJsonSafe(response);

  if (!response.ok) {
    throw new Error(data.error || "Unable to authorize payment.");
  }

  return data;
}

export async function requestRide(payload) {
  const response = await fetch(`${API_BASE}/api/request-ride`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJsonSafe(response);

  if (!response.ok) {
    throw new Error(data.error || "Unable to request ride.");
  }

  return data;
}
