// partnership_inquiries migration (merchant page v2, owner decision
// 2026-10-22): business partnership inquiries. Server-only table.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

const COLS = "organization_name, business_type, industry, city, state, contact_name, contact_email, contact_phone, interests, message, consent_version, consented_at";
const row = (over = {}) => {
  const v = {
    organization_name: "'TEST Hotel Group'",
    business_type: "'llc'",
    industry: "'hospitality'",
    city: "'Nashville'",
    state: "'TN'",
    contact_name: "'Test Contact'",
    contact_email: "'contact@example.test'",
    contact_phone: "'+16155550100'",
    interests: "array['transportation_partnership']",
    message: "'We would like to discuss transportation for our guests.'",
    consent_version: "'2026-10-22'",
    consented_at: "now()",
    ...over
  };
  return `insert into public.partnership_inquiries (${COLS}) values (${COLS.split(", ").map((c) => v[c]).join(", ")})`;
};

describeDb("partnership_inquiries migration", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
  });

  afterAll(async () => {
    if (db) await db.drop();
  });

  beforeEach(async () => {
    await q("truncate public.partnership_inquiries");
  });

  test("a new inquiry is 'new', with an id and timestamps", async () => {
    await q(row());
    const [r] = await q("select id is not null as has_id, status, created_at is not null as dated from public.partnership_inquiries");
    expect(r).toEqual({ has_id: true, status: "new", dated: true });
  });

  test("business type, industry, state, ZIP, phone, interests, message and status are enforced", async () => {
    await expect(q(row({ business_type: "'empire'" }))).rejects.toThrow(/business_type/);
    await expect(q(row({ industry: "'mining'" }))).rejects.toThrow(/industry/);
    await expect(q(row({ state: "'Tn'" }))).rejects.toThrow(/state/);
    await expect(q(`${row()}`.replace("consented_at)", "consented_at, postal_code)").replace("now())", "now(), '372')"))).rejects.toThrow(/postal_code/);
    await expect(q(row({ contact_phone: "'615-555-0100'" }))).rejects.toThrow(/contact_phone/);
    await expect(q(row({ interests: "array[]::text[]" }))).rejects.toThrow(/interests/);
    await expect(q(row({ interests: "array['free_rides']" }))).rejects.toThrow(/interests/);
    await expect(q(row({ message: "'too short'" }))).rejects.toThrow(/message/);
    await q(row());
    await expect(q("update public.partnership_inquiries set status = 'approved'")).rejects.toThrow(/status/);
    await q("update public.partnership_inquiries set status = 'contacted', reviewed_by = 'admin@example.test', reviewed_at = now()");
  });

  test("server-only: row-level security on, no access for anon or signed-in clients", async () => {
    const [rls] = await q("select relrowsecurity from pg_class where oid = 'public.partnership_inquiries'::regclass");
    expect(rls.relrowsecurity).toBe(true);
    const [g] = await q(`select has_table_privilege('anon', 'public.partnership_inquiries', 'select') as anon_select,
      has_table_privilege('anon', 'public.partnership_inquiries', 'insert') as anon_insert,
      has_table_privilege('authenticated', 'public.partnership_inquiries', 'select') as auth_select`);
    expect(g).toEqual({ anon_select: false, anon_insert: false, auth_select: false });
  });
});
