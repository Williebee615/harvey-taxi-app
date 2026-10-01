// Minimal stand-in for the Google Maps JavaScript API, served in browser
// tests instead of maps.googleapis.com (no network, no key). Geocodes any
// address to a fixed Nashville point (pickup vs destination by a simple
// hash) and reports a fixed 5.2-mile, 14-minute drive.
(function () {
  function LatLng(lat, lng) {
    this._lat = lat;
    this._lng = lng;
  }
  LatLng.prototype.lat = function () { return this._lat; };
  LatLng.prototype.lng = function () { return this._lng; };

  function Noop() {}
  Noop.prototype.setMap = function () {};
  Noop.prototype.setPosition = function () {};
  Noop.prototype.setCenter = function () {};
  Noop.prototype.setZoom = function () {};
  Noop.prototype.setPath = function () {};
  Noop.prototype.setOptions = function () {};
  Noop.prototype.setRadius = function () {};
  Noop.prototype.fitBounds = function () {};
  Noop.prototype.panTo = function () {};
  Noop.prototype.addListener = function () { return { remove: function () {} }; };
  Noop.prototype.extend = function () { return this; };

  function Geocoder() {}
  Geocoder.prototype.geocode = function (request, callback) {
    var text = String((request && request.address) || "");
    var known = text.length > 3;
    var hash = 0;
    for (var i = 0; i < text.length; i += 1) hash = (hash + text.charCodeAt(i)) % 97;
    var loc = new LatLng(36.16 + hash / 1000, -86.78 + hash / 1000);
    setTimeout(function () {
      callback(
        known ? [{ geometry: { location: loc }, formatted_address: text }] : [],
        known ? "OK" : "ZERO_RESULTS"
      );
    }, 0);
  };

  function DistanceMatrixService() {}
  DistanceMatrixService.prototype.getDistanceMatrix = function (request, callback) {
    setTimeout(function () {
      callback(
        { rows: [{ elements: [{ status: "OK", distance: { value: 8369 }, duration: { value: 840 } }] }] },
        "OK"
      );
    }, 0);
  };

  function Autocomplete() {}
  Autocomplete.prototype = Object.create(Noop.prototype);
  Autocomplete.prototype.getPlace = function () { return {}; };

  window.google = {
    maps: {
      LatLng: LatLng,
      LatLngBounds: Noop,
      Map: Noop,
      Marker: Noop,
      Polyline: Noop,
      Circle: Noop,
      Geocoder: Geocoder,
      DistanceMatrixService: DistanceMatrixService,
      TravelMode: { DRIVING: "DRIVING" },
      UnitSystem: { IMPERIAL: 1 },
      event: { addListener: function () { return { remove: function () {} }; }, clearInstanceListeners: function () {} },
      places: { Autocomplete: Autocomplete }
    }
  };
})();
