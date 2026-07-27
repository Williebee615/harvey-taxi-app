// Confirms the rider-approval gate is still enforced inside the merged
// wizard: an unapproved rider is blocked with a clear message, an
// approved rider is not. This exercises the wizard's real
// checkRiderApproval() function (dispatched directly on #checkRiderBtn,
// since it's bound unconditionally in bindEvents() regardless of which
// wizard stage is currently visible — the button itself lives on the
// payment stage, which this test does not need to navigate to).
//
// Full payment authorization + dispatch submission (Stripe confirm,
// POST /api/rides/request, live driver assignment) requires filling the
// entire multi-stage form and is exercised in the manual production
// click-through this branch is held for — see the PR description.
const { test, expect } = require("@playwright/test");
const { startTestServer } = require("./helpers/testServer");

async function seedRiderFormFields(page) {
  await page.addInitScript(() => {
    localStorage.setItem("harvey_rider_id", "RIDER-GATE-TEST");
    localStorage.setItem("harvey_rider_name", "Jordan Rivera");
    localStorage.setItem("harvey_rider_phone", "+16155551234");
    localStorage.setItem("harvey_rider_email", "jordan@example.test");
  });
}

async function clickCheckRiderApproval(page) {
  await page.evaluate(() => {
    document
      .getElementById("checkRiderBtn")
      .dispatchEvent(new Event("click", { bubbles: true }));
  });
}

test("an unapproved rider sees the approval-required notice and is not marked approved", async ({ page }) => {
  const server = await startTestServer({
    readiness: (req, res) =>
      res.json({ ok: true, rider: { id: req.params.id, approved: false, verified: false, status: "pending_verification" } })
  });

  try {
    await seedRiderFormFields(page);
    await page.goto(`${server.url}/rider-dashboard.html?mode=driver`, { waitUntil: "networkidle" });

    await clickCheckRiderApproval(page);
    await page.waitForFunction(
      () => document.getElementById("noticeBox").textContent.trim().length > 0
    );

    const notice = await page.locator("#noticeBox").textContent();
    expect(notice).toContain("not approved yet");

    const badge = await page.locator("#statusBadgeText").textContent();
    expect(badge.trim()).toBe("Approval Needed");
  } finally {
    await server.close();
  }
});

test("an approved rider passes the check with no blocking notice", async ({ page }) => {
  const server = await startTestServer({
    readiness: (req, res) =>
      res.json({ ok: true, rider: { id: req.params.id, approved: true, verified: true, status: "active" } })
  });

  try {
    await seedRiderFormFields(page);
    await page.goto(`${server.url}/rider-dashboard.html?mode=driver`, { waitUntil: "networkidle" });

    await clickCheckRiderApproval(page);
    await page.waitForFunction(
      () => document.getElementById("statusBadgeText").textContent.trim() === "Rider Approved"
    );

    const notice = await page.locator("#noticeBox").textContent();
    expect(notice).not.toContain("not approved");
  } finally {
    await server.close();
  }
});
