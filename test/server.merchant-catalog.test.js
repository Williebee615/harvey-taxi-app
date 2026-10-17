// Merchant portal phase 2: store catalog and staff review of held items.
// Sessions are signed directly (sign-in has its own tests). Fixture data.
process.env.NODE_ENV = "test";
process.env.HARVEY_ISOLATED_TEST = "1";
process.env.API_RATE_LIMIT_PER_MINUTE = "100000";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.MERCHANT_SESSION_SECRET = "test-merchant-session-secret";

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { signMerchantSession } = require("../lib/merchantAuth");

let mockClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => new Proxy({}, { get: (_t, k) => mockClient && mockClient[k] }) }));

const HDR = { "X-Requested-With": "harvey-merchant-portal" };
const store = (id, status = "approved") => ({ id, business_name: `TEST Store ${id}`, category: "grocery", address_line: "1 Test St", city: "Nashville", postal_code: "37203", contact_name: "O", contact_phone: "+16155550100", contact_email: `${id}@example.test`, status, created_at: "2026-10-17T00:00:00Z" });
const user = (id, merchantId) => ({ id, merchant_id: merchantId, phone: `+1615555${id.slice(-4).padStart(4, "0")}`, name: "Owner", role: "owner", status: "active", session_version: 0 });
const cookieFor = (u) => `harvey_merchant_session=${signMerchantSession({ merchantUserId: u.id, merchantId: u.merchant_id, sessionVersion: 0, secret: process.env.MERCHANT_SESSION_SECRET, ttlHours: 1 })}`;
const A = user("U0000001", "M1");
const B = user("U0000002", "M2");
let app;

beforeAll(() => {
  mockClient = createFakeSupabase({});
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});
beforeEach(() => {
  mockClient = createFakeSupabase({ merchants: [store("M1"), store("M2")], merchant_users: [{ ...A }, { ...B }], catalog_items: [], audit_logs: [] });
});

const as = (u) => ({
  get: (p) => request(app).get(p).set(HDR).set("Cookie", cookieFor(u)),
  post: (p, b) => request(app).post(p).set(HDR).set("Cookie", cookieFor(u)).send(b),
  patch: (p, b) => request(app).patch(p).set(HDR).set("Cookie", cookieFor(u)).send(b),
  del: (p) => request(app).delete(p).set(HDR).set("Cookie", cookieFor(u))
});
const items = () => mockClient._state.catalog_items;

test("a store adds items; clean items are listed, possibly-excluded ones are held", async () => {
  const milk = await as(A).post("/api/merchant/catalog/items", { name: "Whole milk", price: "4.49", section: "Dairy", substitutable: true });
  expect(milk.status).toBe(201);
  expect(milk.body.item).toMatchObject({ name: "Whole milk", price_cents: 449, review_status: "listed", substitutable: true, available: true });
  const beer = await as(A).post("/api/merchant/catalog/items", { name: "Craft beer 6-pack", price: "12.99" });
  expect(beer.body.item).toMatchObject({ review_status: "held", review_flags: ["alcohol"], review_flag_labels: ["Alcohol"] });
  expect((await as(A).post("/api/merchant/catalog/items", { name: "whole MILK", price: "1" })).status).toBe(409);
  expect((await as(A).post("/api/merchant/catalog/items", { name: "Bad price", price: "free" })).status).toBe(400);
  expect((await as(A).get("/api/merchant/catalog")).body.items).toHaveLength(2);
});

test("a store sees and changes only its own items", async () => {
  const { body } = await as(A).post("/api/merchant/catalog/items", { name: "Bread", price: "3" });
  expect((await as(B).get("/api/merchant/catalog")).body.items).toEqual([]);
  expect((await as(B).patch(`/api/merchant/catalog/items/${body.item.id}`, { price: "0.01" })).status).toBe(404);
  expect((await as(B).del(`/api/merchant/catalog/items/${body.item.id}`)).status).toBe(404);
  expect(items()[0].price_cents).toBe(300);
});

test("edits: price and stock change in place; renaming re-screens the item", async () => {
  const { body } = await as(A).post("/api/merchant/catalog/items", { name: "House special", price: "9" });
  const p = await as(A).patch(`/api/merchant/catalog/items/${body.item.id}`, { price: "9.50", available: false });
  expect(p.body.item).toMatchObject({ price_cents: 950, available: false, review_status: "listed" });
  const r = await as(A).patch(`/api/merchant/catalog/items/${body.item.id}`, { description: "comes with a whiskey shot" });
  expect(r.body.item).toMatchObject({ review_status: "held", review_flags: ["alcohol"] });
});

test("remove archives the item; the name can be reused", async () => {
  const { body } = await as(A).post("/api/merchant/catalog/items", { name: "Eggs", price: "3" });
  expect((await as(A).del(`/api/merchant/catalog/items/${body.item.id}`)).status).toBe(200);
  expect(items()[0].archived_at).toBeTruthy();
  expect((await as(A).get("/api/merchant/catalog")).body.items).toEqual([]);
});

describe("staff review", () => {
  const admin = (r) => r.set("x-admin-token", "test-admin-token");
  test("staff see held items with the store name, and allow or keep hidden with a reason", async () => {
    const vodka = (await as(A).post("/api/merchant/catalog/items", { name: "Vodka", price: "20" })).body.item;
    const cake = (await as(A).post("/api/merchant/catalog/items", { name: "Rum cake", price: "8" })).body.item;
    const held = await admin(request(app).get("/api/admin/catalog/held"));
    expect(held.body.items.map((i) => [i.name, i.store_name])).toEqual(expect.arrayContaining([["Vodka", "TEST Store M1"], ["Rum cake", "TEST Store M1"]]));
    expect((await request(app).get("/api/admin/catalog/held")).status).toBe(401);

    expect((await admin(request(app).post(`/api/admin/catalog/items/${cake.id}/review`)).send({ decision: "allow" })).status).toBe(200);
    expect(items().find((i) => i.id === cake.id)).toMatchObject({ review_status: "listed", reviewed_by: expect.any(String) });

    expect((await admin(request(app).post(`/api/admin/catalog/items/${vodka.id}/review`)).send({ decision: "block", reason: "no" })).status).toBe(400);
    expect((await admin(request(app).post(`/api/admin/catalog/items/${vodka.id}/review`)).send({ decision: "block", reason: "Alcohol is excluded (term 3)." })).status).toBe(200);
    expect(items().find((i) => i.id === vodka.id).review_status).toBe("blocked");
    // Only held items can be decided.
    expect((await admin(request(app).post(`/api/admin/catalog/items/${vodka.id}/review`)).send({ decision: "allow" })).status).toBe(409);
    expect(mockClient._state.audit_logs.map((a) => a.action)).toEqual(expect.arrayContaining(["catalog_item_allowed", "catalog_item_blocked"]));
  });

  test("a hidden item can't be edited back by the store, only removed", async () => {
    const vodka = (await as(A).post("/api/merchant/catalog/items", { name: "Vodka", price: "20" })).body.item;
    await admin(request(app).post(`/api/admin/catalog/items/${vodka.id}/review`)).send({ decision: "block", reason: "Alcohol is excluded (term 3)." });
    expect((await as(A).patch(`/api/merchant/catalog/items/${vodka.id}`, { name: "Spirit drink" })).status).toBe(409);
    expect(items().find((i) => i.id === vodka.id)).toMatchObject({ name: "Vodka", review_status: "blocked" });
    expect((await as(A).del(`/api/merchant/catalog/items/${vodka.id}`)).status).toBe(200);
  });
});

describe("CSV import", () => {
  const csv = "name,price,section,substitutable\nWhole milk,4.49,Dairy,yes\nCraft beer,12.99,,\nBread,abc,,\n";
  test("preview changes nothing; import adds, holds, and reports bad lines", async () => {
    const preview = await as(A).post("/api/merchant/catalog/import", { csv, dry_run: true });
    expect(preview.body).toMatchObject({ dry_run: true, create: 2, update: 0, held: ["Craft beer"] });
    expect(preview.body.errors.map((e) => e.line)).toEqual([4]);
    expect(items()).toEqual([]);
    const run = await as(A).post("/api/merchant/catalog/import", { csv });
    expect(run.body).toMatchObject({ dry_run: false, create: 2 });
    expect(items().map((i) => [i.name, i.review_status])).toEqual([["Whole milk", "listed"], ["Craft beer", "held"]]);
  });
  test("a second import updates by name, and never changes a hidden item", async () => {
    await as(A).post("/api/merchant/catalog/import", { csv });
    const beer = items().find((i) => i.name === "Craft beer");
    const admin = (r) => r.set("x-admin-token", "test-admin-token");
    await admin(request(app).post(`/api/admin/catalog/items/${beer.id}/review`)).send({ decision: "block", reason: "Alcohol is excluded (term 3)." });
    const again = await as(A).post("/api/merchant/catalog/import", { csv: "name,price\nWHOLE MILK,5.00\nCraft beer,1.00\n" });
    expect(again.body).toMatchObject({ create: 0, update: 1 });
    expect(again.body.errors[0].error).toMatch(/hidden by Harvey Taxi/);
    expect(items().find((i) => i.name === "Whole milk").price_cents).toBe(500);
    expect(items().find((i) => i.name === "Craft beer").price_cents).toBe(1299);
  });
});

test("a suspended store can't use its catalog", async () => {
  mockClient._state.merchants[0].status = "suspended";
  expect((await as(A).get("/api/merchant/catalog")).status).toBe(403);
  expect((await as(A).post("/api/merchant/catalog/items", { name: "Milk", price: "1" })).status).toBe(403);
});

describe("staff view of a store's full catalog", () => {
  const admin = (r) => r.set("x-admin-token", "test-admin-token");
  test("admin only; one store's live items in every state, with counts and decisions; changes nothing", async () => {
    await as(A).post("/api/merchant/catalog/items", { name: "Whole milk", price: "4.49", section: "Dairy" });
    const beer = (await as(A).post("/api/merchant/catalog/items", { name: "Craft beer", price: "12.99" })).body.item;
    const vodka = (await as(A).post("/api/merchant/catalog/items", { name: "Vodka", price: "20" })).body.item;
    const bread = (await as(A).post("/api/merchant/catalog/items", { name: "Bread", price: "3" })).body.item;
    await as(A).patch(`/api/merchant/catalog/items/${bread.id}`, { available: false });
    const gone = (await as(A).post("/api/merchant/catalog/items", { name: "Old item", price: "1" })).body.item;
    await as(A).del(`/api/merchant/catalog/items/${gone.id}`);
    await as(B).post("/api/merchant/catalog/items", { name: "Other store item", price: "2" });
    await admin(request(app).post(`/api/admin/catalog/items/${vodka.id}/review`)).send({ decision: "block", reason: "Alcohol is excluded (term 3)." });

    expect((await request(app).get("/api/admin/merchants/M1/catalog")).status).toBe(401);
    expect((await as(A).get("/api/admin/merchants/M1/catalog")).status).toBe(401);

    const before = JSON.stringify(items());
    const auditBefore = mockClient._state.audit_logs.length;
    const res = await admin(request(app).get("/api/admin/merchants/M1/catalog"));
    expect(res.status).toBe(200);
    expect(res.body.store).toMatchObject({ id: "M1", business_name: "TEST Store M1", status: "approved" });
    expect(res.body.items.map((i) => i.name).sort()).toEqual(["Bread", "Craft beer", "Vodka", "Whole milk"]);
    expect(res.body.counts).toEqual({ total: 4, listed: 2, held: 1, blocked: 1, out_of_stock: 1 });
    expect(res.body.items.find((i) => i.id === beer.id)).toMatchObject({ review_status: "held", review_flag_labels: ["Alcohol"] });
    expect(res.body.items.find((i) => i.id === vodka.id)).toMatchObject({ review_status: "blocked", review_reason: "Alcohol is excluded (term 3).", reviewed_by: expect.any(String) });
    expect(JSON.stringify(items())).toBe(before);
    expect(mockClient._state.audit_logs.length).toBe(auditBefore);

    expect((await admin(request(app).get("/api/admin/merchants/NOPE/catalog"))).status).toBe(404);
    expect((await admin(request(app).get("/api/admin/merchants/M2/catalog"))).body.items.map((i) => i.name)).toEqual(["Other store item"]);
  });
});

describe("staff-assisted import", () => {
  const admin = (r) => r.set("x-admin-token", "test-admin-token");
  const staffImport = (id, body) => admin(request(app).post(`/api/admin/merchants/${id}/catalog/import`)).send(body);
  const csv = "name,price,section\nWhole milk,4.49,Dairy\nVodka,20,\nBread,abc,\n";

  test("admin only; approved stores only; unknown store 404", async () => {
    expect((await request(app).post("/api/admin/merchants/M1/catalog/import").send({ csv })).status).toBe(401);
    expect((await as(A).post("/api/admin/merchants/M1/catalog/import", { csv })).status).toBe(401);
    expect((await staffImport("NOPE", { csv })).status).toBe(404);
    mockClient._state.merchants.find((m) => m.id === "M2").status = "suspended";
    expect((await staffImport("M2", { csv })).status).toBe(409);
    expect(items()).toEqual([]);
  });

  test("preview writes nothing; import adds to that store only, holds flagged items, is audited as staff", async () => {
    const preview = await staffImport("M1", { csv, dry_run: true });
    expect(preview.body).toMatchObject({ dry_run: true, create: 2, update: 0, held: ["Vodka"] });
    expect(preview.body.errors.map((e) => e.line)).toEqual([4]);
    expect(items()).toEqual([]);
    expect(mockClient._state.audit_logs).toEqual([]);

    const run = await staffImport("M1", { csv });
    expect(run.body).toMatchObject({ dry_run: false, create: 2 });
    expect(items().map((i) => [i.merchant_id, i.name, i.review_status, i.created_by])).toEqual([["M1", "Whole milk", "listed", null], ["M1", "Vodka", "held", null]]);
    expect(mockClient._state.audit_logs.map((a) => [a.action, a.actor_type, a.entity_id])).toEqual([["catalog_imported_by_staff", "admin", "M1"]]);
    // The store sees the items in its own portal; the other store doesn't.
    expect((await as(A).get("/api/merchant/catalog")).body.items).toHaveLength(2);
    expect((await as(B).get("/api/merchant/catalog")).body.items).toEqual([]);
  });

  test("a staff import never changes an item staff kept hidden", async () => {
    await staffImport("M1", { csv });
    const vodka = items().find((i) => i.name === "Vodka");
    await admin(request(app).post(`/api/admin/catalog/items/${vodka.id}/review`)).send({ decision: "block", reason: "Alcohol is excluded (term 3)." });
    const again = await staffImport("M1", { csv: "name,price\nvodka,1\nwhole milk,5\n" });
    expect(again.body).toMatchObject({ create: 0, update: 1 });
    expect(again.body.errors[0].error).toMatch(/hidden by Harvey Taxi/);
    expect(items().find((i) => i.id === vodka.id)).toMatchObject({ price_cents: 2000, review_status: "blocked" });
    expect(items().find((i) => i.name === "Whole milk").price_cents).toBe(500);
  });
});

describe("onboarding files", () => {
  test("template and example download as CSV on Harvey Taxi; HTAF's domain redirects them", async () => {
    for (const f of ["/merchant-catalog-template.csv", "/merchant-catalog-example.csv"]) {
      const r = await request(app).get(f);
      expect(r.status).toBe(200);
      expect(r.headers["content-type"]).toMatch(/text\/csv/);
      expect(r.text).toMatch(/^name,price,section,description,available,substitutable/);
      const htaf = await request(app).get(f).set("Host", "harveytransportationfoundation.com");
      expect(htaf.status).toBeGreaterThanOrEqual(300);
      expect(htaf.status).toBeLessThan(400);
    }
  });
});
