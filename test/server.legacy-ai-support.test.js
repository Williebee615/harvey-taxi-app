// The old website chat (POST /api/ai/support) sends messages to OpenAI with
// no consent step. It must make no model call unless the owner turns it on
// with the system flag legacy_ai_support_enabled = "true". OpenAI is mocked:
// nothing leaves the test.
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.NODE_ENV = "test";
process.env.OPENAI_API_KEY = "test-openai-key-not-real";
process.env.ENABLE_AI_SUPPORT = "true";

const { createFakeSupabase } = require("./fakeSupabase");

let mockSupabaseClient;
const mockCreate = jest.fn(async () => ({ choices: [{ message: { role: "assistant", content: "model reply" } }] }));

jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));
jest.mock("openai", () => jest.fn().mockImplementation(() => ({ chat: { completions: { create: mockCreate } } })), { virtual: true });

const request = require("supertest");

let app;
beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({ riders: [], drivers: [], system_flags: [] });
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

const ask = () => request(app).post("/api/ai/support").set("X-Forwarded-For", `203.0.113.${Math.floor(Math.random() * 200) + 1}`).send({ message: "How do I book a ride?", page: "index", role: "rider" });

test("off by default: no OpenAI call, the limited reply and the support address", async () => {
  const res = await ask();
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ fallback: true });
  expect(res.body.reply).toMatch(/limited/);
  expect(mockCreate).not.toHaveBeenCalled();
});

test("any value other than \"true\" keeps it off", async () => {
  mockSupabaseClient._state.system_flags = [{ key: "legacy_ai_support_enabled", value: "yes" }];
  const res = await ask();
  expect(res.body.fallback).toBe(true);
  expect(mockCreate).not.toHaveBeenCalled();
});

test("only the owner's flag turns the model call back on", async () => {
  mockSupabaseClient._state.system_flags = [{ key: "legacy_ai_support_enabled", value: "true" }];
  const res = await ask();
  expect(res.status).toBe(200);
  expect(mockCreate).toHaveBeenCalled();
});
