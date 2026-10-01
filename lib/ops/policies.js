// Harvey Taxi operations policies the assistant cites. Each entry names
// the code that actually enforces the rule, so a decision summary can
// point at something real. The assistant never overrides these; it only
// explains them and routes work to whoever may act.

const POLICIES = Object.freeze({
  "POL-SAFETY-911": {
    title: "Emergencies go to 911 first",
    rule: "Harvey Taxi is not an emergency service. Anyone in danger is told to call 911; the case goes to staff.",
    source: "lib/agent/escalation.js; POST /api/safety/911"
  },
  "POL-PRICE-AUTHORITY": {
    title: "Fares come only from Harvey Taxi pricing",
    rule: "Fares are calculated by the pricing engine and signed quotes; the assistant never calculates, changes or promises a price.",
    source: "lib/pricing.js (calculateRideEstimate); lib/rideQuote.js"
  },
  "POL-PAY-BEFORE-DISPATCH": {
    title: "Payment authorized before dispatch",
    rule: "A ride is offered to drivers only after its payment is authorized (or not required for review/HTAF rides).",
    source: "POST /api/rides/:id/authorize; lib/rideDispatch.js"
  },
  "POL-CANCEL-NO-FEE": {
    title: "No cancellation fee in this phase",
    rule: "Riders may cancel before the trip starts with no fee; once in progress, only an admin incident resolution can end the ride.",
    source: "lib/rideCancellation.js"
  },
  "POL-RIDER-CONFIRMS": {
    title: "Riders confirm booking and cancellation",
    rule: "Booking, changing a paid service and cancelling happen only after the rider confirms in the app.",
    source: "POST /api/rides/request; POST /api/rides/:id/cancel (requireRider)"
  },
  "POL-DRIVER-CONTROL": {
    title: "Drivers control offers and trip steps",
    rule: "Only the driver accepts or declines an offer and marks en route, arrived, started and completed.",
    source: "requireDriverSelf; performDriverRideTransition"
  },
  "POL-DISPATCH-RULES": {
    title: "Dispatch only through existing rules",
    rule: "Redispatch uses dispatchRide(): eligible, compliance-ready, not-busy drivers, respecting the dispatch pause and reviewer isolation.",
    source: "server.js dispatchRide(); lib/driverAvailability.js; lib/driverCompliance.js"
  },
  "POL-SCHEDULED-DISPATCH": {
    title: "Scheduled rides wait for their time",
    rule: "A scheduled ride is dispatched when its time arrives, not when it is booked.",
    source: "lib/rideDispatch.js (shouldDispatchRideNow, sweepScheduledRides)"
  },
  "POL-FINANCIAL-LIMIT": {
    title: "No automatic money movement",
    rule: "The assistant's approved financial limit is $0: it never refunds, credits, captures or reverses a charge. Every refund, credit, dispute and exception goes to staff.",
    source: "docs/agent-operations.md (approved limits)"
  },
  "POL-HUMAN-ONLY": {
    title: "Decisions reserved for staff",
    rule: "Account suspension or deactivation, background-check or identity screening, disputed charges, fraud and safety incidents are decided only by staff.",
    source: "lib/agent/escalation.js; docs/ai-agent-manager.md"
  },
  "POL-PRIVACY": {
    title: "Rider and driver information stays separate",
    rule: "Riders see their own ride details and the driver's first name and vehicle; drivers see their own trips; neither sees the other's contact details, location history or case notes.",
    source: "lib/ops/caseStore.js (views)"
  }
});

function policyRef(id) {
  const p = POLICIES[id];
  if (!p) throw new Error(`Unknown policy ${id}`);
  return { id, title: p.title, source: p.source };
}

module.exports = { POLICIES, policyRef };
