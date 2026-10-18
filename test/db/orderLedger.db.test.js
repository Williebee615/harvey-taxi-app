// Step 3c-1: "Contact me first" fields, missing-item refund proposals and
// the append-only store ledger (owner decisions 2026-10-18).

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("order ledger migration", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;
  let merchantId;
  let orderId;
  let n = 0;

  const insert = (table, row) => {
    const cols = Object.keys(row);
    return q(`insert into public.${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, Object.values(row));
  };
  const item = (extra = {}) => insert("order_items", { order_id: orderId, name: "Whole milk", unit_price_cents: 449, quantity: 2, substitution_choice: "contact", ...extra });
  const proposal = (extra = {}) => {
    n += 1;
    return insert("order_refund_proposals", {
      order_id: orderId, merchant_id: merchantId, rider_id: "rider-1", lines: JSON.stringify([{ item_id: "i1", quantity: 1, item_cents: 449 }]),
      idempotency_key: `mir_${String(n).padStart(32, "0")}`, claimed_at: "2026-10-19T12:00:00Z",
      customer_refund_cents: 493, item_cents: 449, tax_cents: 44, merchant_deduction_cents: 395, commission_reversed_cents: 54, ...extra
    });
  };
  // 2026-10-19 is a Monday.
  const credit = (extra = {}) => insert("store_ledger_entries", { merchant_id: merchantId, order_id: orderId, entry_type: "order_credit", payout_week_start: "2026-10-19", items_cents: 1223, tax_cents: 113, delivery_fee_cents: 1150, tip_cents: 300, commission_cents: 147, store_amount_cents: 1076, created_by: "system:capture", ...extra });

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
    [{ id: merchantId }] = await q(`insert into public.merchants (business_name, category, address_line, city, contact_name, contact_email, contact_phone, confirmed_exclusions, status, reviewed_by, reviewed_at)
      values ('TEST Ledger Store', 'grocery', '1 Test St', 'Nashville', 'Owner', 'ledger@example.test', '+16155550100', true, 'approved', 'admin@example.test', now()) returning id`);
    [{ id: orderId }] = await q(`insert into public.orders (order_number, merchant_id, rider_id, order_type, items_subtotal_cents, tax_cents, tax_rate_bps, delivery_fee_cents, authorized_cents, client_order_key, quote_jti)
      values ('HT-LEDGR1', $1, 'rider-1', 'grocery', 1223, 113, 925, 1150, 2879, 'ledger-key-1', 'ledger-jti-1') returning id`, [merchantId]);
  });
  afterAll(async () => {
    if (db) await db.drop();
  });

  test("contact-me-first: asked, expires after, answered substitute or refund; only for items set to contact", async () => {
    const [i] = await item();
    expect(i).toMatchObject({ fulfilment: "pending", refunded_quantity: 0, substitution_asked_at: null });
    await q("update public.order_items set substitution_asked_at = now(), substitution_expires_at = now() + interval '7 minutes' where id = $1", [i.id]);
    await q("update public.order_items set substitution_answer = 'substitute', substitution_answered_at = now() where id = $1", [i.id]);
    await expect(q("update public.order_items set substitution_answer = 'maybe' where id = $1", [i.id])).rejects.toThrow(/order_items_substitution_answer_check/);
    await expect(item({ substitution_asked_at: "2026-10-18T10:07:00Z", substitution_expires_at: "2026-10-18T10:00:00Z" })).rejects.toThrow(/order_items_substitution_times_check/);
    await expect(item({ substitution_asked_at: "2026-10-18T10:00:00Z", substitution_expires_at: "2026-10-18T10:07:00Z", substitution_answer: "refund" })).rejects.toThrow(/order_items_substitution_times_check/);
    await expect(item({ substitution_choice: "refund", substitution_asked_at: "2026-10-18T10:00:00Z", substitution_expires_at: "2026-10-18T10:07:00Z" })).rejects.toThrow(/order_items_substitution_contact_check/);
    await expect(q("update public.order_items set refunded_quantity = 3 where id = $1", [i.id])).rejects.toThrow(/order_items_refunded_quantity_check/);
  });

  test("refund proposals: amounts add up; approved is not refunded; each outcome needs its record", async () => {
    const [p] = await proposal();
    expect(p).toMatchObject({ status: "pending_review", review_priority: "routine", market: "nashville", livemode: false });
    await expect(proposal({ customer_refund_cents: 500 })).rejects.toThrow(/check/);
    await expect(proposal({ merchant_deduction_cents: 449 })).rejects.toThrow(/check/);
    await expect(q("update public.order_refund_proposals set status = 'approved' where id = $1", [p.id])).rejects.toThrow(/check/);
    await q("update public.order_refund_proposals set status = 'approved', reviewed_by = 'staff@example.test', reviewed_at = now() where id = $1", [p.id]);
    await expect(q("update public.order_refund_proposals set status = 'refunded' where id = $1", [p.id])).rejects.toThrow(/check/);
    await q("update public.order_refund_proposals set status = 'refunded', stripe_refund_id = 're_test123', refunded_at = now() where id = $1", [p.id]);
    const [p2] = await proposal({ review_priority: "high_risk_review" });
    await expect(q("update public.order_refund_proposals set status = 'declined', reviewed_by = 's', reviewed_at = now() where id = $1", [p2.id])).rejects.toThrow(/check/);
    await expect(q("update public.order_refund_proposals set status = 'refund_failed', reviewed_by = 's', reviewed_at = now() where id = $1", [p2.id])).rejects.toThrow(/check/);
    await expect(proposal({ review_priority: "urgent" })).rejects.toThrow(/check/);
    await expect(proposal({ idempotency_key: p.idempotency_key })).rejects.toThrow(/duplicate key/);
    await expect(proposal({ lines: "[]" })).rejects.toThrow(/check/);
    await expect(proposal({ dispute_outcome: "pending" })).rejects.toThrow(/check/);
  });

  test("store ledger: commission on items only; one credit per order; payout weeks start Monday; rows can't change", async () => {
    const [c] = await credit();
    expect(c).toMatchObject({ commission_rate_bps: 1200, commission_cents: 147, store_amount_cents: 1076, livemode: false });
    // Commission on the total charged instead of the items is refused.
    const [{ id: order2 }] = await q(`insert into public.orders (order_number, merchant_id, rider_id, order_type, items_subtotal_cents, tax_cents, tax_rate_bps, delivery_fee_cents, authorized_cents, client_order_key, quote_jti)
      values ('HT-LEDGR2', $1, 'rider-1', 'food', 1000, 0, 0, 500, 1500, 'ledger-key-2', 'ledger-jti-2') returning id`, [merchantId]);
    await expect(credit({ order_id: order2, items_cents: 1000, commission_cents: 333, store_amount_cents: 667 })).rejects.toThrow(/check/);
    await expect(credit({ order_id: order2, items_cents: 1000, commission_cents: 120, store_amount_cents: 900 })).rejects.toThrow(/check/);
    await expect(credit({ order_id: order2, items_cents: 1000, commission_cents: 120, store_amount_cents: 880, payout_week_start: "2026-10-20" })).rejects.toThrow(/check/);
    await credit({ order_id: order2, items_cents: 1000, tax_cents: 0, delivery_fee_cents: 500, tip_cents: 0, commission_cents: 120, store_amount_cents: 880 });
    await expect(credit()).rejects.toThrow(/store_ledger_one_credit_per_order/);

    const [p] = await proposal();
    const deduction = { merchant_id: merchantId, order_id: orderId, refund_proposal_id: p.id, entry_type: "refund_deduction", payout_week_start: "2026-10-26", items_cents: 449, tax_cents: 44, commission_cents: -54, store_amount_cents: -395, created_by: "system:dispute_window" };
    await expect(insert("store_ledger_entries", { ...deduction, refund_proposal_id: null })).rejects.toThrow(/check/);
    await insert("store_ledger_entries", deduction);
    await expect(insert("store_ledger_entries", deduction)).rejects.toThrow(/store_ledger_one_deduction_per_proposal/);

    const [{ balance }] = await q("select sum(store_amount_cents)::int as balance from public.store_ledger_entries where merchant_id = $1", [merchantId]);
    expect(balance).toBe(1076 + 880 - 395);
    await expect(q("update public.store_ledger_entries set store_amount_cents = 0 where id = $1", [c.id])).rejects.toThrow(/append-only/);
    await expect(q("delete from public.store_ledger_entries where id = $1", [c.id])).rejects.toThrow(/append-only/);
  });

  test("server-only: RLS on, no policies, no client access", async () => {
    const rows = await q(`select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname)::int as policies
      from pg_class c where c.relname in ('order_refund_proposals', 'store_ledger_entries') order by 1`);
    expect(rows).toEqual([
      { relname: "order_refund_proposals", relrowsecurity: true, policies: 0 },
      { relname: "store_ledger_entries", relrowsecurity: true, policies: 0 }
    ]);
    const grants = await q(`select table_name, grantee from information_schema.role_table_grants where table_name in ('order_refund_proposals', 'store_ledger_entries') and grantee in ('anon', 'authenticated')`);
    expect(grants).toEqual([]);
  });
});
