const { createUsageMeter, usageKey, summarizeUsage, utcDay } = require("./usage");

const LIMITS = { per_account: 3, visitor: 2, global: 6 };

test("per-account, visitor and global daily limits; one block record per key per day", () => {
  let t = Date.parse("2026-10-04T10:00:00Z");
  const m = createUsageMeter({ now: () => t });
  const a = "rider:R1";
  for (let i = 0; i < 3; i += 1) {
    expect(m.check(a, LIMITS).allowed).toBe(true);
    m.record(a);
  }
  expect(m.check(a, LIMITS)).toEqual({ allowed: false, reason: "account_daily_limit", first_block_today: true });
  expect(m.check(a, LIMITS).first_block_today).toBe(false);
  const v = "visitor:abc";
  m.record(v);
  m.record(v);
  expect(m.check(v, LIMITS).reason).toBe("visitor_daily_limit");
  m.record("driver:D1");
  // 6 recorded in total: the global cap now refuses everyone.
  expect(m.check("driver:D1", LIMITS).reason).toBe("global_daily_limit");
  expect(m.snapshot()).toMatchObject({ requests_today: 6, by_role: { rider: 3, driver: 1, visitor: 2 }, blocked_today: 4, blocked_accounts_today: 3 });
  // Next UTC day: counters start over.
  t = Date.parse("2026-10-05T00:00:01Z");
  expect(m.check(a, LIMITS).allowed).toBe(true);
  expect(m.snapshot()).toMatchObject({ day: "2026-10-05", requests_today: 0, blocked_today: 0 });
});

test("keys: accounts by role and id; visitors by a salted hash, never the address", () => {
  expect(usageKey({ role: "driver", actorId: "D1", ip: "1.2.3.4" })).toBe("driver:D1");
  expect(usageKey({ role: "rider", actorId: "R1", ip: "1.2.3.4" })).toBe("rider:R1");
  const k = usageKey({ role: "rider", actorId: null, ip: "203.0.113.9", salt: "s" });
  expect(k).toMatch(/^visitor:[0-9a-f]{16}$/);
  expect(k).not.toContain("203.0.113.9");
  expect(usageKey({ role: "rider", actorId: null, ip: "203.0.113.9", salt: "other" })).not.toBe(k);
});

test("summary of the audit trail: per day, outcomes, gaps; no model tokens reported", () => {
  const now = Date.parse("2026-10-04T12:00:00Z");
  const rows = [
    { created_at: "2026-10-04 11:00:00+00", action: "agent.decision", actor_type: "rider", actor_id: null, metadata: { outcome: "answered_from_knowledge", intent: "policy_question", answer_source: "knowledge" } },
    { created_at: "2026-10-04 11:01:00+00", action: "agent.decision", actor_type: "rider", actor_id: null, metadata: { outcome: "knowledge_gap", knowledge_gap: true, question_excerpt: "What is the cancellation fee?", intent: "policy_question", answer_source: "knowledge" } },
    { created_at: "2026-10-03 09:00:00+00", action: "agent.decision", actor_type: "driver", actor_id: "D1", metadata: { outcome: "answered", authenticated: true, intent: "driver_hours", answer_source: "rules", escalation: null } },
    { created_at: "2026-10-03 09:05:00+00", action: "agent.decision", actor_type: "driver", actor_id: "D1", metadata: { outcome: "human_review_case", authenticated: true, escalation: "emergency", answer_source: "rules" } },
    { created_at: "2026-10-03 10:00:00+00", action: "agent.usage_limited", actor_type: "rider", actor_id: "R9", metadata: { reason: "account_daily_limit" } },
    { created_at: "2026-09-01 10:00:00+00", action: "agent.decision", actor_type: "rider", metadata: {} }
  ];
  const s = summarizeUsage(rows, { days: 7, now });
  expect(s.unit).toBe("assistant_requests");
  expect(s.totals).toEqual({ requests: 4, signed_in_accounts: 1, knowledge_gaps: 1, escalations: 1, model_calls: 0, model_tokens: null });
  expect(s.daily).toHaveLength(7);
  expect(s.daily[6]).toMatchObject({ day: "2026-10-04", requests: 2, rider: 2, answered_from_knowledge: 1, knowledge_gaps: 1 });
  expect(s.daily[5]).toMatchObject({ day: "2026-10-03", requests: 2, driver: 2, signed_in: 2, escalations: 1, limited_accounts: 1 });
  expect(s.recent_gaps).toEqual([{ at: "2026-10-04 11:01:00+00", role: "rider", question: "What is the cancellation fee?" }]);
  expect(utcDay(now)).toBe("2026-10-04");
});
