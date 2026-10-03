// Data Collection program through the real server routes: feature gating
// (everything off by default), driver ownership, separate program
// approval, organization-code visibility, admin authorization, import
// preview/commit with duplicate rejection, manual entry, earnings, and
// separation from ride earnings.
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.MINUTE_ORGANIZATION_CODE = "ORG-SECRET-123";
process.env.MINUTE_IOS_APP_URL = "https://apps.example.test/minute-ios";

const crypto = require("crypto");
const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { makeDriver, signTestDriverToken, driverAuthHeaders } = require("./rideTestHelpers");
const { installDataCollectionRpc } = require("./dataCollectionFakeRpc");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

const ADMIN = { "x-admin-token": "test-admin-token" };
const DRIVER = makeDriver({ id: "DRIVER_A", email: "a@example.test" });
const OTHER = makeDriver({ id: "DRIVER_B", email: "b@example.test", phone: "+16155550299" });
const PENDING_DRIVER = makeDriver({ id: "DRIVER_PENDING", email: "p@example.test", approval_status: "pending" });
const REVIEW_DRIVER = makeDriver({ id: "DRIVER_REVIEW", email: "r@example.test", is_review_account: true });

const ALL_ON = { program: "true", enrollment: "true", collection: "true" };

let app;
const state = () => mockSupabaseClient._state;
const asDriver = (id) => driverAuthHeaders(signTestDriverToken(id));
const uuid = () => crypto.randomUUID();

function setFlags({ program = null, enrollment = null, collection = null } = {}) {
  const rows = [];
  if (program !== null) rows.push({ key: "data_collection_program_enabled", value: program });
  if (enrollment !== null) rows.push({ key: "data_collection_enrollment_enabled", value: enrollment });
  if (collection !== null) rows.push({ key: "data_collection_collection_enabled", value: collection });
  state().system_flags = [{ key: "review_account_login_enabled", value: "false" }, ...rows];
}

function installRpc() {
  installDataCollectionRpc(mockSupabaseClient);
}

function resetState() {
  const s = state();
  for (const key of Object.keys(s)) delete s[key];
  Object.assign(s, {
    drivers: [{ ...DRIVER }, { ...OTHER }, { ...PENDING_DRIVER }, { ...REVIEW_DRIVER }],
    driver_earnings: [{ id: "E1", driver_id: "DRIVER_A", ride_id: "RIDE_1", total_earning: 12.5 }],
    data_collection_applications: [],
    data_collection_agreements: [],
    data_collection_equipment: [],
    data_collection_import_batches: [],
    data_collection_hour_records: [],
    data_collection_import_exceptions: [],
    data_collection_audit_log: [],
    audit_logs: []
  });
  setFlags();
  installRpc();
}

const VALID_APPLICATION = {
  phone_model: "Pixel 8",
  country: "US",
  proposed_location: "Harvey Taxi depot, 100 Main St, Nashville",
  location_state: "TN",
  proposed_tasks: ["Washing vehicles by hand", "Restocking supply shelves"],
  ineligible_tasks_acknowledged: true
};

function seedApplication(driverId, overrides = {}) {
  const row = {
    id: uuid(),
    driver_id: driverId,
    status: "approved",
    ...VALID_APPLICATION,
    task_review_flags: [],
    minute_contributor_id: null,
    submitted_at: "2026-10-01T00:00:00Z",
    ...overrides
  };
  state().data_collection_applications.push(row);
  return row;
}

function signAll(application) {
  for (const type of ["contributor_agreement", "recording_consent"]) {
    state().data_collection_agreements.push({
      id: uuid(),
      application_id: application.id,
      driver_id: application.driver_id,
      agreement_type: type,
      status: "signed",
      document_version: "v1-draft",
      signed_at: "2026-10-01T00:00:00Z",
      recorded_at: "2026-10-01T00:00:00Z"
    });
  }
}

beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({});
  ({ app } = require("../server"));
});

beforeEach(() => resetState());

describe("disabled by default", () => {
  test("drivers see only that the program is off", async () => {
    seedApplication("DRIVER_A");
    const res = await request(app).get("/api/driver/data-collection").set(asDriver("DRIVER_A"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, program_enabled: false });
  });

  test("applying is unavailable", async () => {
    const res = await request(app).post("/api/driver/data-collection/application").set(asDriver("DRIVER_A")).send(VALID_APPLICATION);
    expect(res.status).toBe(404);
    expect(state().data_collection_applications).toEqual([]);
  });

  test("enrollment and collection flags do nothing without the program flag", async () => {
    setFlags({ enrollment: "true", collection: "true" });
    const res = await request(app).post("/api/driver/data-collection/application").set(asDriver("DRIVER_A")).send(VALID_APPLICATION);
    expect(res.status).toBe(404);
    const app1 = seedApplication("DRIVER_B", { status: "submitted" });
    const approve = await request(app).post(`/api/admin/data-collection/applications/${app1.id}/status`).set(ADMIN).send({ status: "approved" });
    expect(approve.status).toBe(403);
  });

  test("with the program on but enrollment closed, drivers cannot apply and admins cannot approve", async () => {
    setFlags({ program: "true" });
    const res = await request(app).post("/api/driver/data-collection/application").set(asDriver("DRIVER_A")).send(VALID_APPLICATION);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not open/);
    const pending = seedApplication("DRIVER_B", { status: "submitted" });
    const approve = await request(app).post(`/api/admin/data-collection/applications/${pending.id}/status`).set(ADMIN).send({ status: "approved" });
    expect(approve.status).toBe(403);
    expect(state().data_collection_applications.find((a) => a.id === pending.id).status).toBe("submitted");
  });

  test("with collection closed, hours cannot be recorded and the organization code stays hidden", async () => {
    setFlags({ program: "true", enrollment: "true" });
    const a = seedApplication("DRIVER_A");
    signAll(a);
    const manual = await request(app)
      .post("/api/admin/data-collection/hours/manual")
      .set(ADMIN)
      .send({ application_id: a.id, external_session_id: "S1", session_date: "2026-09-30", duration: "1:00:00", reason: "test" });
    expect(manual.status).toBe(403);
    const commit = await request(app).post("/api/admin/data-collection/imports/commit").set(ADMIN).send({ confirm: true });
    expect(commit.status).toBe(403);
    const view = await request(app).get("/api/driver/data-collection").set(asDriver("DRIVER_A"));
    expect(view.body.minute).toBeNull();
    expect(JSON.stringify(view.body)).not.toContain("ORG-SECRET-123");
  });
});

describe("driver authorization and ownership", () => {
  beforeEach(() => setFlags(ALL_ON));

  test("driver routes need a driver session; admin credentials cannot act as a driver", async () => {
    expect((await request(app).get("/api/driver/data-collection")).status).toBe(401);
    const asAdmin = await request(app)
      .post("/api/driver/data-collection/application")
      .set(ADMIN)
      .send({ ...VALID_APPLICATION, driver_id: "DRIVER_A" });
    expect(asAdmin.status).toBe(401);
    expect(state().data_collection_applications).toEqual([]);
  });

  test("an application is always filed for the signed-in driver, whatever the body says", async () => {
    const res = await request(app)
      .post("/api/driver/data-collection/application")
      .set(asDriver("DRIVER_A"))
      .send({ ...VALID_APPLICATION, driver_id: "DRIVER_B", status: "approved" });
    expect(res.status).toBe(201);
    expect(state().data_collection_applications).toEqual([
      expect.objectContaining({ driver_id: "DRIVER_A", status: "submitted", country: "US" })
    ]);
    expect(state().data_collection_audit_log).toEqual([
      expect.objectContaining({ actor: "driver:DRIVER_A", action: "application.submitted" })
    ]);
  });

  test("ordinary driver approval is required; review accounts are excluded", async () => {
    const pending = await request(app).post("/api/driver/data-collection/application").set(asDriver("DRIVER_PENDING")).send(VALID_APPLICATION);
    expect(pending.status).toBe(403);
    expect(pending.body.reasons).toContain("driver_not_approved");
    const review = await request(app).post("/api/driver/data-collection/application").set(asDriver("DRIVER_REVIEW")).send(VALID_APPLICATION);
    expect(review.status).toBe(403);
  });

  test("U.S. only, and the ineligible-task acknowledgement is required", async () => {
    const ca = await request(app).post("/api/driver/data-collection/application").set(asDriver("DRIVER_A")).send({ ...VALID_APPLICATION, country: "CA" });
    expect(ca.status).toBe(400);
    expect(ca.body.error).toMatch(/United States only/);
    const noAck = await request(app)
      .post("/api/driver/data-collection/application")
      .set(asDriver("DRIVER_A"))
      .send({ ...VALID_APPLICATION, ineligible_tasks_acknowledged: false });
    expect(noAck.status).toBe(400);
  });

  test("one open application per driver", async () => {
    await request(app).post("/api/driver/data-collection/application").set(asDriver("DRIVER_A")).send(VALID_APPLICATION);
    const again = await request(app).post("/api/driver/data-collection/application").set(asDriver("DRIVER_A")).send(VALID_APPLICATION);
    expect(again.status).toBe(409);
  });

  test("a driver sees only their own hours and earnings, never company figures", async () => {
    const a = seedApplication("DRIVER_A");
    const b = seedApplication("DRIVER_B");
    const rec = (application, sessionId, seconds, status) => ({
      id: uuid(),
      driver_id: application.driver_id,
      application_id: application.id,
      external_session_id: sessionId,
      session_date: "2026-09-30",
      duration_seconds: seconds,
      status,
      driver_amount_cents: Math.floor((seconds * 1000 + 1800) / 3600),
      company_amount_cents: Math.floor((seconds * 1500 + 1800) / 3600)
    });
    state().data_collection_hour_records.push(
      rec(a, "A-1", 3600, "accepted"),
      rec(a, "A-2", 1800, "pending"),
      rec(a, "A-3", 61, "paid"),
      rec(b, "B-1", 7200, "accepted")
    );

    const res = await request(app).get("/api/driver/data-collection").set(asDriver("DRIVER_A"));
    expect(res.status).toBe(200);
    expect(res.body.hours.map((h) => h.id).sort()).toEqual(
      state().data_collection_hour_records.filter((h) => h.driver_id === "DRIVER_A").map((h) => h.id).sort()
    );
    expect(res.body.earnings).toMatchObject({
      accepted_seconds: 3661,
      estimated_earnings_cents: 1017,
      paid_cents: 17,
      unpaid_earnings_cents: 1000,
      pending_hours: 0.5,
      payment_status: "awaiting_payment_approval"
    });
    expect(JSON.stringify(res.body)).not.toMatch(/company|margin/);
    expect(res.body.ineligible_task_notice).toMatch(/driving/);
  });
});

describe("organization code: separate program approval, signed agreements, collection on", () => {
  beforeEach(() => setFlags(ALL_ON));
  const view = async (id) => (await request(app).get("/api/driver/data-collection").set(asDriver(id))).body;

  test("an approved driver without program approval never sees it", async () => {
    const body = await view("DRIVER_A");
    expect(body.application).toBeNull();
    expect(body.minute).toBeNull();
    expect(JSON.stringify(body)).not.toContain("ORG-SECRET-123");
  });

  test("a submitted application does not see it", async () => {
    signAll(seedApplication("DRIVER_A", { status: "submitted" }));
    expect(JSON.stringify(await view("DRIVER_A"))).not.toContain("ORG-SECRET-123");
  });

  test("a program-approved participant without signed agreements gets links but not the code", async () => {
    seedApplication("DRIVER_A");
    const body = await view("DRIVER_A");
    expect(body.minute.download_links.ios).toBe("https://apps.example.test/minute-ios");
    expect(body.minute.download_links.android).toBeNull();
    expect(body.minute.organization_code).toBeNull();
    expect(body.minute.organization_code_pending).toContain("agreements_incomplete");
  });

  test("shown once approved and signed, and only to that driver", async () => {
    signAll(seedApplication("DRIVER_A"));
    seedApplication("DRIVER_B");
    expect((await view("DRIVER_A")).minute.organization_code).toBe("ORG-SECRET-123");
    expect(JSON.stringify(await view("DRIVER_B"))).not.toContain("ORG-SECRET-123");
  });

  test("hidden again after suspension", async () => {
    signAll(seedApplication("DRIVER_A", { status: "suspended", status_reason: "Paused" }));
    const body = await view("DRIVER_A");
    expect(body.minute).toBeNull();
    expect(body.application.status_reason).toBe("Paused");
  });
});

describe("admin authorization and application management", () => {
  beforeEach(() => setFlags(ALL_ON));

  test("admin routes reject anonymous and driver callers", async () => {
    const routes = [
      ["get", "/api/admin/data-collection/overview"],
      ["get", "/api/admin/data-collection/applications"],
      ["get", "/api/admin/data-collection/hours"],
      ["get", "/api/admin/data-collection/audit-log"],
      ["post", "/api/admin/data-collection/imports/preview"],
      ["post", "/api/admin/data-collection/imports/commit"],
      ["post", "/api/admin/data-collection/hours/manual"],
      ["post", "/api/admin/data-collection/hours/status"]
    ];
    for (const [method, path] of routes) {
      expect([path, (await request(app)[method](path)).status]).toEqual([path, 401]);
      expect([path, (await request(app)[method](path).set(asDriver("DRIVER_A"))).status]).toEqual([path, 401]);
    }
  });

  test("approve, link contributor, record agreements and equipment, suspend: each audited", async () => {
    const a = seedApplication("DRIVER_A", { status: "submitted" });
    const approve = await request(app).post(`/api/admin/data-collection/applications/${a.id}/status`).set(ADMIN).send({ status: "approved" });
    expect(approve.status).toBe(200);

    const link = await request(app).post(`/api/admin/data-collection/applications/${a.id}/contributor`).set(ADMIN).send({ minute_contributor_id: "C-100" });
    expect(link.status).toBe(200);

    const unsigned = await request(app)
      .post(`/api/admin/data-collection/applications/${a.id}/agreements`)
      .set(ADMIN)
      .send({ agreement_type: "contributor_agreement", status: "signed" });
    expect(unsigned.status).toBe(400);
    const signed = await request(app)
      .post(`/api/admin/data-collection/applications/${a.id}/agreements`)
      .set(ADMIN)
      .send({ agreement_type: "contributor_agreement", status: "signed", document_version: "v1", signed_at: "2026-10-01" });
    expect(signed.status).toBe(201);

    const equip = await request(app).post(`/api/admin/data-collection/applications/${a.id}/equipment`).set(ADMIN).send({ item: "Chest mount", asset_tag: "HT-001" });
    expect(equip.status).toBe(201);
    const returned = await request(app).patch(`/api/admin/data-collection/equipment/${equip.body.equipment.id}`).set(ADMIN).send({ status: "returned" });
    expect(returned.status).toBe(200);

    const noReason = await request(app).post(`/api/admin/data-collection/applications/${a.id}/status`).set(ADMIN).send({ status: "suspended" });
    expect(noReason.status).toBe(400);
    const suspend = await request(app).post(`/api/admin/data-collection/applications/${a.id}/status`).set(ADMIN).send({ status: "suspended", reason: "Insurance review" });
    expect(suspend.status).toBe(200);

    expect(state().data_collection_audit_log.map((e) => e.action)).toEqual([
      "application.approved",
      "application.contributor_linked",
      "agreement.recorded",
      "equipment.assigned",
      "equipment.status_changed",
      "application.suspended"
    ]);
    for (const entry of state().data_collection_audit_log) expect(entry.actor).toMatch(/^admin:/);
  });

  test("approval re-checks ordinary driver approval", async () => {
    const a = seedApplication("DRIVER_PENDING", { status: "submitted" });
    const res = await request(app).post(`/api/admin/data-collection/applications/${a.id}/status`).set(ADMIN).send({ status: "approved" });
    expect(res.status).toBe(409);
    expect(res.body.reasons).toContain("driver_not_approved");
  });

  test("invalid transitions are refused", async () => {
    const a = seedApplication("DRIVER_A", { status: "rejected" });
    const res = await request(app).post(`/api/admin/data-collection/applications/${a.id}/status`).set(ADMIN).send({ status: "approved" });
    expect(res.status).toBe(400);
  });

  test("a contributor id already linked elsewhere is refused", async () => {
    seedApplication("DRIVER_B", { minute_contributor_id: "C-1" });
    const a = seedApplication("DRIVER_A");
    // The fake has no unique index, so emulate the database's answer.
    const original = mockSupabaseClient.from;
    mockSupabaseClient.from = (table) => {
      const builder = original(table);
      if (table !== "data_collection_applications") return builder;
      const update = builder.update;
      builder.update = (patch) =>
        patch.minute_contributor_id === "C-1"
          ? { eq: async () => ({ data: null, error: { code: "23505", message: "duplicate" } }) }
          : update(patch);
      return builder;
    };
    try {
      const res = await request(app).post(`/api/admin/data-collection/applications/${a.id}/contributor`).set(ADMIN).send({ minute_contributor_id: "C-1" });
      expect(res.status).toBe(409);
    } finally {
      mockSupabaseClient.from = original;
    }
  });
});

describe("import preview and commit", () => {
  beforeEach(() => setFlags(ALL_ON));

  const mapping = { contributor_id: "Contributor", session_id: "Session", session_date: "Date", duration: "Minutes", duration_unit: "minutes" };
  const csv = ["Contributor,Session,Date,Minutes", "C-100,S-1,2026-09-30,60", "c-100,S-2,2026-09-30,30.5", "C-777,S-3,2026-09-30,15"].join("\n");

  async function preview(text = csv) {
    return request(app).post("/api/admin/data-collection/imports/preview").set(ADMIN).send({ filename: "export.csv", csv_text: text, mapping });
  }
  async function commit(previewBody, extra = {}, text = csv) {
    return request(app)
      .post("/api/admin/data-collection/imports/commit")
      .set(ADMIN)
      .send({ filename: "export.csv", csv_text: text, mapping, preview_digest: previewBody.preview_digest, confirm: true, ...extra });
  }

  beforeEach(() => {
    seedApplication("DRIVER_A", { minute_contributor_id: "C-100" });
  });

  test("preview writes nothing and shows what would be saved", async () => {
    const res = await preview();
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ ready: 2, unmatched_contributor: 1, ready_seconds: 5430, ready_driver_cents: 1508, ready_company_cents: 2263 });
    expect(res.body.records).toBeUndefined();
    expect(state().data_collection_hour_records).toEqual([]);
    expect(state().data_collection_import_batches).toEqual([]);
  });

  test("commit saves the previewed rows as pending, flags unmatched rows, and audits", async () => {
    const p = await preview();
    const res = await commit(p.body);
    expect(res.status).toBe(200);
    expect(state().data_collection_hour_records.map((r) => [r.external_session_id, r.driver_id, r.status, r.duration_seconds, r.driver_amount_cents])).toEqual([
      ["S-1", "DRIVER_A", "pending", 3600, 1000],
      ["S-2", "DRIVER_A", "pending", 1830, 508]
    ]);
    expect(state().data_collection_import_exceptions).toEqual([expect.objectContaining({ external_session_id: "S-3", reason: "unmatched_contributor" })]);
    expect(state().data_collection_audit_log).toEqual([expect.objectContaining({ action: "hours.import_committed" })]);
  });

  test("ride earnings are untouched by program hours", async () => {
    const p = await preview();
    await commit(p.body);
    expect(state().driver_earnings).toEqual([{ id: "E1", driver_id: "DRIVER_A", ride_id: "RIDE_1", total_earning: 12.5 }]);
    const rides = await request(app).get("/api/driver/DRIVER_A/earnings").set(asDriver("DRIVER_A"));
    expect(rides.body.total_earnings).toBe(12.5);
  });

  test("the same file again needs acknowledgement, and its sessions are rejected as duplicates", async () => {
    await commit((await preview()).body);
    const p2 = await preview();
    expect(p2.body.previously_imported).toHaveLength(1);
    expect(p2.body.summary).toMatchObject({ ready: 0, duplicate_existing: 2, unmatched_contributor: 1 });
    // The unmatched row is already flagged, so there is nothing new to save.
    expect(p2.body.can_commit).toBe(false);
    const res = await commit(p2.body, { acknowledge_previous_import: true });
    expect(res.status).toBe(422);
    expect(state().data_collection_hour_records).toHaveLength(2);
    expect(state().data_collection_import_exceptions).toHaveLength(1);
  });

  test("a re-import after linking the contributor saves the session and resolves its exception", async () => {
    await commit((await preview()).body);
    seedApplication("DRIVER_B", { minute_contributor_id: "C-777" });
    const p2 = await preview();
    expect(p2.body.summary).toMatchObject({ ready: 1, duplicate_existing: 2 });
    const res = await commit(p2.body, { acknowledge_previous_import: true });
    expect(res.status).toBe(200);
    expect(state().data_collection_hour_records.find((r) => r.external_session_id === "S-3").driver_id).toBe("DRIVER_B");
    expect(state().data_collection_import_exceptions[0].resolved_at).not.toBeNull();
  });

  test("an unacknowledged re-import is refused", async () => {
    await commit((await preview()).body);
    seedApplication("DRIVER_B", { minute_contributor_id: "C-777" });
    const res = await commit((await preview()).body);
    expect(res.status).toBe(409);
    expect(res.body.previously_imported).toHaveLength(1);
  });

  test("duplicates within one file are rejected, not double-counted", async () => {
    const text = `${csv}\nC-100,s-1,2026-09-30,60`;
    const p = await preview(text);
    expect(p.body.summary).toMatchObject({ ready: 2, duplicate_in_file: 1 });
    expect((await commit(p.body, {}, text)).status).toBe(200);
    expect(state().data_collection_hour_records).toHaveLength(2);
    const audit = state().data_collection_audit_log[0].details;
    expect(audit.rejected_duplicates).toEqual([{ row: 5, session_id: "s-1", outcome: "duplicate_in_file" }]);
  });

  test("a stale preview is refused", async () => {
    const p = await preview();
    state().data_collection_hour_records.push({ id: uuid(), driver_id: "DRIVER_A", application_id: "x", external_session_id: "s-2", status: "pending" });
    const res = await commit(p.body);
    expect(res.status).toBe(409);
    expect(state().data_collection_import_batches).toEqual([]);
  });

  test("a concurrent duplicate caught by the database saves nothing", async () => {
    const p = await preview();
    const realRpc = mockSupabaseClient.rpc;
    mockSupabaseClient.rpc = async () => ({ data: null, error: { code: "23505", message: "duplicate" } });
    try {
      expect((await commit(p.body)).status).toBe(409);
    } finally {
      mockSupabaseClient.rpc = realRpc;
    }
    expect(state().data_collection_hour_records).toEqual([]);
  });

  test("invalid rows block the commit; confirmation is required", async () => {
    const bad = `${csv}\nC-100,S-9,09/30/2026,60`;
    const p = await preview(bad);
    expect(p.body.can_commit).toBe(false);
    expect((await commit(p.body, {}, bad)).status).toBe(422);
    expect((await commit((await preview()).body, { confirm: false })).status).toBe(400);
    expect(state().data_collection_hour_records).toEqual([]);
  });
});

describe("manual entry and hour status", () => {
  let a;
  beforeEach(() => {
    setFlags(ALL_ON);
    a = seedApplication("DRIVER_A", { minute_contributor_id: "C-100" });
  });

  const manual = (body) =>
    request(app)
      .post("/api/admin/data-collection/hours/manual")
      .set(ADMIN)
      .send({ application_id: a.id, session_date: "2026-09-30", duration: "1:30:00", reason: "Copied from Minute pending a sample export", ...body });

  test("records exact amounts and an audit entry; the same session again is refused", async () => {
    const res = await manual({ external_session_id: "M-1" });
    expect(res.status).toBe(201);
    expect(res.body.amounts).toEqual({ driver_rate_cents: 1000, company_rate_cents: 1500, driver_amount_cents: 1500, company_amount_cents: 2250, margin_cents: 750 });
    expect(state().data_collection_audit_log).toEqual([expect.objectContaining({ action: "hours.manual_entry" })]);
    expect((await manual({ external_session_id: "m-1" })).status).toBe(409);
    expect(state().data_collection_hour_records).toHaveLength(1);
  });

  test("not for applications that are not program-approved", async () => {
    const sub = seedApplication("DRIVER_B", { status: "submitted" });
    const res = await request(app)
      .post("/api/admin/data-collection/hours/manual")
      .set(ADMIN)
      .send({ application_id: sub.id, external_session_id: "M-2", session_date: "2026-09-30", duration: "1:00:00", reason: "x" });
    expect(res.status).toBe(409);
  });

  test("pending -> accepted -> payable -> paid, with payment never sent by the system", async () => {
    await manual({ external_session_id: "M-1" });
    const id = state().data_collection_hour_records[0].id;
    const move = (from, to, extra = {}) =>
      request(app).post("/api/admin/data-collection/hours/status").set(ADMIN).send({ ids: [id], from, to, ...extra });

    expect((await move("pending", "paid", { payout_reference: "X" })).status).toBe(400);
    expect((await move("pending", "accepted")).status).toBe(200);
    expect((await move("pending", "accepted")).status).toBe(409); // stale
    expect((await move("accepted", "payable")).status).toBe(200);
    expect((await move("payable", "paid")).status).toBe(400); // payout reference required
    expect((await move("payable", "paid", { payout_reference: "ACH-1001" })).status).toBe(200);

    const record = state().data_collection_hour_records[0];
    expect(record).toMatchObject({ status: "paid", payout_reference: "ACH-1001" });
    expect(state().driver_earnings).toHaveLength(1);

    const view = await request(app).get("/api/driver/data-collection").set(asDriver("DRIVER_A"));
    expect(view.body.earnings).toMatchObject({ paid_cents: 1500, estimated_earnings_cents: 1500, payment_status: "paid_in_full" });

    const overview = await request(app).get("/api/admin/data-collection/overview").set(ADMIN);
    expect(overview.body.hours).toMatchObject({ company_revenue_cents: 2250, gross_margin_cents: 750 });
    expect(overview.body.configuration.organization_code_configured).toBe(true);
    expect(JSON.stringify(overview.body)).not.toContain("ORG-SECRET-123");
  });
});
