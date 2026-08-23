#!/usr/bin/env node
// One-time, manually-run script to create (or rotate the password for)
// the two Google Play reviewer accounts. NOT wired into server.js, not
// run automatically by any deploy step, and not part of the test suite
// -- this is an operator tool, run by hand, exactly once per
// create-or-rotate action.
//
// What it does:
//   1. Generates two strong, random passwords (one rider, one driver)
//      using crypto -- never derived from anything guessable.
//   2. Hashes them with lib/reviewAccounts.js's hashReviewPassword
//      (scrypt + random salt) -- the plaintext password is never
//      written to disk, a log, or a git-tracked file by this script.
//   3. Upserts the two review rows directly via the Supabase service
//      role key, with is_review_account = true and every readiness
//      field pre-set to a synthetic "already verified" value -- per
//      the approved requirement, this NEVER calls Persona, Checkr,
//      Twilio, or SendGrid to manufacture those facts.
//   4. Prints the two plaintext passwords to stdout ONCE, with a
//      warning to copy them into your password manager / secure
//      handoff channel immediately -- this script does not save them
//      anywhere, and re-running it (or losing the printed output)
//      means generating new ones, not recovering the old ones.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-review-accounts.js
//
// Before running against production for the first time: confirm the
// column names below (email/phone/status/approval_status/etc.) still
// match the live riders/drivers schema -- this script intentionally
// sets only the fields this session's investigation confirmed exist
// and matter for readiness (see lib/driverCompliance.js's
// computeDriverReadiness and server.js's getRiderReadiness); it is not
// a substitute for checking the live schema with
// `mcp__Supabase__list_tables` or an equivalent inspection first.

const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { hashReviewPassword } = require("../lib/reviewAccounts");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function generatePassword() {
  // 24 random bytes -> 32-character base64url string. Well above the
  // 12-character minimum hashReviewPassword enforces, and no character
  // class requirements to satisfy since nothing here is typed by a
  // human choosing their own password.
  return crypto.randomBytes(24).toString("base64url");
}

async function main() {
  const SUPABASE_URL = requireEnv("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const now = new Date().toISOString();

  const riderPassword = generatePassword();
  const driverPassword = generatePassword();
  const riderCreds = hashReviewPassword(riderPassword);
  const driverCreds = hashReviewPassword(driverPassword);

  // Synthetic, clearly-labeled test data throughout -- no real name,
  // phone, email, or identity document ever appears here. The
  // "+1555" phone block and ".test" email TLD are both reserved for
  // documentation/example use and are not real deliverable
  // destinations, so notifyRideStage()'s is_review_ride suppression
  // (server.js) is a second, independent layer on top of this, not
  // the only thing preventing a stray real send.
  const reviewRider = {
    id: "RIDER_GPLAY_REVIEWER",
    email: "google-play-reviewer-rider@harveytaxi.test",
    phone: "+15555550100",
    first_name: "Google Play",
    last_name: "Reviewer (Rider)",
    is_review_account: true,
    review_password_salt: riderCreds.salt,
    review_password_hash: riderCreds.hash,
    status: "active",
    approval_status: "approved",
    approved_at: now,
    access_revoked: false,
    email_verified: true,
    sms_verified: true,
    persona_status: "verified",
    persona_verified: true,
    updated_at: now
  };

  const reviewDriver = {
    id: "DRIVER_GPLAY_REVIEWER",
    email: "google-play-reviewer-driver@harveytaxi.test",
    phone: "+15555550101",
    first_name: "Google Play",
    last_name: "Reviewer (Driver)",
    is_review_account: true,
    review_password_salt: driverCreds.salt,
    review_password_hash: driverCreds.hash,
    status: "active",
    approval_status: "approved",
    approved_at: now,
    access_revoked: false,
    online: false,
    email_verified: true,
    phone_verified: true,
    persona_status: "verified",
    persona_verified: true,
    checkr_status: "clear",
    vehicle_make: "Toyota",
    vehicle_model: "Camry",
    vehicle_year: 2022,
    updated_at: now
  };

  const { error: riderError } = await supabase.from("riders").upsert(reviewRider);
  if (riderError) {
    console.error("Failed to upsert the review rider row:", riderError.message);
    process.exit(1);
  }

  const { error: driverError } = await supabase.from("drivers").upsert(reviewDriver);
  if (driverError) {
    console.error("Failed to upsert the review driver row:", driverError.message);
    process.exit(1);
  }

  console.log("Google Play reviewer accounts created/updated.");
  console.log("");
  console.log("Copy these into your secure handoff channel NOW -- they are not stored anywhere else and will not be printed again:");
  console.log("");
  console.log(`  Rider email:     ${reviewRider.email}`);
  console.log(`  Rider password:  ${riderPassword}`);
  console.log("");
  console.log(`  Driver email:    ${reviewDriver.email}`);
  console.log(`  Driver password: ${driverPassword}`);
  console.log("");
  console.log("review_account_login_enabled is still off by default. Enable it only after verifying both accounts sign in correctly:");
  console.log("  POST /api/admin/system/enable-review-account-login");
}

main().catch((err) => {
  console.error("Unexpected failure:", err);
  process.exit(1);
});
