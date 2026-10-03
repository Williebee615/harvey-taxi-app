const dc = require("./dataCollection");

describe("feature gates", () => {
  test("everything is off when no flag rows exist", () => {
    expect(dc.resolveProgramGates({})).toEqual({ program: false, enrollment: false, collection: false });
  });

  test("enrollment and collection never open without the master switch", () => {
    expect(
      dc.resolveProgramGates({
        [dc.FLAGS.enrollment]: "true",
        [dc.FLAGS.collection]: "true"
      })
    ).toEqual({ program: false, enrollment: false, collection: false });
  });

  test("each gate opens independently once the program is on; only the string 'true' counts", () => {
    expect(dc.resolveProgramGates({ [dc.FLAGS.program]: "true" })).toEqual({ program: true, enrollment: false, collection: false });
    expect(
      dc.resolveProgramGates({ [dc.FLAGS.program]: "TRUE", [dc.FLAGS.enrollment]: "true", [dc.FLAGS.collection]: "yes" })
    ).toEqual({ program: true, enrollment: true, collection: false });
  });
});

describe("earnings math (integer cents, half-up, per record)", () => {
  test("rates are $10 driver and $15 company per accepted hour", () => {
    expect(dc.RATES).toEqual({ driverCentsPerHour: 1000, companyCentsPerHour: 1500 });
  });

  test("one hour: $10.00 driver, $15.00 company, $5.00 margin", () => {
    expect(dc.computeRecordAmounts(3600)).toEqual({
      driver_rate_cents: 1000,
      company_rate_cents: 1500,
      driver_amount_cents: 1000,
      company_amount_cents: 1500,
      margin_cents: 500
    });
  });

  test("fractions of a cent round half-up, on exact integer arithmetic", () => {
    // 9 s x 1000 / 3600 = 2.5 cents -> 3; x 1500 = 3.75 -> 4
    expect(dc.computeRecordAmounts(9)).toMatchObject({ driver_amount_cents: 3, company_amount_cents: 4, margin_cents: 1 });
    // 1 s: 0.277.. -> 0 and 0.416.. -> 0
    expect(dc.computeRecordAmounts(1)).toMatchObject({ driver_amount_cents: 0, company_amount_cents: 0, margin_cents: 0 });
    // 61 s: 16.94 -> 17, 25.41 -> 25
    expect(dc.computeRecordAmounts(61)).toMatchObject({ driver_amount_cents: 17, company_amount_cents: 25, margin_cents: 8 });
    // 24 h maximum: $240 / $360
    expect(dc.computeRecordAmounts(86400)).toMatchObject({ driver_amount_cents: 24000, company_amount_cents: 36000 });
  });

  test("driver + margin always equals company, for every duration up to 2 hours", () => {
    for (let s = 1; s <= 7200; s += 1) {
      const a = dc.computeRecordAmounts(s);
      expect(a.driver_amount_cents + a.margin_cents).toBe(a.company_amount_cents);
      expect(a.driver_amount_cents).toBe(Math.floor((s * 1000 + 1800) / 3600));
    }
  });

  test("rejects non-integer, zero, negative and over-24-hour durations", () => {
    for (const bad of [0, -1, 1.5, 86401, NaN, "60"]) {
      expect(() => dc.computeRecordAmounts(bad)).toThrow();
    }
  });

  test("summaries add stored per-record cents and keep statuses separate", () => {
    const rec = (status, seconds) => ({ status, duration_seconds: seconds, ...dc.computeRecordAmounts(seconds) });
    const records = [rec("pending", 1800), rec("accepted", 3600), rec("payable", 61), rec("paid", 9), rec("rejected", 7200)];
    const driverView = dc.summarizeHours(records);
    expect(driverView.by_status.pending).toEqual({ count: 1, seconds: 1800, driver_cents: 500 });
    expect(driverView.by_status.rejected).toEqual({ count: 1, seconds: 7200, driver_cents: 2000 });
    expect(driverView.accepted_seconds).toBe(3600 + 61 + 9);
    expect(driverView.estimated_earnings_cents).toBe(1000 + 17 + 3);
    expect(driverView.unpaid_earnings_cents).toBe(1000 + 17);
    expect(driverView.payable_cents).toBe(17);
    expect(driverView.paid_cents).toBe(3);
    expect(driverView.pending_hours).toBe(0.5);
    expect(driverView.payment_status).toBe("payment_scheduled");
    // Company rate and margin are internal: never in the driver view.
    expect(JSON.stringify(driverView)).not.toMatch(/company|margin/);

    const adminView = dc.summarizeHours(records, { includeCompany: true });
    expect(adminView.company_revenue_cents).toBe(1500 + 25 + 4);
    expect(adminView.gross_margin_cents).toBe(500 + 8 + 1);
  });

  test("formatCents never goes through floating point", () => {
    expect(dc.formatCents(0)).toBe("$0.00");
    expect(dc.formatCents(1017)).toBe("$10.17");
    expect(dc.formatCents(-5)).toBe("-$0.05");
  });
});

describe("hour record transitions", () => {
  test.each([
    ["pending", "accepted"],
    ["pending", "rejected"],
    ["accepted", "payable"],
    ["accepted", "rejected"],
    ["payable", "paid"],
    ["payable", "accepted"],
    ["rejected", "pending"]
  ])("%s -> %s is allowed", (from, to) => {
    expect(dc.validateHourTransition({ from, to, reason: "why", payoutReference: "ACH-1" }).ok).toBe(true);
  });

  test.each([
    ["pending", "paid"],
    ["pending", "payable"],
    ["paid", "accepted"],
    ["paid", "rejected"],
    ["rejected", "accepted"]
  ])("%s -> %s is refused", (from, to) => {
    expect(dc.validateHourTransition({ from, to, reason: "why", payoutReference: "ACH-1" }).ok).toBe(false);
  });

  test("rejecting needs a reason and paying needs a payout reference", () => {
    expect(dc.validateHourTransition({ from: "pending", to: "rejected" }).ok).toBe(false);
    expect(dc.validateHourTransition({ from: "payable", to: "paid" }).ok).toBe(false);
  });

  test("payable/paid are payout decisions; the rest are hour reviews", () => {
    expect(dc.capabilityForHourTransition("paid")).toBe("data_collection.payouts.manage");
    expect(dc.capabilityForHourTransition("payable")).toBe("data_collection.payouts.manage");
    expect(dc.capabilityForHourTransition("accepted")).toBe("data_collection.hours.manage");
  });
});

describe("driver eligibility and applications", () => {
  const approved = { id: "D1", approval_status: "approved" };

  test("ordinary driver approval is required to apply", () => {
    expect(dc.evaluateDriverEligibility(approved)).toEqual({ eligible: true, reasons: [] });
    expect(dc.evaluateDriverEligibility({ ...approved, approval_status: "pending" }).reasons).toContain("driver_not_approved");
    expect(dc.evaluateDriverEligibility({ ...approved, access_revoked: true }).eligible).toBe(false);
    expect(dc.evaluateDriverEligibility({ ...approved, is_blocked: true }).eligible).toBe(false);
    expect(dc.evaluateDriverEligibility({ ...approved, is_review_account: true }).eligible).toBe(false);
  });

  const valid = {
    phone_model: "iPhone 15",
    country: "us",
    proposed_location: "Harvey Taxi office lobby, Nashville",
    location_state: "tn",
    proposed_tasks: ["Restocking shelves", "  Folding laundry  "],
    ineligible_tasks_acknowledged: true
  };

  test("a valid application is normalized", () => {
    const r = dc.validateApplicationInput(valid);
    expect(r.ok).toBe(true);
    expect(r.application).toMatchObject({ country: "US", location_state: "TN", proposed_tasks: ["Restocking shelves", "Folding laundry"] });
    expect(r.application.task_review_flags).toEqual([]);
  });

  test("U.S. only", () => {
    for (const country of ["CA", "MX", "", "USA"]) {
      expect(dc.validateApplicationInput({ ...valid, country }).ok).toBe(false);
    }
    expect(dc.validateApplicationInput({ ...valid, location_state: "ON" }).ok).toBe(false);
    expect(dc.validateApplicationInput({ ...valid, location_state: "TNX" }).ok).toBe(false);
  });

  test("the ineligible-task acknowledgement must be an explicit true", () => {
    expect(dc.validateApplicationInput({ ...valid, ineligible_tasks_acknowledged: "true" }).ok).toBe(false);
    expect(dc.validateApplicationInput({ ...valid, ineligible_tasks_acknowledged: undefined }).ok).toBe(false);
  });

  test("tasks that look like driving, seated or repetitive work are flagged for the reviewer", () => {
    const r = dc.validateApplicationInput({
      ...valid,
      proposed_tasks: ["Recording while driving to pickups", "Sitting at a desk sorting mail", "Repetitive box taping", "Sweeping the driveway"]
    });
    expect(r.ok).toBe(true);
    expect(r.application.task_review_flags).toEqual([
      { task_index: 0, category: "driving" },
      { task_index: 1, category: "seated" },
      { task_index: 2, category: "repetitive" }
    ]);
  });

  test("required fields and task limits", () => {
    expect(dc.validateApplicationInput({}).errors.length).toBeGreaterThanOrEqual(5);
    expect(dc.validateApplicationInput({ ...valid, proposed_tasks: ["a", "b", "c", "d", "e", "f"] }).ok).toBe(false);
  });

  test("application transitions", () => {
    expect(dc.validateApplicationTransition({ from: "submitted", to: "approved" }).ok).toBe(true);
    expect(dc.validateApplicationTransition({ from: "approved", to: "suspended" }).ok).toBe(false); // reason needed
    expect(dc.validateApplicationTransition({ from: "approved", to: "suspended", reason: "Equipment not returned" }).ok).toBe(true);
    expect(dc.validateApplicationTransition({ from: "suspended", to: "approved" }).ok).toBe(true);
    expect(dc.validateApplicationTransition({ from: "rejected", to: "approved" }).ok).toBe(false);
    expect(dc.validateApplicationTransition({ from: "withdrawn", to: "approved" }).ok).toBe(false);
  });
});

describe("organization code access", () => {
  const gatesOn = { program: true, enrollment: true, collection: true };
  const signed = [
    { agreement_type: "contributor_agreement", status: "signed", signed_at: "2026-10-01", document_version: "v1", recorded_at: "2026-10-01T00:00:00Z" },
    { agreement_type: "recording_consent", status: "signed", signed_at: "2026-10-01", document_version: "v1", recorded_at: "2026-10-01T00:00:00Z" }
  ];
  const approvedApp = { status: "approved" };

  test("allowed only when every condition holds", () => {
    expect(
      dc.evaluateOrganizationCodeAccess({ gates: gatesOn, application: approvedApp, agreementRows: signed, organizationCode: "ORG-1" })
    ).toEqual({ allowed: true, reasons: [] });
  });

  test.each([
    ["program off", { gates: { program: false, enrollment: false, collection: false } }, "program_disabled"],
    ["collection off", { gates: { ...gatesOn, collection: false } }, "collection_disabled"],
    ["application only submitted", { application: { status: "submitted" } }, "not_program_approved"],
    ["application suspended", { application: { status: "suspended" } }, "not_program_approved"],
    ["no application", { application: null }, "not_program_approved"],
    ["an agreement missing", { agreementRows: signed.slice(0, 1) }, "agreements_incomplete"],
    ["consent revoked later", { agreementRows: [...signed, { agreement_type: "recording_consent", status: "revoked", recorded_at: "2026-10-02T00:00:00Z" }] }, "agreements_incomplete"],
    ["code not configured", { organizationCode: "" }, "code_not_configured"]
  ])("denied when %s", (_label, override, reason) => {
    const result = dc.evaluateOrganizationCodeAccess({
      gates: gatesOn,
      application: approvedApp,
      agreementRows: signed,
      organizationCode: "ORG-1",
      ...override
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain(reason);
  });

  test("download links must be https", () => {
    expect(dc.safeHttpsUrl("https://apps.example.test/minute")).toBe("https://apps.example.test/minute");
    expect(dc.safeHttpsUrl("http://apps.example.test/minute")).toBeNull();
    expect(dc.safeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(dc.safeHttpsUrl("")).toBeNull();
  });
});

describe("duration and date parsing", () => {
  test.each([
    ["3600", "seconds", 3600],
    ["90.5", "seconds", 91],
    ["90.4", "seconds", 90],
    ["45", "minutes", 2700],
    ["0.5", "minutes", 30],
    ["1.25", "hours", 4500],
    ["0.1", "hours", 360],
    ["0.333333", "hours", 1200],
    ["1:30", "hms", 5400],
    ["1:02:03", "hms", 3723],
    ["0:00:01", "hms", 1]
  ])("%s %s = %d seconds", (value, unit, seconds) => {
    expect(dc.parseDurationToSeconds(value, unit)).toEqual({ ok: true, seconds });
  });

  test.each([
    ["", "seconds"],
    ["-5", "seconds"],
    ["0", "minutes"],
    ["1e3", "seconds"],
    ["1,5", "hours"],
    ["25", "hours"],
    ["1:60", "hms"],
    ["abc", "hms"],
    ["10", "fortnights"]
  ])("%s %s is refused", (value, unit) => {
    expect(dc.parseDurationToSeconds(value, unit).ok).toBe(false);
  });

  test("only unambiguous ISO dates", () => {
    expect(dc.parseSessionDate("2026-09-30")).toEqual({ ok: true, date: "2026-09-30" });
    expect(dc.parseSessionDate("2026-09-30T14:05:00Z")).toEqual({ ok: true, date: "2026-09-30" });
    expect(dc.parseSessionDate("09/30/2026").ok).toBe(false);
    expect(dc.parseSessionDate("2026-02-30").ok).toBe(false);
  });
});

describe("CSV parsing", () => {
  test("quotes, doubled quotes, embedded commas and newlines, CRLF, BOM", () => {
    const text = '﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n2,"multi\nline",\n\n';
    expect(dc.parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["1", "x, y", 'say "hi"'],
      ["2", "multi\nline", ""]
    ]);
  });

  test("an unterminated quote is an error, not a silent truncation", () => {
    expect(() => dc.parseCsv('a,b\n1,"oops')).toThrow(/unterminated/);
  });
});

describe("import preview", () => {
  const mapping = {
    contributor_id: "Contributor",
    session_id: "Session",
    session_date: "Date",
    duration: "Seconds",
    duration_unit: "seconds"
  };
  const applications = [
    { id: "APP-1", driver_id: "D1", status: "approved", minute_contributor_id: "C-100" },
    { id: "APP-2", driver_id: "D2", status: "suspended", minute_contributor_id: "c-200" },
    { id: "APP-3", driver_id: "D3", status: "rejected", minute_contributor_id: "C-300" }
  ];
  const csv = [
    "Contributor,Session,Date,Seconds",
    "C-100,S-1,2026-09-30,3600",
    "C-200,S-2,2026-09-30,61",
    "C-100,S-OLD,2026-09-29,100",
    "C-100,S-1,2026-09-30,3600",
    "C-999,S-3,2026-09-30,600",
    "C-300,S-4,2026-09-30,600",
    "C-100,S-5,09/30/2026,600",
    "C-100,S-6,2026-09-30,0"
  ].join("\n");

  const preview = () =>
    dc.buildImportPreview({ csvText: csv, mapping, applications, existingSessionIds: ["s-old"] });

  test("classifies every row", () => {
    const p = preview();
    expect(p.ok).toBe(true);
    expect(p.rows.map((r) => [r.row_number, r.outcome])).toEqual([
      [2, "ready"],
      [3, "ready"],
      [4, "duplicate_existing"],
      [5, "duplicate_in_file"],
      [6, "unmatched_contributor"],
      [7, "inactive_participant"],
      [8, "invalid"],
      [9, "invalid"]
    ]);
    expect(p.summary).toMatchObject({
      total_rows: 8,
      ready: 2,
      duplicate_existing: 1,
      duplicate_in_file: 1,
      unmatched_contributor: 1,
      inactive_participant: 1,
      invalid: 2,
      ready_seconds: 3661,
      ready_driver_cents: 1017,
      ready_company_cents: 1525,
      ready_margin_cents: 508
    });
    expect(p.can_commit).toBe(false); // invalid rows block the commit
  });

  test("contributor matching is case-insensitive and records carry rate snapshots", () => {
    const p = preview();
    expect(p.records.map((r) => [r.external_session_id, r.driver_id, r.application_id])).toEqual([
      ["S-1", "D1", "APP-1"],
      ["S-2", "D2", "APP-2"]
    ]);
    expect(p.records[1]).toMatchObject({ duration_seconds: 61, driver_amount_cents: 17, company_amount_cents: 25, driver_rate_cents: 1000 });
    expect(p.exceptions.map((e) => [e.external_session_id, e.reason])).toEqual([
      ["S-3", "unmatched_contributor"],
      ["S-4", "inactive_participant"]
    ]);
  });

  test("the digest is stable for the same inputs and changes when the stored data changes", () => {
    expect(preview().preview_digest).toBe(preview().preview_digest);
    const after = dc.buildImportPreview({ csvText: csv, mapping, applications, existingSessionIds: ["s-old", "s-1"] });
    expect(after.preview_digest).not.toBe(preview().preview_digest);
  });

  test("a clean file can be committed", () => {
    const clean = csv.split("\n").slice(0, 3).join("\n");
    const p = dc.buildImportPreview({ csvText: clean, mapping, applications, existingSessionIds: [] });
    expect(p.can_commit).toBe(true);
    expect(p.summary.ready).toBe(2);
  });

  test("mapping must name real columns and a known unit; no Minute column names are assumed", () => {
    const p = dc.buildImportPreview({ csvText: csv, mapping: {}, applications, existingSessionIds: [] });
    expect(p.ok).toBe(false);
    expect(p.headers).toEqual(["Contributor", "Session", "Date", "Seconds"]);
    const wrong = dc.buildImportPreview({ csvText: csv, mapping: { ...mapping, duration: "Minutes" }, applications, existingSessionIds: [] });
    expect(wrong.ok).toBe(false);
    expect(wrong.errors.join(" ")).toMatch(/"Minutes"/);
  });

  test("empty, header-only and oversized files are refused", () => {
    expect(dc.buildImportPreview({ csvText: "", mapping }).ok).toBe(false);
    expect(dc.buildImportPreview({ csvText: "Contributor,Session,Date,Seconds", mapping }).ok).toBe(false);
    const rows = ["Contributor,Session,Date,Seconds"];
    for (let i = 0; i <= dc.MAX_IMPORT_ROWS; i += 1) rows.push(`C-100,S-${i},2026-09-30,60`);
    expect(dc.buildImportPreview({ csvText: rows.join("\n"), mapping, applications }).ok).toBe(false);
  });
});

describe("manual entry", () => {
  test("requires the Minute session id, an ISO date, a duration and a reason", () => {
    expect(dc.validateManualEntry({}).ok).toBe(false);
    const r = dc.validateManualEntry({
      external_session_id: "S-77",
      session_date: "2026-09-30",
      duration: "1:15:00",
      reason: "Copied from Minute portal pending sample export"
    });
    expect(r).toEqual({
      ok: true,
      entry: { external_session_id: "S-77", session_date: "2026-09-30", duration_seconds: 4500, reason: "Copied from Minute portal pending sample export" }
    });
  });
});

describe("re-importing a file", () => {
  test("sessions already flagged by an earlier import are reported but not flagged twice", () => {
    const csv = ["Contributor,Session,Date,Seconds", "C-999,S-3,2026-09-30,600", "C-998,S-9,2026-09-30,600"].join("\n");
    const p = dc.buildImportPreview({
      csvText: csv,
      mapping: { contributor_id: "Contributor", session_id: "Session", session_date: "Date", duration: "Seconds", duration_unit: "seconds" },
      applications: [],
      existingSessionIds: [],
      openExceptionSessionIds: ["s-3"]
    });
    expect(p.rows.map((r) => [r.session_id, r.outcome, r.already_flagged])).toEqual([
      ["S-3", "unmatched_contributor", true],
      ["S-9", "unmatched_contributor", false]
    ]);
    expect(p.exceptions.map((e) => e.external_session_id)).toEqual(["S-9"]);
  });
});
