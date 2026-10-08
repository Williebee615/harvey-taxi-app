// Specialist agents (lib/agent/specialists.js): hierarchy, switches,
// routing and answers. Test data only.
const sp = require("./specialists");
const { BOOLEAN_FLAG_KEYS, evaluateFlagChange, resolveAgentFlags, resolveAgentMode } = require("./policy");

const ALL_ON = sp.SPECIALIST_FLAG_KEYS.map((key) => ({ key, value: "true" }));
function stateWith(rows, { htafEnabled = false } = {}) {
  const flags = resolveAgentFlags(rows);
  const mode = resolveAgentMode(flags);
  return { flags, mode, isActive: (s) => sp.specialistActive(s, { mode, flags, htafEnabled }) };
}
const ASSIST = [{ key: "agent_assist_enabled", value: "true" }];

describe("hierarchy", () => {
  test("the original agents are the chiefs; every specialist reports to one of them", () => {
    expect(sp.CHIEFS.map((c) => c.name)).toEqual([
      "Harvey Assistant (Rider)",
      "Harvey Assistant (Driver)",
      "Escalation",
      "Support Handoff",
      "Dispatch Recommender",
      "Ride Coordinator",
      "HTAF Information Assistant"
    ]);
    const chiefOf = Object.fromEntries(sp.SPECIALISTS.map((s) => [s.name, sp.chiefById(s.chief).name]));
    expect(chiefOf).toEqual({
      "Safety Escalation": "Escalation",
      "HTAF Information": "HTAF Information Assistant",
      "Food & Grocery Delivery": "Harvey Assistant (Rider)",
      "Driver Support & Onboarding": "Harvey Assistant (Driver)",
      "Customer Support": "Support Handoff",
      "Ride Booking & Dispatch": "Harvey Assistant (Rider)"
    });
    expect(sp.specialistById("ride_booking_dispatch").consults).toEqual(["dispatch_recommender"]);
    // Dispatch Recommender and Ride Coordinator have no specialists.
    expect(sp.SPECIALISTS.filter((s) => ["dispatch_recommender", "ride_coordinator"].includes(s.chief))).toEqual([]);
  });

  test("specialists are labelled as rules or approved content, never an AI model", () => {
    for (const s of sp.SPECIALISTS) {
      expect([s.id, s.engine]).toEqual([s.id, s.id === "htaf_information" ? "approved_content" : "rules"]);
      expect(sp.ENGINE_LABELS[s.engine]).toMatch(/\(no AI model\)$/);
    }
  });

  test("admin view: all off by default", () => {
    const { mode, flags } = stateWith(ASSIST);
    const view = sp.hierarchy({ mode, flags });
    const all = view.flatMap((c) => c.specialists);
    expect(all).toHaveLength(6);
    expect(all.every((s) => s.switched_on === false && s.answering === false)).toBe(true);
    expect(view.find((c) => c.id === "dispatch_recommender").specialists).toEqual([]);
  });
});

describe("switches", () => {
  test("each specialist has its own flag, off unless exactly \"true\"", () => {
    expect(sp.SPECIALIST_FLAG_KEYS).toHaveLength(6);
    for (const key of sp.SPECIALIST_FLAG_KEYS) {
      expect(key).toMatch(/^agent_specialist_[a-z_]+_enabled$/);
      expect(BOOLEAN_FLAG_KEYS).toContain(key);
    }
    const flags = resolveAgentFlags([{ key: sp.SPECIALIST_FLAGS.DELIVERY, value: "yes" }]);
    expect(flags[sp.SPECIALIST_FLAGS.DELIVERY]).toBe(false);
  });

  test("answers only with its own switch, its chief and no stop switch", () => {
    const delivery = sp.specialistById("delivery");
    expect(stateWith(ASSIST).isActive(delivery)).toBe(false);
    expect(stateWith([...ASSIST, ...ALL_ON]).isActive(delivery)).toBe(true);
    // Chief (assistance) off.
    expect(stateWith(ALL_ON).isActive(delivery)).toBe(false);
    // Master stop switch.
    expect(stateWith([...ASSIST, ...ALL_ON, { key: "agent_kill_switch", value: "true" }]).isActive(delivery)).toBe(false);
    // HTAF also needs its own chief's switch.
    const htaf = sp.specialistById("htaf_information");
    expect(stateWith([...ASSIST, ...ALL_ON]).isActive(htaf)).toBe(false);
    expect(stateWith([...ASSIST, ...ALL_ON], { htafEnabled: true }).isActive(htaf)).toBe(true);
  });

  test("switching on needs the elevated admin token; switching off never does", () => {
    for (const key of sp.SPECIALIST_FLAG_KEYS) {
      expect(evaluateFlagChange({ key, enable: true, adminMethod: "password" })).toMatchObject({ ok: false, status: 403 });
      expect(evaluateFlagChange({ key, enable: true, adminMethod: "session" })).toMatchObject({ ok: false, status: 403 });
      expect(evaluateFlagChange({ key, enable: true, adminMethod: "admin_token" })).toEqual({ ok: true, value: "true" });
      expect(evaluateFlagChange({ key, enable: false, adminMethod: "password" })).toEqual({ ok: true, value: "false" });
    }
  });
});

describe("routing", () => {
  const on = stateWith([...ASSIST, ...ALL_ON], { htafEnabled: true });
  const route = (role, message, st = on) => {
    const s = sp.routeSpecialist({ role, message, isActive: st.isActive });
    return s ? s.id : null;
  };

  test("each specialist's questions", () => {
    expect(route("rider", "Where is my ride?")).toBe("ride_booking_dispatch");
    expect(route("rider", "Why is it taking so long to find a driver")).toBe("ride_booking_dispatch");
    expect(route("rider", "Where is my food delivery?")).toBe("delivery");
    expect(route("rider", "What is the delivery PIN for?")).toBe("delivery");
    expect(route("driver", "What documents do I still need for onboarding?")).toBe("driver_support_onboarding");
    expect(route("rider", "I want to talk to a person in customer service")).toBe("customer_support");
    expect(route("driver", "The app is not working")).toBe("customer_support");
    expect(route("rider", "My driver was speeding and texting while driving")).toBe("safety_escalation");
    expect(route("driver", "A rider was harassing me")).toBe("safety_escalation");
    expect(route("rider", "What programs does HTAF offer?")).toBe("htaf_information");
  });

  test("emergencies, fraud, disputes and screening stay with Escalation", () => {
    for (const m of [
      "Someone has a gun, help me",
      "I was in an accident and I'm injured",
      "There is a fraud charge on my card",
      "I was overcharged on my delivery",
      "I want a refund for my ride",
      "Why was my background check rejected?",
      "My account was suspended"
    ]) {
      expect([m, route("rider", m)]).toEqual([m, null]);
      expect([m, route("driver", m)]).toEqual([m, null]);
    }
  });

  test("lost items and policy questions stay with their chiefs", () => {
    expect(route("rider", "I left my phone in the car")).toBe(null);
    expect(route("rider", "What is your cancellation policy?")).toBe(null);
  });

  test("role limits: riders never reach the driver specialist, drivers never reach rider-only ones", () => {
    expect(route("rider", "What documents do I need for onboarding?")).toBe(null);
    expect(route("driver", "Where is my food delivery?")).toBe(null);
    expect(route("driver", "What does HTAF offer?")).toBe(null);
  });

  test("a switched-off specialist doesn't hand its question to another", () => {
    const onlySupport = stateWith([...ASSIST, { key: sp.SPECIALIST_FLAGS.CUSTOMER_SUPPORT, value: "true" }]);
    // Safety concern matches Safety first; it is off, so the chief answers.
    expect(route("rider", "My driver was harassing me, I want support", onlySupport)).toBe(null);
    expect(route("rider", "I want to talk to support", onlySupport)).toBe("customer_support");
  });

  test("all off: nothing is routed", () => {
    const off = stateWith(ASSIST);
    for (const m of ["Where is my ride?", "Where is my delivery?", "support please", "driver was speeding", "HTAF programs"]) {
      expect(route("rider", m, off)).toBe(null);
    }
  });
});

describe("answers", () => {
  function fakeTools(rows) {
    const calls = [];
    return {
      calls,
      async invoke(name, actor, args, trace) {
        calls.push({ name, actor, args });
        trace.push({ tool: name, ok: true });
        return rows[name] || [];
      }
    };
  }
  const rider = { role: "rider", id: "RIDER_1" };
  const run = (id, role, actor, message, tools, extra = {}) =>
    sp.runSpecialist({ specialist: sp.specialistById(id), role, actor, message, tools, ...extra });

  test("delivery: never writes the PIN; cancel is a confirmed button", async () => {
    const tools = fakeTools({
      rider_open_deliveries: [{ id: "TEST-DEL", status: "driver_enroute", ride_type: "food", delivery_stage: "enroute_store", merchant_name: "TEST Kitchen", driver_name: "Dana", delivery_pin: "4321" }]
    });
    const out = await run("delivery", "rider", rider, "Please cancel my delivery", tools);
    expect(out.reply).toMatch(/Your food delivery from TEST Kitchen is driver on the way to the store\./);
    expect(out.reply).toMatch(/give it to the driver only at handoff/i);
    expect(JSON.stringify(out)).not.toMatch(/4321/);
    expect(out.actions.find((a) => a.type === "cancel_ride")).toMatchObject({ requires_confirmation: true, endpoint: "/api/rides/TEST-DEL/cancel", label: "Cancel this delivery" });
    expect(out.source).toBe("rules");
    expect(out.specialist).toEqual({ id: "delivery", name: "Food & Grocery Delivery", chief: "Harvey Assistant (Rider)", engine: "rules", engine_label: "Rules-based (no AI model)" });
    expect(out.decision).toMatchObject({ specialist: "delivery", chief: "harvey_assistant_rider", engine: "rules", executed: false, model_used: false });
    expect(tools.calls.map((c) => c.actor)).toEqual([rider]);
  });

  test("ride booking: Dispatch Recommender's outlook as aggregates only", async () => {
    const tools = fakeTools({
      rider_open_rides: [{ id: "TEST-RIDE", status: "awaiting_driver_acceptance", ride_type: "standard" }],
      rider_dispatch_outlook: [{ drivers_available: false, offers_sent: 2 }]
    });
    const out = await run("ride_booking_dispatch", "rider", rider, "Why is no driver coming?", tools);
    expect(out.reply).toBe(
      "Your ride is being offered to nearby drivers. It has been offered to 2 drivers so far. Right now no available drivers are near your pickup. You can keep waiting, or cancel at no charge."
    );
    expect(out.actions.map((a) => a.type)).toEqual(["open_tracking", "cancel_ride"]);
    expect(tools.calls.map((c) => c.name)).toEqual(["rider_open_rides", "rider_dispatch_outlook"]);
  });

  test("ride booking signed out: booking guidance, no data read", async () => {
    const tools = fakeTools({});
    const out = await run("ride_booking_dispatch", "rider", null, "I need a ride", tools);
    expect(out.reply).toMatch(/^You can book in the Harvey Taxi booking screen/);
    expect(tools.calls).toEqual([]);
  });

  test("driver onboarding: own checklist; decisions stay with staff", async () => {
    const tools = fakeTools({ driver_onboarding_status: [{ ready: false, checks: { email_verified: true, phone_verified: false, persona_verified: true, checkr_ready: true, vehicle_present: false } }] });
    const out = await run("driver_support_onboarding", "driver", { role: "driver", id: "DRIVER_1" }, "what's left for onboarding", tools, { client: "driver_app" });
    expect(out.reply).toMatch(/^Still needed before you can go online: Phone verified, Vehicle details on file\./);
    expect(out.reply).toMatch(/decisions are made by Harvey Taxi staff/);
    expect(out.actions.map((a) => a.type)).toEqual(["support_handoff", "open_support"]);
  });

  test("customer support and safety: nothing is sent without the user's approval", async () => {
    const support = await run("customer_support", "rider", rider, "talk to support", fakeTools({}));
    expect(support.actions[0]).toMatchObject({ type: "support_handoff", requires_confirmation: true });
    expect(support.escalation).toBe(null);
    const safety = await run("safety_escalation", "rider", rider, "my driver was speeding", fakeTools({}));
    expect(safety.reply).toMatch(/^I'm sorry that happened\. If anyone is in danger now, call 911\./);
    expect(safety.actions).toEqual([
      { type: "call_911", label: "Call 911", href: "tel:911" },
      { type: "support_handoff", label: "Report to the safety team", requires_confirmation: true }
    ]);
    expect(safety.escalation).toBe(null);
  });

  test("HTAF: the HTAF assistant's approved answer, same-origin links only", async () => {
    const htaf = {
      answer: () => ({
        reply: "From the HTAF home page: approved text.",
        intent: "approved_information",
        sources: [{ title: "HTAF home page", section: "Programs", url: "/" }],
        actions: [{ type: "link", label: "Open the application", href: "/htaf-application.html" }, { type: "link", label: "Email", href: "mailto:x@example.test" }],
        knowledge_gap: false
      })
    };
    const out = await run("htaf_information", "rider", null, "HTAF programs", fakeTools({}), { htaf });
    expect(out.reply).toBe("From the HTAF home page: approved text.");
    expect(out.source).toBe("approved_content");
    expect(out.actions).toEqual([{ type: "open_link", label: "Open the application", href: "/htaf-application.html" }]);
    expect(out.specialist.engine_label).toBe("Approved published content only (no AI model)");
  });

  test("data unavailable: says so, never guesses", async () => {
    const tools = { invoke: async () => { const e = new Error("down"); e.status = 503; throw e; } };
    const out = await run("delivery", "rider", rider, "where is my delivery", tools);
    expect(out.reply).toBe("I can't reach that information right now. Your dashboard still shows your live status.");
    expect(out.decision.outcome).toBe("data_unavailable");
  });
});
