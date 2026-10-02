#!/usr/bin/env node
// Real Twilio connectivity check for Harvey Taxi (docs/twilio-live-check.md).
//
// Default mode is READ-ONLY and sends no SMS, so it costs nothing:
//   1. the Verify service exists                    (verify.twilio.com)
//   2. TWILIO_FROM_NUMBER belongs to the account    (api.twilio.com)
//   3. the toll-free verification status of that    (messaging.twilio.com)
//      number, if it is toll-free
// Access to the account is validated through 1 and 2. The account
// resource itself (/Accounts/{sid}.json) is not read: a Standard API key
// can't read it, so it would report a false failure. Account status is
// reported as "not checked".
//
// Sending a real SMS needs an explicit number AND an explicit
// authorization flag, and sends exactly one Twilio Verify code:
//   node scripts/twilio-live-check.js --send-verify --to +1XXXXXXXXXX --i-authorize-one-sms
//   node scripts/twilio-live-check.js --check-verify --to +1XXXXXXXXXX --code 123456
//
// Credentials come only from the environment: TWILIO_ACCOUNT_SID plus
// TWILIO_AUTH_TOKEN (or TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET), or
// none at all when an egress proxy injects Twilio auth. Nothing secret is
// ever printed: output is limited to statuses, Twilio error codes and the
// last two digits of phone numbers.
//
// Requires Node 18+ (global fetch). Behind an HTTPS proxy, run with
// NODE_USE_ENV_PROXY=1 (Node >= 22.21).

const { toVerifyE164, redactPhone } = require("../lib/twilioSafety");

function parseArgs(argv) {
  const args = { mode: "read-only" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--send-verify") args.mode = "send-verify";
    else if (a === "--check-verify") args.mode = "check-verify";
    else if (a === "--to") args.to = argv[++i];
    else if (a === "--code") args.code = argv[++i];
    else if (a === "--i-authorize-one-sms") args.authorized = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

// Throws unless a send is fully specified and explicitly authorized.
// Returns the E.164 destination.
function assertSendAuthorized(args) {
  if (args.mode !== "send-verify") return null;
  const to = toVerifyE164(args.to);
  if (!to) throw new Error("--send-verify needs --to with a valid phone number.");
  if (!args.authorized) {
    throw new Error("Refusing to send: add --i-authorize-one-sms to confirm one real SMS (Twilio charges for it).");
  }
  return to;
}

function authHeader(env) {
  const user = env.TWILIO_API_KEY_SID || env.TWILIO_ACCOUNT_SID;
  const pass = env.TWILIO_API_KEY_SID ? env.TWILIO_API_KEY_SECRET : env.TWILIO_AUTH_TOKEN;
  if (!user || !pass) return {}; // proxy-injected auth
  return { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` };
}

async function twilio(env, method, url, form) {
  const res = await fetch(url, {
    method,
    headers: {
      ...authHeader(env),
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {})
    },
    body: form ? new URLSearchParams(form).toString() : undefined
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body };
}

function failure(r) {
  const code = r.body && r.body.code ? ` (Twilio error ${r.body.code})` : "";
  const hint = r.status === 401 ? ": authentication failed; check the Twilio credential" : "";
  return `HTTP ${r.status}${code}${hint}`;
}

async function readOnlyChecks(env, report) {
  report("account_status", null,
    "not checked (a Standard API key can't read /Accounts; access is validated through Verify and IncomingPhoneNumbers)");

  const vsid = env.TWILIO_VERIFY_SERVICE_SID;
  if (!vsid) {
    report("verify_service", false, "TWILIO_VERIFY_SERVICE_SID is not set");
  } else {
    const svc = await twilio(env, "GET", `https://verify.twilio.com/v2/Services/${vsid}`);
    report("verify_service", svc.status === 200,
      svc.status === 200 ? `code_length=${svc.body.code_length}` : failure(svc));
  }

  const sid = env.TWILIO_ACCOUNT_SID;
  if (!sid) {
    report("from_number", false, "TWILIO_ACCOUNT_SID is not set");
    return;
  }
  const from = toVerifyE164(env.TWILIO_FROM_NUMBER || env.TWILIO_PHONE_NUMBER);
  if (!from) {
    report("from_number", false, "TWILIO_FROM_NUMBER is not set or not a valid number");
    return;
  }
  const nums = await twilio(env, "GET",
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(from)}`);
  const owned = nums.status === 200 && (nums.body.incoming_phone_numbers || [])[0];
  report("from_number", Boolean(owned),
    owned ? `owned by account, sms=${owned.capabilities && owned.capabilities.sms}` : (nums.status === 200 ? "not found on this account" : failure(nums)));

  // Toll-free numbers (+1 8xx) must pass Twilio's toll-free verification
  // before ordinary SMS is delivered (error 30032 otherwise).
  if (owned && /^\+18(00|33|44|55|66|77|88)/.test(from)) {
    const tf = await twilio(env, "GET",
      `https://messaging.twilio.com/v1/Tollfree/Verifications?TollfreePhoneNumberSid=${owned.sid}`);
    const v = tf.status === 200 && (tf.body.verifications || [])[0];
    report("tollfree_verification", Boolean(v) && v.status === "TWILIO_APPROVED",
      tf.status === 200 ? `status=${v ? v.status : "none submitted"}` : failure(tf));
  }
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const results = [];
  // ok: true = PASS, false = FAIL, null = not checked (doesn't count).
  const report = (name, ok, detail) => {
    if (ok === null) {
      console.log(`SKIP  ${name}: ${detail}`);
      return;
    }
    results.push({ name, ok });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${detail}`);
  };

  if (args.mode === "read-only") {
    console.log("Twilio live check (read-only: no SMS will be sent)");
    await readOnlyChecks(env, report);
  } else if (args.mode === "send-verify") {
    const to = assertSendAuthorized(args);
    const r = await twilio(env, "POST",
      `https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/Verifications`, { To: to, Channel: "sms" });
    report("verify_send", r.status === 201 && r.body.status === "pending",
      r.status === 201 ? `status=${r.body.status} to=${redactPhone(to)}` : failure(r));
  } else if (args.mode === "check-verify") {
    const to = toVerifyE164(args.to);
    if (!to || !args.code) throw new Error("--check-verify needs --to and --code.");
    const r = await twilio(env, "POST",
      `https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`, { To: to, Code: args.code });
    report("verify_check", r.status === 200 && r.body.status === "approved",
      r.status === 200 ? `status=${r.body.status}` : failure(r));
  }

  const ok = results.length > 0 && results.every((r) => r.ok);
  console.log(ok ? "RESULT: all checks passed" : "RESULT: one or more checks failed");
  return ok;
}

if (require.main === module) {
  main().then(
    (ok) => process.exit(ok ? 0 : 1),
    (err) => {
      console.error(`ERROR: ${err.message}`);
      process.exit(2);
    }
  );
}

module.exports = { parseArgs, assertSendAuthorized, main };
