// Server-side Mapbox client: forward/reverse geocoding (Geocoding API v6)
// and driving distance/duration (Directions API v5). The access token
// stays on the server; browsers only ever see our /api/geo/* responses.
//
// Storage rule (Mapbox terms): default "temporary" geocoding results may
// not be stored. Suggestions shown while typing are temporary and never
// saved. Addresses and coordinates that end up on a ride come from
// resolve()/reverse(), which request permanent=true results (requires a
// credit card on the Mapbox account).
//
// Errors carry only a category and an HTTP status -- never the request
// URL (it contains the token) or the provider's response body.

const GEOCODE_BASE = "https://api.mapbox.com/search/geocode/v6";
const DIRECTIONS_BASE = "https://api.mapbox.com/directions/v5/mapbox/driving";
const DEFAULT_TIMEOUT_MS = 6000;
const METERS_PER_MILE = 1609.344;
// Nashville: biases suggestions toward the service area.
const DEFAULT_PROXIMITY = Object.freeze({ lat: 36.1627, lng: -86.7816 });
const ADDRESS_TYPES = "address,street,place,locality,neighborhood,postcode";

const ERROR = Object.freeze({
  NOT_CONFIGURED: "not_configured",
  PROVIDER: "provider_error",
  TIMEOUT: "timeout",
  NOT_FOUND: "not_found",
  NO_ROUTE: "no_route"
});

function isFiniteCoord(lat, lng) {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  );
}

function toPlace(feature) {
  const coords = feature?.geometry?.coordinates;
  const props = feature?.properties || {};
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!isFiniteCoord(lat, lng)) return null;
  const label = props.full_address ||
    [props.name, props.place_formatted].filter(Boolean).join(", ") ||
    props.name ||
    "";
  if (!label) return null;
  return { label: String(label).slice(0, 300), lat, lng };
}

function createMapboxClient({ token, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const doFetch = (...args) => (fetchImpl || globalThis.fetch)(...args);

  async function getJson(url) {
    if (!token) return { ok: false, error: ERROR.NOT_CONFIGURED };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (!res.ok) return { ok: false, error: ERROR.PROVIDER, status: res.status };
      return { ok: true, body };
    } catch (err) {
      return { ok: false, error: err && err.name === "AbortError" ? ERROR.TIMEOUT : ERROR.PROVIDER, status: 0 };
    } finally {
      clearTimeout(timer);
    }
  }

  function geocodeUrl(kind, params) {
    const search = new URLSearchParams({ ...params, access_token: token });
    return `${GEOCODE_BASE}/${kind}?${search.toString()}`;
  }

  // Typing suggestions: temporary results, never stored.
  async function suggest(query, { near } = {}) {
    const proximity = near && isFiniteCoord(near.lat, near.lng) ? near : DEFAULT_PROXIMITY;
    const out = await getJson(geocodeUrl("forward", {
      q: query,
      autocomplete: "true",
      limit: "5",
      country: "us",
      language: "en",
      types: ADDRESS_TYPES,
      proximity: `${proximity.lng},${proximity.lat}`
    }));
    if (!out.ok) return out;
    const results = (out.body?.features || []).map(toPlace).filter(Boolean);
    return { ok: true, results };
  }

  // The address a ride is booked with: permanent result, safe to store.
  async function resolve(query, { near } = {}) {
    const proximity = near && isFiniteCoord(near.lat, near.lng) ? near : DEFAULT_PROXIMITY;
    const out = await getJson(geocodeUrl("forward", {
      q: query,
      autocomplete: "false",
      limit: "1",
      country: "us",
      language: "en",
      types: ADDRESS_TYPES,
      proximity: `${proximity.lng},${proximity.lat}`,
      permanent: "true"
    }));
    if (!out.ok) return out;
    const place = toPlace(out.body?.features?.[0]);
    return place ? { ok: true, place } : { ok: false, error: ERROR.NOT_FOUND };
  }

  // "Use my location" pickup address: permanent result, safe to store.
  async function reverse(lat, lng) {
    const out = await getJson(geocodeUrl("reverse", {
      latitude: String(lat),
      longitude: String(lng),
      limit: "1",
      language: "en",
      types: "address,street,place",
      permanent: "true"
    }));
    if (!out.ok) return out;
    const place = toPlace(out.body?.features?.[0]);
    return place ? { ok: true, place } : { ok: false, error: ERROR.NOT_FOUND };
  }

  async function route(from, to) {
    const path = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const search = new URLSearchParams({ alternatives: "false", overview: "false", access_token: token });
    const out = await getJson(`${DIRECTIONS_BASE}/${path}?${search.toString()}`);
    if (!out.ok) {
      // Directions reports some routing failures (e.g. 422 InvalidInput)
      // as non-2xx; NoRoute arrives as a 200 with code "NoRoute".
      return out;
    }
    const first = out.body?.routes?.[0];
    if (out.body?.code !== "Ok" || !first) {
      return out.body?.code === "NoRoute" || out.body?.code === "NoSegment"
        ? { ok: false, error: ERROR.NO_ROUTE }
        : { ok: false, error: ERROR.PROVIDER, status: 200 };
    }
    const distance = Number(first.distance);
    const duration = Number(first.duration);
    if (!Number.isFinite(distance) || !Number.isFinite(duration)) {
      return { ok: false, error: ERROR.PROVIDER, status: 200 };
    }
    return {
      ok: true,
      distance_miles: Number((distance / METERS_PER_MILE).toFixed(2)),
      duration_minutes: Number((duration / 60).toFixed(1))
    };
  }

  return { suggest, resolve, reverse, route };
}

module.exports = { createMapboxClient, isFiniteCoord, ERROR, DEFAULT_PROXIMITY };
