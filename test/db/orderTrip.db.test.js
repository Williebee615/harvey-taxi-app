// Step 3c-3: the order's drop-off address and one order per delivery trip.

const { describeDb, createTestDatabase } = require("./pgHarness");

jest.setTimeout(60_000);

describeDb("order trip migration", () => {
  let db;
  let admin;
  const q = async (sql, params) => (await admin.query(sql, params)).rows;
  let merchantId;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
    [{ id: merchantId }] = await q(`insert into public.merchants (business_name, category, address_line, city, contact_name, contact_email, contact_phone, confirmed_exclusions, status, reviewed_by, reviewed_at)
      values ('TEST Trip Store', 'grocery', '1 Test St', 'Nashville', 'Owner', 'trip@example.test', '+16155550100', true, 'approved', 'admin@example.test', now()) returning id`);
  });
  afterAll(async () => {
    if (db) await db.drop();
  });

  const order = (n, extra = "") => q(`insert into public.orders (order_number, merchant_id, rider_id, order_type, items_subtotal_cents, tax_cents, tax_rate_bps, delivery_fee_cents, authorized_cents, client_order_key, quote_jti${extra ? ", " + extra.split("=")[0] : ""})
    values ('HT-TRIP0${n}', $1, 'rider-1', 'grocery', 100, 0, 0, 0, 100, 'trip-key-${n}', 'trip-jti-${n}'${extra ? ", " + extra.split("=")[1] : ""}) returning *`, [merchantId]);

  test("drop-off address: optional text, 3 to 300 characters", async () => {
    const [o] = await order(1, "dropoff_address='501 Broadway, Nashville, TN 37203'");
    expect(o.dropoff_address).toBe("501 Broadway, Nashville, TN 37203");
    const [none] = await order(2);
    expect(none.dropoff_address).toBeNull();
    await expect(order(3, "dropoff_address='  '")).rejects.toThrow(/orders_dropoff_address_check/);
  });

  test("one order per delivery trip", async () => {
    await order(4, "ride_id='RIDE-TRIP-1'");
    await expect(order(5, "ride_id='RIDE-TRIP-1'")).rejects.toThrow(/orders_ride_id_key/);
    await order(6);
    await order(7);
  });

  test("the delivery trip an order starts is a valid rides row (no payment of its own)", async () => {
    const orderRules = require("../../lib/orders");
    const fields = orderRules.orderTripFields({
      order: { order_number: "HT-TRIP09", rider_id: "rider-1", order_type: "grocery", delivery_fee_cents: 1150, tip_cents: 200, dropoff_lat: 36.1745, dropoff_lng: -86.7679, dropoff_address: "501 Broadway, Nashville" },
      store: { business_name: "TEST Trip Store", address_line: "1 Test St", city: "Nashville", pickup_lat: 36.1627, pickup_lng: -86.7816 },
      riderName: "Ana", riderPhone: "+16155550111", items: [{ quantity: 2 }, { quantity: 1 }], driverPayoutPercent: 0.7, deliveryPin: "4821"
    });
    const row = { id: "RIDE-TRIP-DB-1", ...fields, status: "payment_authorized", dispatch_status: "ready_to_dispatch" };
    const cols = Object.keys(row);
    const [ride] = await q(`insert into public.rides (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, Object.values(row));
    expect(ride).toMatchObject({ ride_type: "grocery", payment_status: "not_required", payment_id: null, delivery_pin: "4821", item_count: 3 });
    expect(Number(ride.driver_payout)).toBeCloseTo(8.05);
    expect(Number(ride.tip_amount)).toBeCloseTo(2);
  });
});

