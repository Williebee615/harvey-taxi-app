const {
  createFeedbackSigner,
  feedbackEntry,
  summarizeFeedback,
  cleanConversationId,
  newAnswerId,
  TOKEN_TTL_MS
} = require("./feedback");

const NOW = Date.parse("2026-10-19T12:00:00Z");
const signer = createFeedbackSigner("test-secret");
const CONV_A = "c_AAAAAAAAAAAAAAAAAAAA";
const CONV_B = "c_BBBBBBBBBBBBBBBBBBBB";

describe("feedback tokens", () => {
  test("no secret, no signer", () => {
    expect(createFeedbackSigner("")).toBeNull();
  });

  test("a token round-trips and carries no message text", () => {
    const token = signer.issue({ answerId: "ans_1", role: "rider", actorId: "RIDER_1", intent: "ride_status", source: "rules", appTarget: "rider_web", conversationId: CONV_A, now: NOW });
    const { payload } = signer.verify(token, { now: NOW + 1000 });
    expect(payload).toMatchObject({ a: "ans_1", r: "rider", u: "RIDER_1", i: "ride_status", s: "rules", t: "rider_web", c: CONV_A });
    expect(Object.keys(payload).sort()).toEqual(["a", "c", "i", "iat", "r", "s", "t", "u"]);
  });

  test("a changed payload, another key, or an old token is refused", () => {
    const token = signer.issue({ answerId: "ans_1", role: "rider", actorId: "RIDER_1", now: NOW });
    const [body, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), u: "RIDER_2" })).toString("base64url");
    expect(signer.verify(`${forged}.${mac}`, { now: NOW }).error).toBe("invalid");
    expect(createFeedbackSigner("other").verify(token, { now: NOW }).error).toBe("invalid");
    expect(signer.verify(token, { now: NOW + TOKEN_TTL_MS + 1 }).error).toBe("expired");
    expect(signer.verify("nonsense", { now: NOW }).error).toBe("invalid");
    expect(signer.verify(undefined, { now: NOW }).error).toBe("invalid");
  });

  test("a malformed conversation id is dropped", () => {
    expect(cleanConversationId("c_short")).toBeNull();
    expect(cleanConversationId("c_<script>AAAAAAAAAAAAAA")).toBeNull();
    expect(cleanConversationId(CONV_A)).toBe(CONV_A);
    expect(newAnswerId()).toMatch(/^ans_[0-9a-f]{24}$/);
  });

  test("the rating row has no message text", () => {
    const { payload } = signer.verify(signer.issue({ answerId: "ans_9", role: "driver", actorId: "DRIVER_1", intent: "earnings", source: "model", appTarget: "driver_web", now: NOW }), { now: NOW });
    expect(feedbackEntry(payload, "down")).toEqual({
      actor_type: "driver",
      actor_id: "DRIVER_1",
      action: "agent.feedback",
      entity_type: "agent_answer",
      entity_id: "ans_9",
      metadata: { record_type: "assistance_feedback", rating: "down", intent: "earnings", answer_source: "model", app_target: "driver_web", conversation_id: null, authenticated: true }
    });
  });
});

describe("summary", () => {
  const at = (h) => `2026-10-19T${String(h).padStart(2, "0")}:00:00.000Z`;
  const answer = (h, conv, extra = {}) => ({ created_at: at(h), action: "agent.decision", metadata: { record_type: "assistance_answer", conversation_id: conv, escalation: null, ...extra } });
  const rating = (h, id, value, source = "rules") => ({ created_at: at(h), action: "agent.feedback", entity_id: id, metadata: { record_type: "assistance_feedback", rating: value, intent: "fare", answer_source: source, app_target: "rider_web" } });

  test("chats with a case or a support request need staff; the rest are resolved; untracked answers aren't counted as resolved", () => {
    const rows = [
      answer(1, CONV_A),
      answer(2, CONV_A),
      answer(3, CONV_B),
      { created_at: at(4), action: "agent.case_opened", metadata: { source: "handoff", conversation_id: CONV_B } },
      answer(5, "c_CCCCCCCCCCCCCCCCCCCC", { escalation: "emergency" }),
      answer(6, null),
      { created_at: at(6), action: "agent.case_opened", metadata: { source: "assist" } }
    ];
    const s = summarizeFeedback(rows, { days: 7, now: new Date(NOW) });
    expect(s.totals).toMatchObject({ answers: 5, untracked_answers: 1, conversations: 3, needed_staff: 2, resolved_without_staff: 1, resolved_without_staff_rate: 33.3 });
    expect(s.daily).toHaveLength(7);
    expect(s.daily[6]).toMatchObject({ day: "2026-10-19", conversations: 3 });
  });

  test("one rating per answer, latest wins; satisfaction and per-source counts", () => {
    const rows = [answer(1, CONV_A), answer(2, CONV_A), rating(3, "ans_1", "down"), rating(4, "ans_1", "up"), rating(5, "ans_2", "down", "model"), rating(5, "ans_3", "sideways")];
    const s = summarizeFeedback(rows, { days: 7, now: new Date(NOW) });
    expect(s.totals).toMatchObject({ ratings: 2, thumbs_up: 1, thumbs_down: 1, satisfaction_rate: 50, rated_share: 100 });
    expect(s.by_source).toEqual({ rules: { up: 1, down: 0 }, model: { up: 0, down: 1 } });
    expect(s.recent_down).toEqual([{ at: at(5), intent: "fare", answer_source: "model", app_target: "rider_web" }]);
  });

  test("nothing recorded: zeros and no rates", () => {
    const s = summarizeFeedback([], { days: 7, now: new Date(NOW) });
    expect(s.totals).toMatchObject({ answers: 0, conversations: 0, resolved_without_staff_rate: null, satisfaction_rate: null, rated_share: null });
  });
});
