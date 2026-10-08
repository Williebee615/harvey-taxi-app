/* Harvey Taxi: rider ride cancellation (docs/policy-cancellation-noshow-draft.md).
 *
 * One flow for the ride card and Harvey Assistant, in the website and the
 * iOS and Android rider apps (which show this website):
 *   1. ask the server what cancelling costs right now (the exact fee);
 *   2. show that fee in the confirmation;
 *   3. cancel, sending the fee that was shown -- the server refuses if it
 *      changed in between.
 * Cancellations are free in this phase, so the fee shown is $0.00.
 */
(function () {
  "use strict";

  // The rider's session is the HttpOnly cookie; same headers as the assistant.
  function headers() {
    return { "Content-Type": "application/json", Accept: "application/json", "x-requested-with": "harvey-rider-app" };
  }

  function call(method, path, body) {
    return fetch(path, { method: method, credentials: "same-origin", headers: headers(), body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) { return { ok: r.ok, status: r.status, data: data || {} }; });
      });
  }

  // `noun` is "ride" (default) or "delivery": wording only, same rules.
  function confirmText(preview, noun) {
    return (
      "Cancel this " + (noun || "ride") + "?\n\n" +
      "Cancellation fee: " + preview.fee_display + "\n" +
      (preview.message || "") + "\n\n" +
      "Nothing changes unless you confirm."
    );
  }

  // Resolves to { cancelled, message }. `confirmFn` defaults to window.confirm.
  function cancelRide(rideId, opts) {
    opts = opts || {};
    var noun = opts.noun === "delivery" ? "delivery" : "ride";
    var confirmFn = opts.confirm || function (t) { return window.confirm(t); };
    var id = encodeURIComponent(String(rideId || ""));
    if (!id) return Promise.resolve({ cancelled: false, message: "No " + noun + " to cancel." });
    return call("GET", "/api/rides/" + id + "/cancel-preview").then(function (p) {
      if (!p.ok) return { cancelled: false, message: (p.data && (p.data.error || p.data.message)) || "We couldn't check this " + noun + " right now. Please try again." };
      if (!p.data.cancellable) return { cancelled: false, message: p.data.message || "This " + noun + " can't be cancelled now." };
      if (!confirmFn(confirmText(p.data, noun))) return { cancelled: false, message: null };
      return call("POST", "/api/rides/" + id + "/cancel", { reason: opts.reason || "Rider cancelled in app", expected_fee_cents: p.data.fee_cents }).then(function (c) {
        if (c.ok) return { cancelled: true, message: "Your " + noun + " was cancelled. Cancellation fee: " + (c.data.cancellation_fee_display || p.data.fee_display) + "." };
        if (c.data && (c.data.code === "cancellation_fee_changed" || c.data.code === "cancellation_fee_not_shown")) {
          return { cancelled: false, message: "The cancellation fee changed before you confirmed. Nothing was cancelled; please review it and try again." };
        }
        return { cancelled: false, message: (c.data && (c.data.error || c.data.message)) || "The " + noun + " could not be cancelled." };
      });
    }).catch(function () {
      return { cancelled: false, message: "The " + noun + " could not be cancelled. Please check your connection and try again." };
    });
  }

  window.HarveyCancelRide = { cancelRide: cancelRide, confirmText: confirmText };
})();
