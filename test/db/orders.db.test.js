// orders, order_items, order_events (merchant portal phase 3a).

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("orders migration", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;
  let merchantId;
  let itemId;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
    [{ id: merchantId }] = await q(`insert into public.merchants (business_name, category, address_line, city, contact_name, contact_email, contact_phone, confirmed_exclusions, status, reviewed_by, reviewed_at)
      values ('TEST Fixture Store', 'grocery', '100 Test Ave', 'Nashville', 'Owner', 'orders@example.test', '+16155550100', true, 'approved', 'admin@example.test', now()) returning id`);
    [{ id: itemId }] = await q("insert into public.catalog_items (merchant_id, name, price_cents) values ($1, 'Whole milk', 449) returning id", [merchantId]);
  });
  afterAll(async () => {
    if (db) await db.drop();
  });
  beforeEach(async () => {
    await q("alter table public.order_events disable trigger order_events_no_update");
    await q("truncate public.order_events, public.order_items, public.orders");
    await q("alter table public.order_events enable trigger order_events_no_update");
  });

  let n = 0;
  const order = (extra = {}) => {
    n += 1;
    const row = { order_number: `HT-TEST${String(n).padStart(2, "0")}`.slice(0, 9), merchant_id: merchantId, rider_id: "rider-1", order_type: "grocery", items_subtotal_cents: 449, tax_cents: 0, tax_rate_bps: 0, delivery_fee_cents: 1150, authorized_cents: 1666, client_order_key: `key-${n}-abcdef`, quote_jti: `jti-${n}`, ...extra };
    const cols = Object.keys(row);
    return q(`insert into public.orders (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, Object.values(row));
  };

  test("a new order waits for payment, with nothing captured", async () => {
    const [o] = await order();
    expect(o).toMatchObject({ status: "pending_payment", captured_cents: 0, refunded_cents: 0, livemode: false, tip_cents: 0 });
  });

  test("checkout is safe to retry: one order per rider and key; a fee quote is single-use", async () => {
    await order({ client_order_key: "same-key-123", quote_jti: "j1" });
    await expect(order({ client_order_key: "same-key-123", quote_jti: "j2" })).rejects.toThrow(/orders_rider_key_idx/);
    await order({ client_order_key: "same-key-123", quote_jti: "j3", rider_id: "rider-2" });
    await expect(order({ quote_jti: "j1" })).rejects.toThrow(/quote_jti/);
  });

  test("money can't go negative, capture can't exceed the authorization, refunds can't exceed the capture", async () => {
    await expect(order({ tax_cents: -1 })).rejects.toThrow(/check/);
    await expect(order({ tip_cents: 50001 })).rejects.toThrow(/check/);
    await expect(order({ captured_cents: 1667 })).rejects.toThrow(/check/);
    const [o] = await order({ captured_cents: 1000 });
    await expect(q("update public.orders set refunded_cents = 1001 where id = $1", [o.id])).rejects.toThrow(/check/);
  });

  test("statuses are a fixed list; rejections and store/staff cancels need a reason; accepted needs a prep time", async () => {
    await expect(order({ status: "shipped", placed_at: new Date() })).rejects.toThrow(/orders_status_check/);
    const [o] = await order({ status: "placed", placed_at: new Date() });
    await expect(q("update public.orders set status = 'rejected' where id = $1", [o.id])).rejects.toThrow(/check/);
    await q("update public.orders set status = 'rejected', cancel_reason = 'Closing early' where id = $1", [o.id]);
    const [p] = await order({ status: "placed", placed_at: new Date() });
    await expect(q("update public.orders set status = 'accepted', accepted_at = now() where id = $1", [p.id])).rejects.toThrow(/check/);
    await q("update public.orders set status = 'accepted', accepted_at = now(), prep_minutes = 15 where id = $1", [p.id]);
    await expect(order({ status: "placed" })).rejects.toThrow(/check/);
  });

  test("order items copy name and price; quantity 1-20; a substitution choice from the list", async () => {
    const [o] = await order();
    const add = (extra = {}) => q("insert into public.order_items (order_id, catalog_item_id, name, unit_price_cents, quantity, substitution_choice) values ($1, $2, $3, $4, $5, $6) returning *",
      [o.id, itemId, extra.name ?? "Whole milk", extra.price ?? 449, extra.qty ?? 1, extra.choice ?? "refund"]);
    expect((await add())[0]).toMatchObject({ fulfilment: "pending", tax_cents: 0 });
    await expect(add({ qty: 21 })).rejects.toThrow(/check/);
    await expect(add({ choice: "anything" })).rejects.toThrow(/check/);
    await expect(add({ price: 0 })).rejects.toThrow(/check/);
    // An ordered catalog item can't be deleted out from under the order.
    await expect(q("delete from public.catalog_items where id = $1", [itemId])).rejects.toThrow(/foreign key/);
  });

  test("order history is append-only", async () => {
    const [o] = await order();
    const [e] = await q("insert into public.order_events (order_id, from_status, to_status, actor_type, actor_id) values ($1, null, 'pending_payment', 'rider', 'rider-1') returning id", [o.id]);
    await expect(q("update public.order_events set reason = 'x' where id = $1", [e.id])).rejects.toThrow(/append-only/);
    await expect(q("delete from public.order_events where id = $1", [e.id])).rejects.toThrow(/append-only/);
    await expect(q("insert into public.order_events (order_id, to_status, actor_type) values ($1, 'placed', 'robot')", [o.id])).rejects.toThrow(/actor_type/);
  });

  test("server-only: RLS on, no policies, no anon or signed-in access", async () => {
    const rows = await q("select relname, relrowsecurity from pg_class where oid in ('public.orders'::regclass, 'public.order_items'::regclass, 'public.order_events'::regclass)");
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    const [{ n: policies }] = await q("select count(*)::int as n from pg_policies where tablename in ('orders', 'order_items', 'order_events')");
    expect(policies).toBe(0);
    const [g] = await q(`select has_table_privilege('anon', 'public.orders', 'select') as a, has_table_privilege('authenticated', 'public.order_items', 'insert') as b, has_table_privilege('anon', 'public.order_events', 'select') as c`);
    expect(g).toEqual({ a: false, b: false, c: false });
  });
});
