// Admin capability enforcement on the Data Collection routes, driven
// through registerDataCollectionRoutes with a stub requireAdmin, so an
// admin identity that does not resolve to a role with the capability
// (lib/adminRbac.js: deny by default) is refused even though
// requireAdmin itself let the request through.
const express = require("express");
const request = require("supertest");
const { registerDataCollectionRoutes } = require("../lib/dataCollectionRoutes");
const { createFakeSupabase } = require("./fakeSupabase");
const { hasCapability } = require("../lib/adminRbac");

function buildApp(adminIdentity) {
  const supabase = createFakeSupabase({
    system_flags: [
      { key: "data_collection_program_enabled", value: "true" },
      { key: "data_collection_enrollment_enabled", value: "true" },
      { key: "data_collection_collection_enabled", value: "true" }
    ]
  });
  const app = express();
  app.use(express.json());
  registerDataCollectionRoutes(app, {
    supabase,
    requireAdmin: (req, res, next) => {
      req.admin = adminIdentity;
      next();
    },
    requireDriverSelf: (req, res) => res.status(401).json({ ok: false }),
    getSystemFlag: async (key, fallback) => {
      const { data } = await supabase.from("system_flags").select("*").eq("key", key).maybeSingle();
      return data?.value ?? fallback;
    },
    asyncRoute: (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
    ok: (res, data = {}, status = 200) => res.status(status).json({ ok: true, ...data }),
    fail: (res, message, status = 400, details = {}) => res.status(status).json({ ok: false, error: message, ...details }),
    env: {}
  });
  return { app, supabase };
}

const ADMIN_ROUTES = [
  ["get", "/api/admin/data-collection/overview"],
  ["get", "/api/admin/data-collection/applications"],
  ["post", "/api/admin/data-collection/applications/00000000-0000-4000-8000-000000000000/status"],
  ["post", "/api/admin/data-collection/applications/00000000-0000-4000-8000-000000000000/contributor"],
  ["post", "/api/admin/data-collection/applications/00000000-0000-4000-8000-000000000000/agreements"],
  ["post", "/api/admin/data-collection/applications/00000000-0000-4000-8000-000000000000/equipment"],
  ["patch", "/api/admin/data-collection/equipment/00000000-0000-4000-8000-000000000000"],
  ["post", "/api/admin/data-collection/imports/preview"],
  ["post", "/api/admin/data-collection/imports/commit"],
  ["post", "/api/admin/data-collection/hours/manual"],
  ["get", "/api/admin/data-collection/hours"],
  ["get", "/api/admin/data-collection/exceptions"],
  ["get", "/api/admin/data-collection/audit-log"]
];

test("an admin identity with no recognized role is refused on every admin route", async () => {
  const { app } = buildApp({ id: "x", email: "x@example.test", method: "some_future_method" });
  for (const [method, path] of ADMIN_ROUTES) {
    const res = await request(app)[method](path).send({});
    expect([method, path, res.status]).toEqual([method, path, 403]);
  }
  const status = await request(app)
    .post("/api/admin/data-collection/hours/status")
    .send({ ids: ["00000000-0000-4000-8000-000000000000"], from: "accepted", to: "payable" });
  expect(status.status).toBe(403);
});

test("today's admin logins resolve to super_admin and are allowed", async () => {
  const { app } = buildApp({ id: "token-admin", email: "admin@example.test", method: "admin_token" });
  const res = await request(app).get("/api/admin/data-collection/overview");
  expect(res.status).toBe(200);
  expect(res.body.gates).toEqual({ program: true, enrollment: true, collection: true });
  expect(res.body.configuration.organization_code_configured).toBe(false);
});

describe("role grants for the program capabilities", () => {
  test("finance: read and payouts, not hour review or participant management", () => {
    expect(hasCapability("finance", "data_collection.read")).toBe(true);
    expect(hasCapability("finance", "data_collection.payouts.manage")).toBe(true);
    expect(hasCapability("finance", "data_collection.hours.manage")).toBe(false);
    expect(hasCapability("finance", "data_collection.manage")).toBe(false);
  });

  test("compliance: read and participant management (agreements, equipment), not money", () => {
    expect(hasCapability("compliance", "data_collection.manage")).toBe(true);
    expect(hasCapability("compliance", "data_collection.hours.manage")).toBe(false);
    expect(hasCapability("compliance", "data_collection.payouts.manage")).toBe(false);
  });

  test("dispatcher, support and HTAF caseworkers have no program access", () => {
    for (const role of ["dispatcher", "support", "htaf_caseworker"]) {
      for (const cap of ["data_collection.read", "data_collection.manage", "data_collection.hours.manage", "data_collection.payouts.manage"]) {
        expect([role, cap, hasCapability(role, cap)]).toEqual([role, cap, false]);
      }
    }
  });
});
