const { draftSummary, cleanSummary, newHandoffReference, handoffCaseEntry, createHandoffLimiter, MAX_SUMMARY } = require("./handoff");

test("the draft uses only the user's own recent questions", () => {
  const draft = draftSummary({
    context: [
      { role: "user", text: "What is the cancellation fee?" },
      { role: "assistant", text: "I don't have approved Harvey Taxi information..." },
      { role: "user", text: "and for airport rides?" }
    ]
  });
  expect(draft).toBe("I need help from Harvey Taxi support.\n\nWhat I asked the assistant:\n- What is the cancellation fee?\n- and for airport rides?\n\nMore details: ");
  expect(draft).not.toMatch(/approved Harvey Taxi information/);
  expect(draftSummary({ context: "nonsense" })).toBe("I need help from Harvey Taxi support.\n\nMore details: ");
});

test("the approved summary keeps line breaks and masks card numbers, emails and phone numbers", () => {
  const r = cleanSummary("My card 4242 4242 4242 4242 was charged twice.\r\nEmail me at me@example.test or 615-555-0100.\n\n\n\nThanks");
  expect(r.ok).toBe(true);
  expect(r.text).toBe("My card [card] was charged twice.\nEmail me at [email] or [phone].\n\nThanks");
  expect(cleanSummary("short").ok).toBe(false);
  expect(cleanSummary("x".repeat(MAX_SUMMARY + 1)).ok).toBe(false);
  expect(cleanSummary(null).ok).toBe(false);
});

test("references are dated and unambiguous", () => {
  const ref = newHandoffReference(new Date("2026-10-04T12:00:00Z"));
  expect(ref).toMatch(/^HT-SUP-20261004-[2-9A-HJKMNP-Z]{6}$/);
  expect(newHandoffReference()).not.toBe(newHandoffReference());
});

test("the case row fits the existing human-review queue", () => {
  const e = handoffCaseEntry({ reference: "HT-SUP-1", role: "driver", actorId: "D1", summary: "Please call me back about my payout.", appTarget: "driver_ios_app" });
  expect(e).toMatchObject({ action: "agent.case_opened", entity_type: "agent_case", entity_id: "HT-SUP-1" });
  expect(e.metadata).toMatchObject({ category: "support_request", reporter_role: "driver", reporter_id: "D1", source: "handoff", approved_by_user: true, executed: false, app_target: "driver_ios_app" });
});

test("at most 5 requests per account per hour", () => {
  let t = 0;
  const lim = createHandoffLimiter({ now: () => t });
  for (let i = 0; i < 5; i += 1) expect(lim.allow("rider:R1")).toBe(true);
  expect(lim.allow("rider:R1")).toBe(false);
  expect(lim.allow("rider:R2")).toBe(true);
  t = 60 * 60 * 1000 + 1;
  expect(lim.allow("rider:R1")).toBe(true);
});
