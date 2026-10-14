// HTAF review assistant rules (lib/htafReviewAssist.js) on synthetic
// applications only: complete, incomplete, misspelled or out-of-state
// county, past dates, duplicates. The output is advisory, internal and
// free of applicant details.
const fs = require("fs");
const path = require("path");
const r = require("./htafReviewAssist");

const TODAY = "2026-10-13";
const COMPLETE = Object.freeze({
  id: "HTAF-SYN-1",
  application_code: "HTAF-20261010-SYN001",
  first_name: "Synthia",
  last_name: "Testperson",
  email: "synthia.test@example.test",
  phone: "6155550199",
  county: "Davidson County",
  city: "Nashville",
  pickup_city: "Antioch",
  destination: "Synthetic Dialysis Center, 100 Example Way",
  ride_date: "2026-10-20",
  transportation_need: "Dialysis appointments three times a week; no car since July.",
  program_type: "medical",
  applicant_type: "self",
  status: "submitted",
  household_size: 4,
  monthly_income: 1234.56,
  notes: "Staff note: spoke with caseworker Jane Example",
  review_notes: "Internal review note",
  submitted_at: "2026-10-10T15:00:00Z"
});
const review = (patch = {}, opts = {}) => r.reviewApplication({ ...COMPLETE, ...patch }, { today: TODAY, ...opts });
const ids = (out) => out.checks.map((c) => c.id);

describe("synthetic applications", () => {
  test("complete application: a factual summary and nothing flagged", () => {
    const out = review();
    expect(out.checks).toEqual([]);
    expect(out.follow_up_questions).toEqual([]);
    expect(out.summary).toBe(
      "Medical transportation request, applying for themselves. Ride date 2026-10-20 (in 7 days, Central time). County: Davidson, within HTAF's stated Tennessee coverage. Coverage does not confirm funding, a ride, eligibility or approval. Trip description: provided. Status: Submitted, received 3 days ago. No missing information found by the rules."
    );
  });

  test("incomplete application: every gap is listed with a follow-up question", () => {
    const out = review({ last_name: "", email: "", phone: "", county: "", pickup_city: " ", destination: "", ride_date: null, transportation_need: "", program_type: "" });
    expect(ids(out)).toEqual([
      "missing_name",
      "missing_contact",
      "missing_county",
      "missing_pickup",
      "missing_destination",
      "missing_ride_date",
      "need_missing",
      "program_unspecified"
    ]);
    expect(out.follow_up_questions.map((q) => q.id)).toEqual([
      "missing_name",
      "missing_county",
      "missing_pickup",
      "missing_destination",
      "missing_ride_date",
      "need_missing",
      "program_unspecified"
    ]);
    expect(out.summary).toContain("8 missing items, 0 items to check.");
  });

  test("brief description and past ride date are flagged for checking, not rejected", () => {
    const out = review({ transportation_need: "doctor", ride_date: "2026-10-01" });
    expect(ids(out)).toEqual(["ride_date_past", "need_brief"]);
    expect(out.checks.every((c) => c.kind === "check")).toBe(true);
    expect(out.summary).toContain("Ride date 2026-10-01 (12 days ago, Central time).");
  });

  test("county: Tennessee names in any form are accepted; others are flagged to confirm", () => {
    for (const county of ["davidson", "DAVIDSON COUNTY", "McMinn County", "Van Buren", "DeKalb"]) {
      expect(ids(review({ county }))).toEqual([]);
    }
    expect(r.TENNESSEE_COUNTIES.size).toBe(95);
    expect(ids(review({ county: "Cook County" }))).toEqual(["county_not_recognized"]);
  });

  test("inaccurate suggestion: a misspelled Tennessee county is flagged, and the wording asks staff to confirm, not decide", () => {
    const out = review({ county: "Davidsn" });
    expect(ids(out)).toEqual(["county_not_recognized"]);
    expect(out.checks[0].message).toMatch(/may be misspelled/);
    expect(out.checks[0].message).toMatch(/Please confirm/);
    expect(out.checks[0].possibly).toBe("Davidson County");
    expect(out.summary).toContain("County not recognised.");
  });

  test("possible duplicate: shows the other application's code, status and date only", () => {
    const out = review({}, { related: [{ id: "x", application_code: "HTAF-20261009-SYN002", status: "submitted", submitted_at: "2026-10-09T10:00:00Z", email: "leak@example.test" }] });
    expect(ids(out)).toEqual(["possible_duplicate"]);
    expect(out.checks[0].related).toEqual([{ application_code: "HTAF-20261009-SYN002", status: "Submitted", submitted: "2026-10-09" }]);
    expect(JSON.stringify(out)).not.toContain("leak@example.test");
  });
});

describe("advisory only, internal, no applicant details", () => {
  const outputs = [
    review(),
    review({ last_name: "", email: "", county: "Cook", ride_date: "2020-01-01", transportation_need: "x" }),
    review({}, { related: [{ application_code: "HTAF-OTHER", status: "approved" }] })
  ];

  test("output never contains name, contact, addresses, income, household size, description or notes", () => {
    for (const out of outputs) {
      const body = JSON.stringify(out);
      for (const value of ["Synthia", "Testperson", "synthia.test", "6155550199", "Antioch", "Dialysis", "Example Way", "1234.56", "Jane Example", "Internal review note", "no car"]) {
        expect(body).not.toContain(value);
      }
      expect(Object.keys(out).sort()).toEqual(["checks", "engine", "follow_up_questions", "label", "processing", "staff_checks", "summary"]);
    }
  });

  test("no decision, ranking or status: no approve/deny/reject/eligible/priority language and no status field", () => {
    for (const out of outputs) {
      // The fixed label says a person approves or denies, and a related
      // application's existing status is shown as recorded; nothing else
      // may use decision language.
      // Staff checks name what staff decide; the summary's coverage sentence
      // says what coverage does NOT confirm.
      const body = JSON.stringify({
        ...out,
        label: undefined,
        staff_checks: undefined,
        summary: out.summary.replace("Coverage does not confirm funding, a ride, eligibility or approval.", ""),
        checks: out.checks.map(({ related, ...c }) => c)
      }).replace("This is not a reason to deny", "");
      expect(body).not.toMatch(/\b(approv|deny|denied|reject|eligib|ineligib|priorit|recommend|score)/i);
      expect(out).not.toHaveProperty("recommendation");
      expect(out).not.toHaveProperty("status");
    }
  });

  test("clearly labelled as automated suggestions that a person decides", () => {
    expect(review().label).toBe(
      "Automated suggestions from HTAF's own review rules (no AI model). Not a decision: a person approves or denies every application. Check each item before acting."
    );
    expect(review().processing).toBe("internal");
  });

  test("does not change the application it reads", () => {
    const copy = JSON.parse(JSON.stringify(COMPLETE));
    r.reviewApplication(copy, { today: TODAY });
    expect(copy).toEqual(JSON.parse(JSON.stringify(COMPLETE)));
  });

  test("runs locally: the module loads no network, AI or database client", () => {
    const source = fs.readFileSync(path.join(__dirname, "htafReviewAssist.js"), "utf8");
    expect(source.match(/require\(/g)).toBeNull();
    expect(source).not.toMatch(/fetch\(|openai|anthropic|supabase|https?:\/\//i);
  });

  test("never reads income, household size or notes", () => {
    const withAndWithout = [review(), r.reviewApplication({ ...COMPLETE, household_size: 12, monthly_income: 0, notes: "", review_notes: "" }, { today: TODAY })];
    expect(withAndWithout[0]).toEqual(withAndWithout[1]);
    expect(r.FIELDS_NOT_READ).toEqual(expect.arrayContaining(["household_size", "monthly_income", "notes", "review_notes"]));
  });
});

describe("v2 hardening (2026-10-14)", () => {
  test("county spelling and formatting variations are recognised", () => {
    for (const county of ["Davidson", "davidson county", "Davidson Co.", "Davidson Cnty, TN", "  DAVIDSON   County, Tennessee ", "De Kalb", "Mc Minn County", "van buren"]) {
      expect({ county, checks: ids(review({ county })) }).toEqual({ county, checks: [] });
    }
  });

  test("missing county and unrecognised county are different checks; a suggestion is offered, never applied", () => {
    expect(ids(review({ county: "" }))).toEqual(["missing_county"]);
    expect(ids(review({ county: "   " }))).toEqual(["missing_county"]);
    const out = review({ county: "Nashville" });
    expect(ids(out)).toEqual(["county_not_recognized"]);
    expect(out.checks[0].possibly).toBeUndefined();
    expect(out.checks[0].message).toMatch(/staff can correct it/);
  });

  test("dates use America/Chicago: late evening in Nashville is still 'today' there", () => {
    // 2026-10-15 03:30 UTC is 2026-10-14 22:30 in Nashville (CDT).
    expect(r.centralToday(new Date("2026-10-15T03:30:00Z"))).toBe("2026-10-14");
    // Date-only ride dates are calendar dates, not shifted by time zone.
    expect(r.centralDay("2026-10-20")).toBe("2026-10-20");
  });

  test("same-day request is flagged for checking (not rejected); yesterday is past", () => {
    expect(ids(review({ ride_date: TODAY }))).toEqual(["ride_date_today"]);
    expect(ids(review({ ride_date: "2026-10-12" }))).toEqual(["ride_date_past"]);
    expect(ids(review({ ride_date: "2026-10-14" }))).toEqual([]);
  });

  test("coverage is separate from capacity: staff checks are always shown", () => {
    for (const out of [review(), review({ county: "" })]) {
      expect(out.staff_checks.map((c) => c.id)).toEqual(["funding", "transportation", "eligibility"]);
    }
    expect(review().summary).toContain("Coverage does not confirm funding, a ride, eligibility or approval.");
  });

  test("possible duplicate wording never implies fraud or denial", () => {
    const out = review({}, { related: [{ application_code: "HTAF-X", status: "submitted" }] });
    expect(out.checks[0].message).toMatch(/^Possible duplicate:/);
    expect(out.checks[0].message).toMatch(/Households, caregivers and caseworkers often share contact details/);
    expect(out.checks[0].message).toMatch(/This is not a reason to deny/);
    expect(out.checks[0].message).not.toMatch(/fraud/i);
  });
});
