const { HARVEY_AI_SYSTEM_PROMPT } = require("./harveyAiSystemPrompt");

// A crude but effective net for "did someone accidentally type a dollar
// figure into the prompt" — matches $12, $12.50, $1,200, etc.
const DOLLAR_AMOUNT_PATTERN = /\$\d/;

// Matches concrete time windows like "24 hours", "3-5 business days",
// "2 weeks" — the kind of thing that would silently reintroduce a
// timeline the Approved Knowledge doesn't actually have.
const CONCRETE_TIMEFRAME_PATTERN =
  /\b\d+\s*(-|to)?\s*\d*\s*(hour|day|week|business day)s?\b/i;

// Matches a US-style phone number.
const PHONE_NUMBER_PATTERN = /\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/;

describe("Harvey AI system prompt — food, grocery, and Autonomous Pilot are live features", () => {
  it("describes food delivery as available now, not planned/unavailable", () => {
    expect(HARVEY_AI_SYSTEM_PROMPT).toMatch(/food delivery/i);
    expect(HARVEY_AI_SYSTEM_PROMPT).toMatch(/Available now:.*food delivery/i);
  });

  it("describes grocery delivery as available now, not planned/unavailable", () => {
    expect(HARVEY_AI_SYSTEM_PROMPT).toMatch(/Available now:.*grocery delivery/i);
  });

  it("does not list food or grocery delivery under the planned/not-available section", () => {
    const plannedLine = HARVEY_AI_SYSTEM_PROMPT
      .split("\n")
      .find((line) => /^Planned \/ in development/i.test(line));

    expect(plannedLine).toBeDefined();
    expect(plannedLine).not.toMatch(/food delivery/i);
    expect(plannedLine).not.toMatch(/grocery delivery/i);
    expect(plannedLine).not.toMatch(/autonomous pilot/i);
  });

  it("describes Autonomous Pilot as a real, opt-in pilot program with eligibility/zone rules, not unavailable", () => {
    expect(HARVEY_AI_SYSTEM_PROMPT).toMatch(/Autonomous Pilot exists in the app/i);
    expect(HARVEY_AI_SYSTEM_PROMPT).toMatch(/eligibility and zone rules/i);
    expect(HARVEY_AI_SYSTEM_PROMPT).not.toMatch(
      /Autonomous Pilot.*(not available|does not exist|planned for the future)/i
    );
  });
});

describe("Harvey AI system prompt — pricing questions never invent a number", () => {
  it("instructs never quoting a fare, price, or earnings figure", () => {
    expect(HARVEY_AI_SYSTEM_PROMPT).toMatch(/Never quote a fare, price, earnings figure/i);
  });

  it("contains the rider-pricing safe-default verbatim", () => {
    expect(HARVEY_AI_SYSTEM_PROMPT).toContain(
      "\"For current pricing and ride details, please check the app or contact support.\""
    );
  });

  it("contains no literal dollar figure anywhere in the prompt", () => {
    expect(HARVEY_AI_SYSTEM_PROMPT).not.toMatch(DOLLAR_AMOUNT_PATTERN);
  });
});

describe("Harvey AI system prompt — HTAF approval questions never promise approval", () => {
  it("contains the HTAF approval safe-default verbatim", () => {
    expect(HARVEY_AI_SYSTEM_PROMPT).toContain(
      "\"Your application will be reviewed by the Harvey Transportation Assistance Foundation.\""
    );
  });

  it("explicitly forbids implying approval for HTAF, driver, or rider applications", () => {
    expect(HARVEY_AI_SYSTEM_PROMPT).toMatch(/Never promise or imply approval/i);
    expect(HARVEY_AI_SYSTEM_PROMPT).toMatch(/you're approved/i);
  });
});

describe("Harvey AI system prompt — application timeline questions never invent a timeframe", () => {
  it("states no HTAF review timeline is provided and instructs never stating one", () => {
    expect(HARVEY_AI_SYSTEM_PROMPT).toMatch(
      /Review timeline: not provided — never state one/i
    );
  });

  it("contains the general never-state-a-timeline constraint", () => {
    expect(HARVEY_AI_SYSTEM_PROMPT).toMatch(
      /Never state a timeline \(review time, approval time, launch date\)/i
    );
  });

  it("contains no concrete time window anywhere in the prompt", () => {
    expect(HARVEY_AI_SYSTEM_PROMPT).not.toMatch(CONCRETE_TIMEFRAME_PATTERN);
  });
});

describe("Harvey AI system prompt — official websites are correct, other unknowns stay unknown", () => {
  it("states the real Harvey Taxi Service website", () => {
    expect(HARVEY_AI_SYSTEM_PROMPT).toMatch(/Website: harveytaxiservice\.com/);
  });

  it("states the real HTAF website", () => {
    expect(HARVEY_AI_SYSTEM_PROMPT).toMatch(/Website: harveytransportationfoundation\.com/);
  });

  it("does not claim the website is unknown/not provided anymore", () => {
    // [^.]* (not .*) so this only checks within the same sentence as
    // "Website" — otherwise it false-positives on lines like "Website:
    // harveytaxiservice.com. Customer support phone: not provided."
    // where an unrelated "not provided" appears later in the same line.
    expect(HARVEY_AI_SYSTEM_PROMPT).not.toMatch(/Website[^.]*not provided/i);
  });

  it("still does not invent a phone number or business hours", () => {
    expect(HARVEY_AI_SYSTEM_PROMPT).toMatch(/Customer support phone: not provided/i);
    expect(HARVEY_AI_SYSTEM_PROMPT).toMatch(/Business hours: not provided/i);
    expect(HARVEY_AI_SYSTEM_PROMPT).not.toMatch(PHONE_NUMBER_PATTERN);
  });

  it("still does not invent donation links or a partnership process", () => {
    expect(HARVEY_AI_SYSTEM_PROMPT).toMatch(/Donation links: not provided/i);
    expect(HARVEY_AI_SYSTEM_PROMPT).toMatch(/How to initiate a partnership: not provided/i);
  });
});

describe("Harvey AI system prompt — tool-calling wiring is preserved", () => {
  it("still documents all three tools by name", () => {
    expect(HARVEY_AI_SYSTEM_PROMPT).toMatch(/lookup_htaf_status/);
    expect(HARVEY_AI_SYSTEM_PROMPT).toMatch(/lookup_ride_status/);
    expect(HARVEY_AI_SYSTEM_PROMPT).toMatch(/open_ride_workflow/);
  });

  it("still instructs never claiming a ride/order is booked, dispatched, or paid for", () => {
    expect(HARVEY_AI_SYSTEM_PROMPT).toMatch(
      /NEVER say the ride or order has been booked/i
    );
  });
});
