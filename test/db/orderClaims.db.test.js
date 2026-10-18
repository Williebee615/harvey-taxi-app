// Step 3c-4: the proposal and ledger-debit rows lib/orders.js builds are
// accepted by the real tables (amounts add up, debit matches the credit rules).

const { describeDb, createTestDatabase } = require("./pgHarness");
const orderRules = require("../../lib/orders");

jest.setTimeout(60_000);

describeDb("missing-item refund rows", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;
  const insert = (table, row) => {
    const cols = Object.keys(row);
    return q(`insert into public.${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, Object.values(row).map((v) => (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) ? JSON.stringify(v) : Array.isArray(v) && v.length && typeof v[0] === "object" ? JSON.stringify(v) : v)));
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
  });
  afterAll(async () => {
    if (db) await db.drop();
  });

  test("a planned claim, its refund and the store's debit are valid rows", async () => {
    const [{ id: merchantId }] = await q(`insert into public.merchants (business_name, category, address_line, city, contact_name, contact_email, contact_phone, confirmed_exclusions, status, reviewed_by, reviewed_at)
      values ('TEST Claims Store', 'grocery', '1 Test St', 'Nashville', 'Owner', 'claims@example.test', '+16155550100', true, 'approved', 'admin@example.test', now()) returning id`);
    const deliveredAt = new Date(Date.now() - 3600000).toISOString();
    const [order] = await q(`insert into public.orders (order_number, merchant_id, rider_id, order_type, status, placed_at, items_subtotal_cents, tax_cents, tax_rate_bps, delivery_fee_cents, authorized_cents, captured_cents, client_order_key, quote_jti, delivered_at)
      values ('HT-CLAIM1', $1, 'rider-1', 'grocery', 'completed', now(), 1223, 123, 1000, 1150, 3000, 2696, 'claims-key-1', 'claims-jti-1', $2) returning *`, [merchantId, deliveredAt]);
    const [milk] = await q("insert into public.order_items (order_id, name, unit_price_cents, quantity, substitution_choice, fulfilment) values ($1, 'Whole milk', 449, 2, 'best_match', 'packed') returning *", [order.id]);
    const planned = orderRules.planOrderClaim({ order, items: [milk], claim: [{ order_item_id: milk.id, quantity: 1 }] });
    expect(planned.ok).toBe(true);
    const [p] = await insert("order_refund_proposals", planned.row);
    expect(p).toMatchObject({ status: "pending_review", customer_refund_cents: 494, merchant_deduction_cents: 395, commission_reversed_cents: 54 });
    await q("update public.order_refund_proposals set status = 'approved', reviewed_by = 'owner@example.test', reviewed_at = now() where id = $1", [p.id]);
    const [refunded] = await q("update public.order_refund_proposals set status = 'refunded', stripe_refund_id = 're_3TestRefund1', refunded_at = now(), merchant_notified_at = now() - interval '49 hours' where id = $1 returning *", [p.id]);
    const entry = orderRules.deductionEntry(refunded);
    expect(entry).not.toBeNull();
    const [debit] = await insert("store_ledger_entries", entry);
    expect(debit).toMatchObject({ entry_type: "refund_deduction", commission_cents: -54, store_amount_cents: -395 });
    await expect(insert("store_ledger_entries", entry)).rejects.toThrow(/store_ledger_one_deduction_per_proposal/);
  });
});
