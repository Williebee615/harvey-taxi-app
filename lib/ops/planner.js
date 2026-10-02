// Planning and policy checks for operations cases.
//
// Workflow per case: investigate -> plan -> policy check -> confirmation
// (when required) -> execute -> verify. This module decides the plan and
// the policy outcome for each proposed action; the server performs the
// execution through existing platform functions and re-reads the database
// to verify. The catalogue below is the complete list of things the
// assistant can ever do; anything else is staff work.

const { CANCELLABLE_STATUSES } = require("../rideCancellation");
const { policyRef } = require("./policies");

const CASE_STATE = Object.freeze({
  INVESTIGATING: "investigating",
  AWAITING_CONFIRMATION: "awaiting_confirmation",
  RESOLVED: "resolved",
  NEEDS_HUMAN_REVIEW: "needs_human_review"
});

const STATE_LABELS = Object.freeze({
  investigating: "Investigating",
  awaiting_confirmation: "Awaiting confirmation",
  resolved: "Resolved",
  needs_human_review: "Needs human review"
});

// Who must confirm, who performs it, and through which existing API.
const ACTIONS = Object.freeze({
  explain_only: {
    label: "Explain the finding",
    confirm_by: null,
    performed_by: "assistant",
    via: "case summary (no platform change)"
  },
  cancel_ride_no_fee: {
    label: "Cancel the ride (no fee)",
    confirm_by: "rider",
    performed_by: "rider",
    via: "POST /api/rides/:id/cancel (rider session, ownership checked)"
  },
  redispatch_ride: {
    label: "Send the ride to the next eligible driver",
    confirm_by: "admin",
    performed_by: "server on admin approval",
    via: "dispatchRide() after a conditional claim on the ride"
  },
  escalate_to_human: {
    label: "Hand to staff for review",
    confirm_by: null,
    performed_by: "assistant",
    via: "human-review queue"
  }
});

// Policy check for one proposed action against the current evidence.
function checkAction(action, { evidence, flags = {}, killSwitch = false, actionsEnabled = false, now = Date.now() }) {
  const ride = evidence.ride;
  const def = ACTIONS[action];
  if (!def) return { action, allowed: false, reason: "Not an action the assistant can take.", policy: policyRef("POL-HUMAN-ONLY") };
  switch (action) {
    case "explain_only":
    case "escalate_to_human":
      return { action, allowed: true, executable_now: true, reason: "Always allowed.", policy: policyRef(action === "escalate_to_human" ? "POL-HUMAN-ONLY" : "POL-PRICE-AUTHORITY") };
    case "cancel_ride_no_fee": {
      const ok = CANCELLABLE_STATUSES.includes(ride.status);
      return {
        action,
        allowed: ok,
        executable_now: ok,
        reason: ok ? "Cancellable before the trip starts; no fee in this phase. The rider confirms in the app." : `A "${ride.status}" ride cannot be cancelled by the rider.`,
        policy: policyRef("POL-CANCEL-NO-FEE")
      };
    }
    case "redispatch_ride": {
      const live = evidence.offers.some((o) => o.status === "pending" && Date.parse(o.expires_at || 0) > now);
      // Policy blockers: the action is wrong for this ride.
      const blockers = [];
      if (evidence.dispatchPaused || flags.dispatch_paused) blockers.push("dispatch is paused");
      if (ride.status !== "payment_authorized") blockers.push(`the ride is "${ride.status}", not waiting for a driver with payment authorized`);
      if (ride.driver_id) blockers.push("a driver is already assigned");
      if (live) blockers.push("a driver is already being offered the ride");
      if (ride.is_review_ride) blockers.push("App Review rides are excluded");
      if ((Number(ride.dispatch_attempts) || 0) >= 3) blockers.push("the ride has used its automatic attempts");
      // Switches: the action is right, but execution is turned off.
      const switches = [];
      if (!actionsEnabled) switches.push("operations actions are turned off (ops_actions_enabled)");
      if (killSwitch) switches.push("the agent kill switch is engaged");
      const allowed = blockers.length === 0;
      return {
        action,
        allowed,
        executable_now: allowed && switches.length === 0,
        reason: !allowed
          ? `Not allowed: ${blockers.join("; ")}.`
          : switches.length
            ? `Allowed with admin approval, but execution is currently off: ${switches.join("; ")}.`
            : "Allowed with admin approval; runs through normal dispatch rules.",
        policy: policyRef("POL-DISPATCH-RULES")
      };
    }
    default:
      return { action, allowed: false, reason: "Unknown action.", policy: policyRef("POL-HUMAN-ONLY") };
  }
}

// Builds the plan and the resulting case state from analysis findings.
function buildPlan({ findings, understanding, evidence, policyContext }) {
  const proposals = [];
  const seen = new Set();
  for (const f of findings) {
    for (const p of f.proposals) {
      if (seen.has(p.action)) continue;
      seen.add(p.action);
      proposals.push({ ...p, category: f.category });
    }
  }
  const checks = proposals.map((p) => ({ ...checkAction(p.action, { evidence, ...policyContext }), why: p.reason }));
  const boundary = understanding.boundary;
  const escalations = findings.filter((f) => f.escalate).map((f) => f.escalate);
  const needsHuman =
    Boolean(boundary) ||
    escalations.length > 0 ||
    checks.some((c) => c.action === "escalate_to_human") ||
    // A proposed redispatch that policy blocks for a reason a person must resolve.
    checks.some((c) => c.action === "redispatch_ride" && !c.allowed && /paused|attempts/.test(c.reason));
  const actionable = checks.filter((c) => c.allowed && ACTIONS[c.action].confirm_by);
  const pendingQuestions = understanding.follow_ups.filter((q) => q.id !== "which_ride" || !evidence);

  let state;
  if (needsHuman) state = CASE_STATE.NEEDS_HUMAN_REVIEW;
  else if (pendingQuestions.length) state = CASE_STATE.INVESTIGATING;
  else if (actionable.length) state = CASE_STATE.AWAITING_CONFIRMATION;
  else state = CASE_STATE.RESOLVED;

  const queue = actionable.map((c, i) => ({
    id: `A${i + 1}`,
    action: c.action,
    label: ACTIONS[c.action].label,
    confirm_by: ACTIONS[c.action].confirm_by,
    via: ACTIONS[c.action].via,
    status: "awaiting_confirmation",
    policy: c.policy,
    why: c.why
  }));

  const steps = [
    { step: "investigate", status: "done", detail: `${evidence.timeline.length} timeline events from ${new Set(evidence.timeline.map((e) => e.source)).size} sources.` },
    { step: "plan", status: "done", detail: proposals.length ? proposals.map((p) => ACTIONS[p.action] ? ACTIONS[p.action].label : p.action).join("; ") : "No platform action needed." },
    { step: "policy_check", status: "done", detail: checks.map((c) => `${c.action}: ${c.allowed ? "allowed" : "blocked"}`).join("; ") || "Nothing to check." },
    { step: "confirmation", status: queue.length ? "awaiting" : "not_required", detail: queue.map((q) => `${q.label} needs ${q.confirm_by} confirmation`).join("; ") || "None required." },
    { step: "execute", status: queue.length ? "pending" : "not_applicable" },
    { step: "verify", status: queue.length ? "pending" : "not_applicable" }
  ];
  return { state, state_label: STATE_LABELS[state], checks, queue, steps, escalation: boundary ? { category: boundary.category, severity: boundary.severity } : escalations[0] || null };
}

module.exports = { CASE_STATE, STATE_LABELS, ACTIONS, checkAction, buildPlan };
