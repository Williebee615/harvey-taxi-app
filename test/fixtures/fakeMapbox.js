// Stand-in for api.mapbox.com used by tests: answers Geocoding v6 and
// Directions v5 requests from fixtures and records each request (with the
// token stripped). Behavior can be switched to simulate provider errors.

const TEST_TOKEN = "pk.fixture-token-DO-NOT-LEAK-7f3a9";

const PLACES = [
  { match: /broad/i, label: "501 Broadway, Nashville, Tennessee 37203, United States", lat: 36.1612, lng: -86.7775 },
  { match: /terminal/i, label: "1 Terminal Drive, Nashville, Tennessee 37214, United States", lat: 36.1263, lng: -86.6774 },
  { match: /west end/i, label: "2500 West End Avenue, Nashville, Tennessee 37203, United States", lat: 36.1493, lng: -86.81 }
];

function feature(place) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [place.lng, place.lat] },
    properties: { full_address: place.label, name: place.label.split(",")[0] }
  };
}

function createFakeMapbox() {
  const calls = [];
  let mode = "ok"; // ok | http_401 | http_500 | timeout | network | no_route

  function json(status, body) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  async function fetchImpl(input, init = {}) {
    const url = new URL(String(input));
    if (url.hostname !== "api.mapbox.com") {
      throw new Error(`unexpected host ${url.hostname}`);
    }
    const params = Object.fromEntries(url.searchParams.entries());
    const tokenOk = params.access_token === TEST_TOKEN;
    delete params.access_token;
    calls.push({ path: url.pathname, params, tokenOk });

    if (mode === "network") throw new TypeError("fetch failed");
    if (mode === "timeout") {
      return new Promise((resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }
    if (mode === "http_401" || !tokenOk) {
      // Mapbox echoes nothing secret, but make sure we never relay bodies.
      return json(401, { message: `Not Authorized - Invalid Token ${TEST_TOKEN}` });
    }
    if (mode === "http_500") return json(500, { message: "upstream error" });

    if (url.pathname.startsWith("/search/geocode/v6/forward")) {
      const hits = PLACES.filter((p) => p.match.test(params.q || ""));
      return json(200, { type: "FeatureCollection", features: hits.map(feature) });
    }
    if (url.pathname.startsWith("/search/geocode/v6/reverse")) {
      return json(200, { type: "FeatureCollection", features: [feature(PLACES[0])] });
    }
    if (url.pathname.startsWith("/directions/v5/mapbox/driving/")) {
      if (mode === "no_route") return json(200, { code: "NoRoute", message: "No route found", routes: [] });
      return json(200, { code: "Ok", routes: [{ distance: 8369, duration: 840 }], waypoints: [] });
    }
    return json(404, { message: "Not Found" });
  }

  return {
    fetchImpl,
    calls,
    setMode(next) {
      mode = next;
    },
    reset() {
      mode = "ok";
      calls.length = 0;
    }
  };
}

module.exports = { createFakeMapbox, TEST_TOKEN, PLACES };
