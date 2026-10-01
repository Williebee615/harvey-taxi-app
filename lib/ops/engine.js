// Operations assistant engine: investigate -> plan -> policy check ->
// confirmation -> execute -> verify, with case memory.
//
// Dependencies are injected so the whole workflow is testable:
//   supabase          data access (evidence reads only)
//   store             lib/ops/caseStore.js
//   policyContext()   -> { actionsEnabled, killSwitch, flags }
//   freeDriverCount(ride) -> number of eligible free drivers now
//   executors         { redispatch_ride: async ({ evidence }) -> { executed, verified, observed, reason } }
//   activity(entry)   records agent activity (audit log)
//
// Never claims success without verification: an execution result is
// marked "verified" only from a fresh database read the executor makes.

const { understandReport, CATEGORY_LABELS } = require("./intake");
const { collectRideEvidence, EvidenceAccessError } = require("./evidence");
const { analyzeCase } = require("./analyzers");
const { buildPlan, checkAction, CASE_STATE, STATE_LABELS, ACTIONS } = require("./planner");
const { ESCALATION_GUIDANCE } = require("../agent/escalation");

const RIDE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function decisionSummary({ rideId, findings, plan, understanding }) {
  const issues = findings.map((f) => f.title).join(", ") || "general question";
  const facts = findings.reduce((n, f) => n + f.facts.length, 0);
  const conflicts = findings.reduce((n, f) => n + f.conflicts.length, 0);
  const missing = findings.reduce((n, f) => n + f.missing.length, 0);
  const parts = [`Investigated ride ${rideId} (${issues}): ${plural(facts, "verified fact")}, ${plural(conflicts, "conflict")}, ${plural(missing, "missing item")}.`];
  if (plan.queue.length) parts.push(`Proposed: ${plan.queue.map((q) => `${q.label} (needs ${q.confirm_by} confirmation)`).join("; ")}.`);
  if (plan.state === CASE_STATE.NEEDS_HUMAN_REVIEW) {
    const escalateWhy = (plan.checks || []).find((c) => c.action === "escalate_to_human");
    const why = understanding.boundary
      ? `${understanding.boundary.category.replace(/_/g, " ")} reported`
      : plan.escalation
        ? plan.escalation.reason
        : escalateWhy && escalateWhy.why
          ? escalateWhy.why
          : "a decision only staff can make";
    parts.push(`Sent to staff: ${String(why).replace(/\.$/, "")}.`);
  }
  const unknowns = findings.flatMap((f) => f.missing.map((m) => m.text.replace(/\.$/, "")));
  if (unknowns.length) parts.push(`Not known: ${unknowns.slice(0, 3).join("; ")}.`);
  return parts.join(" ");
}

// Plain-language summary for the rider or driver (no internal hypotheses).
function subjectSummary({ findings, plan, role }) {
  if (plan.state === CASE_STATE.NEEDS_HUMAN_REVIEW) {
    return "We've checked your ride records and passed this to the Harvey Taxi team, who make decisions on charges, refunds, safety and account matters. You don't need to explain it again.";
  }
  if (plan.state === CASE_STATE.INVESTIGATING) return "We need a little more information to finish checking this.";
  const hold = findings.some((f) => f.conflicts.some((c) => /authorization hold/i.test(c.reading || "")));
  if (hold) return "Nothing has been charged for this ride. What you see is a temporary authorization hold, not a charge.";
  if (plan.queue.some((q) => q.confirm_by === role)) return "We found what happened. There's an option below for you to confirm; nothing changes until you do.";
  return "We checked your ride records. Details are below.";
}

function createOpsEngine({ supabase, store, policyContext, freeDriverCount = async () => undefined, executors = {}, activity = () => {}, now = () => Date.now() }) {
  async function candidateRides(actor) {
    if (actor.role !== "rider" && actor.role !== "driver") return [];
    const col = actor.role === "rider" ? "rider_id" : "driver_id";
    const { data } = await supabase.from("rides").select("id,status,pickup_address,created_at").eq(col, String(actor.id)).order("created_at", { ascending: false }).limit(5);
    return (data || []).map((r) => ({ id: r.id, label: `${r.id} (${r.status})` }));
  }

  async function investigate({ actor, subject, rideId, message, answers = {}, existing = null }) {
    const understanding = existing
      ? { ...existing.summary.understanding, follow_ups: existing.summary.follow_ups || [] }
      : understandReport(message, { knownRideId: rideId, candidateRides: rideId ? [] : await candidateRides(actor) });
    // Answers to earlier questions.
    if (answers.which_ride && RIDE_ID_PATTERN.test(answers.which_ride)) rideId = answers.which_ride;
    if (!rideId && understanding.entities && understanding.entities.ride_ids.length) rideId = understanding.entities.ride_ids[0];

    const trace = [];
    if (!rideId) {
      return {
        rideId: null,
        state: understanding.boundary ? CASE_STATE.NEEDS_HUMAN_REVIEW : CASE_STATE.INVESTIGATING,
        summary: {
          understanding,
          findings: [],
          follow_ups: understanding.follow_ups.filter((q) => q.id === "which_ride").length ? understanding.follow_ups : [{ id: "which_ride", question: "Which ride is this about?", options: [] }],
          decision_summary: "Waiting for the ride this report is about.",
          subject_summary: understanding.boundary ? ESCALATION_GUIDANCE[understanding.boundary.category] : "Which ride is this about?",
          tool_calls: trace
        },
        queue: [],
        steps: [{ step: "investigate", status: "waiting", detail: "Ride not identified yet." }]
      };
    }

    const evidence = await collectRideEvidence({ supabase, actor, rideId, now: now(), trace });
    const freeDrivers = await freeDriverCount(evidence.ride);
    const findings = analyzeCase({ understanding, evidence, answers, context: { now: now(), freeDriverCount: freeDrivers } });
    // Follow-ups still open after the answers given so far.
    const followUps = (understanding.follow_ups || []).filter((q) => q.id !== "which_ride" && !answers[q.id]);
    const plan = buildPlan({
      findings,
      understanding: { ...understanding, follow_ups: followUps },
      evidence,
      policyContext: await policyContext()
    });
    const summary = {
      understanding: {
        categories: understanding.categories,
        claims: understanding.claims,
        entities: { ride_ids: understanding.entities ? understanding.entities.ride_ids : [], amounts: understanding.entities ? understanding.entities.amounts : [] },
        boundary: understanding.boundary
      },
      findings,
      checks: plan.checks,
      escalation: plan.escalation,
      follow_ups: followUps,
      timeline: evidence.timeline,
      heartbeat: evidence.heartbeat,
      decision_summary: decisionSummary({ rideId, findings, plan, understanding }),
      subject_summary: understanding.boundary
        ? ESCALATION_GUIDANCE[understanding.boundary.category]
        : subjectSummary({ findings, plan, role: subject.role }),
      policy_refs: [...new Map(findings.flatMap((f) => f.policies).map((p) => [p.id, p])).values()],
      tool_calls: trace,
      investigated_at: new Date(now()).toISOString()
    };
    return { rideId, state: plan.state, summary, queue: plan.queue, steps: plan.steps, evidence };
  }

  async function openCase({ actor, subject = actor, message, rideId = null }) {
    if (rideId && !RIDE_ID_PATTERN.test(String(rideId))) throw Object.assign(new Error("Ride not found."), { status: 404 });
    // Continue an open case for the same ride instead of starting over.
    if (rideId && store.isAvailable() !== false) {
      try {
        const open = await store.findOpenForSubjectRide(subject.role, subject.id, rideId);
        if (open) return reply({ actor, caseId: open.id, answers: {}, message });
      } catch (err) {
        if (err.code !== "CASE_MEMORY_UNAVAILABLE") throw err;
      }
    }
    const result = await investigate({ actor, subject, rideId, message });
    activity({ action: "ops.case_investigated", entity_id: result.rideId, metadata: { state: result.state, categories: result.summary.understanding.categories, tool_calls: result.summary.tool_calls.length } });
    let record;
    try {
      record = await store.create({
        subjectRole: subject.role,
        subjectId: subject.id,
        rideId: result.rideId,
        state: result.state,
        categories: result.summary.understanding.categories,
        summary: result.summary,
        queue: result.queue,
        steps: result.steps,
        answers: {},
        createdByRole: actor.role
      });
    } catch (err) {
      if (err.code !== "CASE_MEMORY_UNAVAILABLE") throw err;
      record = { id: null, subject_role: subject.role, subject_id: String(subject.id), ride_id: result.rideId, state: result.state, categories: result.summary.understanding.categories, summary: result.summary, queue: result.queue, steps: result.steps, memory: false };
    }
    if (record.id) activity({ action: "ops.case_opened", entity_id: record.id, metadata: { state: record.state, ride_id: record.ride_id } });
    return record;
  }

  async function loadFor(actor, caseId) {
    const record = await store.get(caseId);
    if (!record || !store.viewFor(actor, record)) throw Object.assign(new Error("Case not found."), { status: 404 });
    return record;
  }

  async function reply({ actor, caseId, answers = {}, message = null }) {
    const record = await loadFor(actor, caseId);
    const merged = { ...(record.answers || {}), ...answers };
    const subject = { role: record.subject_role, id: record.subject_id };
    // A new message on an existing case adds claims instead of starting over.
    let existing = record;
    if (message) {
      const extra = understandReport(message, { knownRideId: record.ride_id });
      existing = {
        ...record,
        summary: {
          ...record.summary,
          understanding: {
            ...record.summary.understanding,
            categories: [...new Set([...(record.summary.understanding.categories || []), ...extra.categories])],
            claims: { ...(record.summary.understanding.claims || {}), ...extra.claims },
            boundary: record.summary.understanding.boundary || extra.boundary,
            entities: record.summary.understanding.entities || extra.entities
          }
        }
      };
    }
    const result = await investigate({ actor, subject, rideId: record.ride_id, message: null, answers: merged, existing });
    const keepQueue = (record.queue || []).filter((q) => q.status !== "awaiting_confirmation");
    const updated = await store.update(record, {
      ride_id: result.rideId,
      state: keepQueue.some((q) => q.status === "failed") ? CASE_STATE.NEEDS_HUMAN_REVIEW : result.state,
      categories: result.summary.understanding.categories,
      summary: result.summary,
      queue: [...keepQueue, ...result.queue.map((q, i) => ({ ...q, id: `A${keepQueue.length + i + 1}` }))],
      steps: result.steps,
      answers: merged
    });
    activity({ action: "ops.case_updated", entity_id: updated.id, metadata: { state: updated.state } });
    return updated;
  }

  // Staff approval of a queued action: re-investigate, re-check policy,
  // claim the action (optimistic concurrency), execute, verify.
  async function approveAction({ admin, caseId, actionId }) {
    let record = await loadFor({ role: "admin", id: admin.id }, caseId);
    const item = (record.queue || []).find((q) => q.id === actionId);
    if (!item) throw Object.assign(new Error("Action not found."), { status: 404 });
    if (item.status !== "awaiting_confirmation") throw Object.assign(new Error(`This action is already ${item.status}.`), { status: 409 });
    if (item.confirm_by !== "admin") throw Object.assign(new Error(`This action is confirmed by the ${item.confirm_by}, not by staff.`), { status: 409 });
    const executor = executors[item.action];
    if (!executor) throw Object.assign(new Error("This action cannot be executed by the server."), { status: 409 });

    // Fresh evidence and policy check at the moment of execution.
    const evidence = await collectRideEvidence({ supabase, actor: { role: "admin", id: admin.id }, rideId: record.ride_id, now: now() });
    const check = checkAction(item.action, { evidence, ...(await policyContext()), now: now() });
    const stamp = new Date(now()).toISOString();
    if (check.allowed && !check.executable_now) {
      // Right action, execution switched off: leave the case as it is.
      throw Object.assign(new Error(check.reason), { status: 409 });
    }
    if (!check.allowed) {
      record = await store.update(record, {
        queue: record.queue.map((q) => (q.id === actionId ? { ...q, status: "blocked", blocked_reason: check.reason, decided_by: admin.id, decided_at: stamp } : q)),
        state: CASE_STATE.NEEDS_HUMAN_REVIEW,
        steps: record.steps.map((s) => (s.step === "policy_check" ? { ...s, status: "done", detail: `Re-checked at approval: ${check.reason}` } : s))
      });
      activity({ action: "ops.action_blocked", entity_id: record.id, metadata: { action: item.action, reason: check.reason } });
      return { record, outcome: { executed: false, verified: false, reason: check.reason } };
    }

    // Claim: only one approver can move the item to "executing".
    record = await store.update(record, {
      queue: record.queue.map((q) => (q.id === actionId ? { ...q, status: "executing", decided_by: admin.id, decided_at: stamp } : q)),
      steps: record.steps.map((s) => (s.step === "confirmation" ? { ...s, status: "done", detail: `Approved by ${admin.id}` } : s.step === "execute" ? { ...s, status: "running" } : s))
    });
    activity({ action: "ops.action_approved", entity_id: record.id, metadata: { action: item.action, by: admin.id } });

    let outcome;
    try {
      outcome = await executor({ evidence, record, item });
    } catch (err) {
      outcome = { executed: false, verified: false, reason: "execution_error" };
    }
    const status = outcome.executed ? (outcome.verified ? "verified" : "unverified") : "failed";
    record = await store.update(record, {
      queue: record.queue.map((q) => (q.id === actionId ? { ...q, status, result: { executed: outcome.executed, verified: outcome.verified, observed: outcome.observed || null, reason: outcome.reason || null }, finished_at: new Date(now()).toISOString() } : q)),
      steps: record.steps.map((s) =>
        s.step === "execute"
          ? { ...s, status: outcome.executed ? "done" : "failed", detail: outcome.reason || (outcome.executed ? "Executed through the existing platform function." : "Not executed.") }
          : s.step === "verify"
            ? { ...s, status: outcome.verified ? "done" : "failed", detail: outcome.observed ? JSON.stringify(outcome.observed) : "No verification possible." }
            : s
      ),
      state: outcome.verified ? CASE_STATE.RESOLVED : CASE_STATE.NEEDS_HUMAN_REVIEW,
      summary: {
        ...record.summary,
        decision_summary: `${record.summary.decision_summary} Outcome: ${item.label} ${
          outcome.verified
            ? `was approved by ${admin.id}, executed and verified from the records (${Object.entries(outcome.observed || {}).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ")}).`
            : outcome.executed
              ? `was executed but could not be verified (${outcome.reason || "no change observed"}); sent to staff.`
              : `was not executed (${outcome.reason || "unknown reason"}); sent to staff.`
        }`
      }
    });
    activity({ action: outcome.verified ? "ops.action_verified" : "ops.action_failed", entity_id: record.id, metadata: { action: item.action, observed: outcome.observed || null, reason: outcome.reason || null } });
    return { record, outcome };
  }

  async function rejectAction({ admin, caseId, actionId, note }) {
    const record = await loadFor({ role: "admin", id: admin.id }, caseId);
    const item = (record.queue || []).find((q) => q.id === actionId);
    if (!item || item.status !== "awaiting_confirmation") throw Object.assign(new Error("Action is not awaiting confirmation."), { status: 409 });
    const queue = record.queue.map((q) => (q.id === actionId ? { ...q, status: "rejected", decided_by: admin.id, note: note ? String(note).slice(0, 300) : null } : q));
    const remaining = queue.some((q) => q.status === "awaiting_confirmation");
    const updated = await store.update(record, { queue, state: remaining ? record.state : CASE_STATE.NEEDS_HUMAN_REVIEW });
    activity({ action: "ops.action_rejected", entity_id: record.id, metadata: { action: item.action, by: admin.id } });
    return updated;
  }

  // Re-reads the records; marks rider-confirmed actions done when the
  // platform shows they happened (e.g. the rider cancelled in the app).
  async function refresh({ actor, caseId }) {
    const record = await loadFor(actor, caseId);
    if (!record.ride_id) return record;
    const evidence = await collectRideEvidence({ supabase, actor: { role: "admin", id: "refresh" }, rideId: record.ride_id, now: now() });
    let changed = false;
    const queue = (record.queue || []).map((q) => {
      if (q.action === "cancel_ride_no_fee" && q.status === "awaiting_confirmation" && evidence.ride.status === "cancelled") {
        changed = true;
        return { ...q, status: "verified", result: { executed: true, verified: true, observed: { ride_status: "cancelled", cancelled_by: evidence.ride.cancelled_by_type || null } } };
      }
      return q;
    });
    if (!changed) return record;
    const open = queue.some((q) => q.status === "awaiting_confirmation");
    // A case waiting for staff stays with staff even when the rider's part is done.
    const state = record.state === CASE_STATE.NEEDS_HUMAN_REVIEW || open ? record.state : CASE_STATE.RESOLVED;
    const updated = await store.update(record, { queue, state });
    activity({ action: "ops.action_verified", entity_id: record.id, metadata: { action: "cancel_ride_no_fee", by: "rider" } });
    return updated;
  }

  async function resolveByStaff({ admin, caseId, resolution, note }) {
    const record = await loadFor({ role: "admin", id: admin.id }, caseId);
    const updated = await store.update(record, {
      state: CASE_STATE.RESOLVED,
      summary: { ...record.summary, staff_resolution: { resolution, note: note ? String(note).slice(0, 500) : null, by: admin.id, at: new Date(now()).toISOString() } }
    });
    activity({ action: "ops.case_resolved_by_staff", entity_id: record.id, metadata: { resolution } });
    return updated;
  }

  return { openCase, reply, approveAction, rejectAction, refresh, resolveByStaff, investigate };
}

module.exports = { createOpsEngine, decisionSummary, CASE_STATE, STATE_LABELS, ACTIONS, CATEGORY_LABELS, EvidenceAccessError };
