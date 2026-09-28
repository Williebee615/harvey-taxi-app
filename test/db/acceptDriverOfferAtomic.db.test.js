// Database tests for accept_driver_offer_atomic() and the corrected
// dispatch_ride_atomic() / nearest_drivers(), run against a real Postgres
// built from the live-schema baseline plus the actual migration files.
// See test/db/pgHarness.js for how to enable them.

const { describeDb, createTestDatabase, waitForLockWaiters } = require("./pgHarness");

jest.setTimeout(30_000);

const ACCEPT = "select * from public.accept_driver_offer_atomic($1, $2)";

describeDb("dispatch migrations against a live-schema Postgres", () => {
  let db;
  let admin; // superuser session: seeding and assertions only
  let svc; // service_role session: how server.js calls the functions

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await db.connect();
    svc = await db.connect("service_role");
  });

  afterAll(async () => {
    if (db) await db.drop();
  });

  beforeEach(async () => {
    await admin.query("truncate public.driver_offers, public.rides, public.drivers");
  });

  // ---------------------------------------------------------------- fixtures

  async function driver(id, overrides = {}) {
    const row = {
      id,
      first_name: "Dana",
      last_name: id,
      phone: "+15555550100",
      vehicle_year: "2022",
      vehicle_make: "Toyota",
      vehicle_model: "Camry",
      online: true,
      status: "active",
      approval_status: "approved",
      access_revoked: false,
      ...overrides
    };
    const cols = Object.keys(row);
    await admin.query(
      `insert into public.drivers (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")})`,
      Object.values(row)
    );
  }

  async function ride(id, overrides = {}) {
    const row = {
      id,
      rider_id: "RIDER-1",
      status: "awaiting_driver_acceptance",
      dispatch_status: "offer_sent",
      dispatch_attempts: 1,
      driver_id: null,
      ...overrides
    };
    const cols = Object.keys(row);
    await admin.query(
      `insert into public.rides (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")})`,
      Object.values(row)
    );
  }

  async function offer(id, rideId, driverId, overrides = {}) {
    const row = {
      id,
      ride_id: rideId,
      driver_id: driverId,
      status: "pending",
      attempt: 1,
      expires_at: new Date(Date.now() + 60_000),
      ...overrides
    };
    const cols = Object.keys(row);
    await admin.query(
      `insert into public.driver_offers (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")})`,
      Object.values(row)
    );
  }

  const getRide = async (id) =>
    (await admin.query("select * from public.rides where id = $1", [id])).rows[0];
  const getOffer = async (id) =>
    (await admin.query("select * from public.driver_offers where id = $1", [id])).rows[0];
  const offerStatuses = async (rideId) =>
    Object.fromEntries(
      (await admin.query("select id, status from public.driver_offers where ride_id = $1", [rideId])).rows.map(
        (r) => [r.id, r.status]
      )
    );

  async function accept(client, offerId, driverId) {
    const { rows } = await client.query(ACCEPT, [offerId, driverId]);
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  // Holds a lock in its own open transaction until release() is called.
  async function gate(lockSql, params = []) {
    const c = await db.connect();
    await c.query("begin");
    await c.query(lockSql, params);
    return {
      client: c,
      release: async () => {
        await c.query("commit");
      }
    };
  }

  // The function's complete, allow-listed result shape. Anything else on
  // the rides row (payment ids, pricing/route snapshots, locations,
  // reconciliation and audit fields) must never be returned.
  const RESULT_COLUMNS = [
    "outcome",
    "ride_id",
    "offer_id",
    "driver_id",
    "ride_status",
    "rider_id",
    "rider_phone",
    "ride_type",
    "is_review_ride",
    "driver_name",
    "driver_vehicle",
    "driver_phone"
  ];

  // A losing outcome carries nothing but the outcome itself.
  function expectNoRideDisclosure(result) {
    expect(Object.keys(result).sort()).toEqual([...RESULT_COLUMNS].sort());
    for (const col of RESULT_COLUMNS) {
      if (col !== "outcome") expect(result[col]).toBeNull();
    }
  }

  // ------------------------------------------------------------- happy path

  describe("accept_driver_offer_atomic", () => {
    test("assigns rides.driver_id, accepts the offer, supersedes competitors, all in one commit", async () => {
      await driver("DRV-A");
      await driver("DRV-B");
      await ride("RIDE-1", { assigned_driver_id: "11111111-1111-1111-1111-111111111111" });
      await offer("OFFER-A", "RIDE-1", "DRV-A");
      await offer("OFFER-B", "RIDE-1", "DRV-B");

      const result = await accept(svc, "OFFER-A", "DRV-A");

      expect(result).toEqual({
        outcome: "accepted",
        ride_id: "RIDE-1",
        offer_id: "OFFER-A",
        driver_id: "DRV-A",
        ride_status: "driver_assigned",
        rider_id: "RIDER-1",
        rider_phone: null,
        ride_type: null,
        is_review_ride: false,
        driver_name: "Dana DRV-A",
        driver_vehicle: "2022 Toyota Camry",
        driver_phone: "+15555550100"
      });

      const r = await getRide("RIDE-1");
      expect(r.driver_id).toBe("DRV-A");
      expect(r.status).toBe("driver_assigned");
      expect(r.dispatch_status).toBe("accepted");
      expect(r.accepted_at).not.toBeNull();
      expect(r.driver_name).toBe("Dana DRV-A");
      expect(r.driver_vehicle).toBe("2022 Toyota Camry");
      expect(r.driver_phone).toBe("+15555550100");
      // Unused uuid schema debt: never touched.
      expect(r.assigned_driver_id).toBe("11111111-1111-1111-1111-111111111111");

      expect(await offerStatuses("RIDE-1")).toEqual({ "OFFER-A": "accepted", "OFFER-B": "superseded" });
      expect((await getOffer("OFFER-A")).responded_at).not.toBeNull();
    });

    test("leaves a null assigned_driver_id null", async () => {
      await driver("DRV-A");
      await ride("RIDE-1");
      await offer("OFFER-A", "RIDE-1", "DRV-A");

      await accept(svc, "OFFER-A", "DRV-A");

      expect((await getRide("RIDE-1")).assigned_driver_id).toBeNull();
    });

    test("accepts from payment_authorized (dispatch that never recorded offer_sent)", async () => {
      await driver("DRV-A");
      await ride("RIDE-1", { status: "payment_authorized", dispatch_status: null });
      await offer("OFFER-A", "RIDE-1", "DRV-A");

      expect((await accept(svc, "OFFER-A", "DRV-A")).outcome).toBe("accepted");
    });

    // ------------------------------------------------------- concurrency

    test("two drivers racing to accept different offers for the same ride: exactly one wins", async () => {
      await driver("DRV-A");
      await driver("DRV-B");
      await ride("RIDE-1");
      await offer("OFFER-A", "RIDE-1", "DRV-A");
      await offer("OFFER-B", "RIDE-1", "DRV-B");

      const [c1, c2] = [await db.connect("service_role"), await db.connect("service_role")];
      const g = await gate("select 1 from public.rides where id = 'RIDE-1' for update");

      const racing = Promise.all([accept(c1, "OFFER-A", "DRV-A"), accept(c2, "OFFER-B", "DRV-B")]);
      await waitForLockWaiters(g.client, 2);
      await g.release();
      const results = await racing;

      const winners = results.filter((r) => r.outcome === "accepted");
      const losers = results.filter((r) => r.outcome !== "accepted");
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(losers[0].outcome).toBe("offer_not_pending");
      expectNoRideDisclosure(losers[0]);

      const winnerDriver = winners[0].driver_id;
      const r = await getRide("RIDE-1");
      expect(r.driver_id).toBe(winnerDriver);

      const statuses = await offerStatuses("RIDE-1");
      const winnerOffer = winnerDriver === "DRV-A" ? "OFFER-A" : "OFFER-B";
      const loserOffer = winnerOffer === "OFFER-A" ? "OFFER-B" : "OFFER-A";
      expect(statuses[winnerOffer]).toBe("accepted");
      expect(statuses[loserOffer]).toBe("superseded");
    });

    test("one driver racing to accept offers for two rides: exactly one assignment, no partial state", async () => {
      await driver("DRV-A");
      await ride("RIDE-1");
      await ride("RIDE-2");
      await offer("OFFER-1", "RIDE-1", "DRV-A");
      await offer("OFFER-2", "RIDE-2", "DRV-A");

      const [c1, c2] = [await db.connect("service_role"), await db.connect("service_role")];
      // Different rides, so the ride locks don't collide: gate on the
      // driver-scoped advisory lock both calls must take.
      const g = await gate("select pg_advisory_xact_lock(hashtext('dispatch_driver:' || $1))", ["DRV-A"]);

      const racing = Promise.all([accept(c1, "OFFER-1", "DRV-A"), accept(c2, "OFFER-2", "DRV-A")]);
      await waitForLockWaiters(g.client, 2);
      await g.release();
      const results = await racing;

      expect(results.map((r) => r.outcome).sort()).toEqual(["accepted", "driver_unavailable"]);
      const loser = results.find((r) => r.outcome === "driver_unavailable");
      expectNoRideDisclosure(loser);

      const won = results.find((r) => r.outcome === "accepted").ride_id;
      const lost = won === "RIDE-1" ? "RIDE-2" : "RIDE-1";
      expect((await getRide(won)).driver_id).toBe("DRV-A");
      // The losing ride and its offer are exactly as they were.
      const lostRide = await getRide(lost);
      expect(lostRide.driver_id).toBeNull();
      expect(lostRide.status).toBe("awaiting_driver_acceptance");
      expect((await getOffer(lost === "RIDE-1" ? "OFFER-1" : "OFFER-2")).status).toBe("pending");
    });

    test("concurrent duplicate accepts by the winning driver produce exactly one 'accepted'", async () => {
      await driver("DRV-A");
      await ride("RIDE-1");
      await offer("OFFER-A", "RIDE-1", "DRV-A");

      const conns = await Promise.all([1, 2, 3, 4, 5].map(() => db.connect("service_role")));
      const g = await gate("select 1 from public.rides where id = 'RIDE-1' for update");
      const racing = Promise.all(conns.map((c) => accept(c, "OFFER-A", "DRV-A")));
      await waitForLockWaiters(g.client, conns.length);
      await g.release();
      const results = await racing;

      const outcomes = results.map((r) => r.outcome);
      expect(outcomes.filter((o) => o === "accepted")).toHaveLength(1);
      expect(outcomes.filter((o) => o === "already_accepted")).toHaveLength(conns.length - 1);
    });

    test("an accept racing a dispatch to the same driver neither deadlocks nor double-books", async () => {
      await driver("DRV-A");
      await ride("RIDE-1");
      await ride("RIDE-2", { status: "payment_authorized", dispatch_status: null, dispatch_attempts: 0 });
      await offer("OFFER-1", "RIDE-1", "DRV-A");

      const [c1, c2] = [await db.connect("service_role"), await db.connect("service_role")];
      const g = await gate("select pg_advisory_xact_lock(hashtext('dispatch_driver:' || $1))", ["DRV-A"]);
      const racing = Promise.all([
        accept(c1, "OFFER-1", "DRV-A"),
        c2.query("select * from public.dispatch_ride_atomic($1, $2, 30)", ["RIDE-2", "DRV-A"]).then((r) => r.rows[0])
      ]);
      await waitForLockWaiters(g.client, 2);
      await g.release();
      const [acceptResult, dispatchResult] = await racing;

      // Order-independent: the driver's pending offer for RIDE-1 makes the
      // dispatch ineligible whether it runs before or after the accept,
      // and a pending offer never blocks the accept itself. The point of
      // the test is that neither call deadlocks (40P01) or errors.
      expect(acceptResult.outcome).toBe("accepted");
      expect(dispatchResult.outcome).toBe("driver_no_longer_available");
      expect(await offerStatuses("RIDE-2")).toEqual({});
      expect((await getRide("RIDE-1")).driver_id).toBe("DRV-A");
    });

    // --------------------------------------------------- offer/ride states

    test.each([
      ["expired (status)", { status: "expired" }, "offer_not_pending"],
      ["declined", { status: "declined" }, "offer_not_pending"],
      ["superseded", { status: "superseded" }, "offer_not_pending"],
      ["cancelled", { status: "cancelled" }, "offer_not_pending"],
      ["past expires_at but still pending", { expires_at: new Date(Date.now() - 1000) }, "offer_expired"]
    ])("an offer that is %s returns %s and changes nothing", async (_label, offerOverrides, expected) => {
      await driver("DRV-A");
      await ride("RIDE-1");
      await offer("OFFER-A", "RIDE-1", "DRV-A", offerOverrides);
      const before = await getRide("RIDE-1");
      const offerBefore = await getOffer("OFFER-A");

      const result = await accept(svc, "OFFER-A", "DRV-A");

      expect(result.outcome).toBe(expected);
      expectNoRideDisclosure(result);
      expect(await getRide("RIDE-1")).toEqual(before);
      expect(await getOffer("OFFER-A")).toEqual(offerBefore);
    });

    test("an offer already accepted by another driver's ride assignment is not re-acceptable", async () => {
      await driver("DRV-A");
      await driver("DRV-B");
      await ride("RIDE-1", { status: "driver_assigned", driver_id: "DRV-B" });
      await offer("OFFER-A", "RIDE-1", "DRV-A", { status: "accepted" });

      const result = await accept(svc, "OFFER-A", "DRV-A");

      expect(result.outcome).toBe("offer_not_pending");
      expectNoRideDisclosure(result);
    });

    test("an idempotent retry by the winner returns already_accepted and writes nothing", async () => {
      await driver("DRV-A");
      await ride("RIDE-1");
      await offer("OFFER-A", "RIDE-1", "DRV-A");
      await accept(svc, "OFFER-A", "DRV-A");
      const rideAfterFirst = await getRide("RIDE-1");
      const offerAfterFirst = await getOffer("OFFER-A");

      const retry = await accept(svc, "OFFER-A", "DRV-A");

      // Only what the idempotent success response needs; no notification
      // fields, so a retry can't be mistaken for a fresh assignment.
      expect(retry).toEqual({
        outcome: "already_accepted",
        ride_id: "RIDE-1",
        offer_id: "OFFER-A",
        driver_id: "DRV-A",
        ride_status: "driver_assigned",
        rider_id: null,
        rider_phone: null,
        ride_type: null,
        is_review_ride: null,
        driver_name: null,
        driver_vehicle: null,
        driver_phone: null
      });
      expect(await getRide("RIDE-1")).toEqual(rideAfterFirst);
      expect(await getOffer("OFFER-A")).toEqual(offerAfterFirst);
    });

    test("another driver's offer returns not_offer_owner before anything else is checked", async () => {
      await driver("DRV-A");
      await driver("DRV-B");
      await ride("RIDE-1", { status: "cancelled" });
      await offer("OFFER-A", "RIDE-1", "DRV-A", { status: "expired" });

      const result = await accept(svc, "OFFER-A", "DRV-B");

      expect(result.outcome).toBe("not_offer_owner");
      expectNoRideDisclosure(result);
    });

    test("an unknown offer returns offer_not_found", async () => {
      expect((await accept(svc, "OFFER-NOPE", "DRV-A")).outcome).toBe("offer_not_found");
    });

    test.each([
      ["cancelled", { status: "cancelled" }],
      ["completed", { status: "completed" }],
      ["failed", { status: "failed" }],
      ["already assigned", { status: "driver_assigned", driver_id: "DRV-B" }]
    ])("a ride that is %s returns ride_not_assignable and changes nothing", async (_label, rideOverrides) => {
      await driver("DRV-A");
      await driver("DRV-B");
      await ride("RIDE-1", rideOverrides);
      await offer("OFFER-A", "RIDE-1", "DRV-A");
      const before = await getRide("RIDE-1");

      const result = await accept(svc, "OFFER-A", "DRV-A");

      expect(result.outcome).toBe("ride_not_assignable");
      expectNoRideDisclosure(result);
      expect(await getRide("RIDE-1")).toEqual(before);
      expect((await getOffer("OFFER-A")).status).toBe("pending");
    });

    test("an offer whose ride no longer exists returns ride_not_assignable", async () => {
      await driver("DRV-A");
      await offer("OFFER-A", "RIDE-GONE", "DRV-A");

      expect((await accept(svc, "OFFER-A", "DRV-A")).outcome).toBe("ride_not_assignable");
    });

    test.each([
      ["already on an active ride", async () => ride("RIDE-9", { status: "driver_enroute", driver_id: "DRV-A" })],
      [
        "holding an accepted offer never matched by an assignment",
        async () => {
          await ride("RIDE-9", { status: "awaiting_driver_acceptance" });
          await offer("OFFER-9", "RIDE-9", "DRV-A", { status: "accepted" });
        }
      ],
      ["no longer approved", async () => admin.query("update public.drivers set approval_status = 'suspended' where id = 'DRV-A'")],
      ["access revoked", async () => admin.query("update public.drivers set access_revoked = true where id = 'DRV-A'")]
    ])("a driver %s gets driver_unavailable and nothing changes", async (_label, arrange) => {
      await driver("DRV-A");
      await ride("RIDE-1");
      await offer("OFFER-A", "RIDE-1", "DRV-A");
      await arrange();
      const before = await getRide("RIDE-1");

      const result = await accept(svc, "OFFER-A", "DRV-A");

      expect(result.outcome).toBe("driver_unavailable");
      expectNoRideDisclosure(result);
      expect(await getRide("RIDE-1")).toEqual(before);
      expect((await getOffer("OFFER-A")).status).toBe("pending");
    });

    test("an accepted offer on a finished ride, or a ride since reassigned to someone else, does not block", async () => {
      await driver("DRV-A");
      await driver("DRV-B");
      await ride("RIDE-OLD", { status: "completed", driver_id: "DRV-A" });
      await offer("OFFER-OLD", "RIDE-OLD", "DRV-A", { status: "accepted" });
      await ride("RIDE-REASSIGNED", { status: "driver_assigned", driver_id: "DRV-B" });
      await offer("OFFER-R", "RIDE-REASSIGNED", "DRV-A", { status: "accepted" });
      await ride("RIDE-1");
      await offer("OFFER-A", "RIDE-1", "DRV-A");

      expect((await accept(svc, "OFFER-A", "DRV-A")).outcome).toBe("accepted");
    });

    // ------------------------------------------------ injected failure

    test("a failure after the offer and competitor writes leaves no partial state", async () => {
      await driver("DRV-A");
      await driver("DRV-B");
      await ride("RIDE-1");
      await offer("OFFER-A", "RIDE-1", "DRV-A");
      await offer("OFFER-B", "RIDE-1", "DRV-B");
      const before = await getRide("RIDE-1");

      // The rides update is the function's last write; make it fail.
      await admin.query(`
        create function public.test_fail_ride_assign() returns trigger language plpgsql as $$
        begin
          if new.driver_id is not null then
            raise exception 'injected failure';
          end if;
          return new;
        end $$;
        create trigger test_fail_ride_assign before update on public.rides
          for each row execute function public.test_fail_ride_assign();
      `);
      try {
        await expect(svc.query(ACCEPT, ["OFFER-A", "DRV-A"])).rejects.toThrow("injected failure");
      } finally {
        await admin.query(`
          drop trigger test_fail_ride_assign on public.rides;
          drop function public.test_fail_ride_assign();
        `);
      }

      expect(await getRide("RIDE-1")).toEqual(before);
      expect(await offerStatuses("RIDE-1")).toEqual({ "OFFER-A": "pending", "OFFER-B": "pending" });

      // And the invariant held: no accepted offer without an assignment.
      const { rows } = await admin.query(`
        select o.id from public.driver_offers o
        left join public.rides r on r.id = o.ride_id
        where o.status = 'accepted' and (r.driver_id is distinct from o.driver_id)`);
      expect(rows).toEqual([]);
    });

    test("never returns payment, location, pricing or reconciliation fields from the rides row", async () => {
      await driver("DRV-A");
      await ride("RIDE-1", {
        rider_phone: "+15555550199",
        ride_type: "standard",
        payment_id: "pi_SECRET_PAYMENT",
        payment_status: "authorized",
        pricing_snapshot: JSON.stringify({ secret: "PRICING_SECRET" }),
        route_snapshot: JSON.stringify({ secret: "ROUTE_SECRET" }),
        pickup_lat: 36.123456,
        pickup_lng: -86.654321,
        admin_note: "ADMIN_NOTE_SECRET",
        delivery_pin: "9876",
        public_code: "PUBLIC_CODE_SECRET"
      });
      await offer("OFFER-A", "RIDE-1", "DRV-A");

      const result = await accept(svc, "OFFER-A", "DRV-A");

      expect(result.outcome).toBe("accepted");
      expect(Object.keys(result).sort()).toEqual([...RESULT_COLUMNS].sort());
      const serialized = JSON.stringify(result);
      for (const secret of [
        "pi_SECRET_PAYMENT",
        "authorized",
        "PRICING_SECRET",
        "ROUTE_SECRET",
        "36.123456",
        "-86.654321",
        "ADMIN_NOTE_SECRET",
        "9876",
        "PUBLIC_CODE_SECRET"
      ]) {
        expect(serialized).not.toContain(secret);
      }
    });

    test("objects created in public cannot shadow the built-ins the function uses", async () => {
      await driver("DRV-A");
      await driver("DRV-B");
      await ride("RIDE-1");
      await ride("RIDE-2", { status: "payment_authorized", dispatch_status: null });
      await offer("OFFER-A", "RIDE-1", "DRV-A");

      // Hostile look-alikes of the text = and || operators and of now().
      // Under search_path (public, pg_catalog) these would be picked over
      // the built-ins; under (pg_catalog, public) they must never run.
      await admin.query(`
        create function public.test_hijack_eq(text, text) returns boolean language plpgsql as $$
        begin raise exception 'shadowed = operator was used'; end $$;
        create operator public.= (leftarg = text, rightarg = text, function = public.test_hijack_eq);
        create function public.test_hijack_cat(text, text) returns text language plpgsql as $$
        begin raise exception 'shadowed || operator was used'; end $$;
        create operator public.|| (leftarg = text, rightarg = text, function = public.test_hijack_cat);
        create function public.now() returns timestamptz language plpgsql as $$
        begin raise exception 'shadowed now() was used'; end $$;
        grant execute on function public.test_hijack_eq(text, text), public.test_hijack_cat(text, text), public.now() to service_role;
      `);
      try {
        expect((await accept(svc, "OFFER-A", "DRV-A")).outcome).toBe("accepted");
        const dispatched = await svc.query("select * from public.dispatch_ride_atomic($1, $2, 30)", ["RIDE-2", "DRV-B"]);
        expect(dispatched.rows[0].outcome).toBe("created");
        await expect(svc.query("select * from public.nearest_drivers(36.16, -86.78, 25, 5)")).resolves.toBeDefined();
      } finally {
        await admin.query(`
          drop operator public.= (text, text);
          drop operator public.|| (text, text);
          drop function public.test_hijack_eq(text, text);
          drop function public.test_hijack_cat(text, text);
          drop function public.now();
        `);
      }
    });

    test("rejects null arguments with invalid_parameter_value", async () => {
      await expect(svc.query(ACCEPT, [null, "DRV-A"])).rejects.toMatchObject({ code: "22023" });
      await expect(svc.query(ACCEPT, ["OFFER-A", null])).rejects.toMatchObject({ code: "22023" });
    });
  });

  // --------------------------------------------------------------- grants

  describe("execute privileges", () => {
    const FUNCTIONS = [
      ["accept_driver_offer_atomic", "select * from public.accept_driver_offer_atomic('OFFER-X', 'DRV-X')"],
      ["dispatch_ride_atomic", "select * from public.dispatch_ride_atomic('RIDE-X', 'DRV-X', 30)"],
      ["nearest_drivers", "select * from public.nearest_drivers(36.16, -86.78, 25, 5)"]
    ];

    test.each(FUNCTIONS)("service_role can execute %s", async (_name, sql) => {
      await expect(svc.query(sql)).resolves.toBeDefined();
    });

    test.each(["anon", "authenticated"])("%s cannot execute any of them", async (role) => {
      const c = await db.connect(role);
      for (const [, sql] of FUNCTIONS) {
        await expect(c.query(sql)).rejects.toMatchObject({ code: "42501" });
      }
    });

    test("a role holding only PUBLIC privileges cannot execute any of them", async () => {
      await admin.query(`do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'harvey_public_probe') then
          create role harvey_public_probe nologin;
        end if;
      end $$;
      grant usage on schema public to harvey_public_probe;`);
      const c = await db.connect("harvey_public_probe");
      for (const [, sql] of FUNCTIONS) {
        await expect(c.query(sql)).rejects.toMatchObject({ code: "42501" });
      }
    });

    test("all three are SECURITY INVOKER with a pinned search_path", async () => {
      const { rows } = await admin.query(`
        select p.proname, p.prosecdef, p.proconfig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('accept_driver_offer_atomic', 'dispatch_ride_atomic', 'nearest_drivers')`);
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.prosecdef).toBe(false);
        expect(row.proconfig).toEqual(["search_path=pg_catalog, public"]);
      }
    });
  });

  // ------------------------------------------------ dispatch_ride_atomic

  describe("dispatch_ride_atomic (corrected)", () => {
    const DISPATCH = "select * from public.dispatch_ride_atomic($1, $2, 30)";

    test("creates a pending offer and marks the ride offer_sent without assigning a driver", async () => {
      await driver("DRV-A");
      await ride("RIDE-1", { status: "payment_authorized", dispatch_status: null, dispatch_attempts: 0 });

      const { rows } = await svc.query(DISPATCH, ["RIDE-1", "DRV-A"]);

      expect(rows[0].outcome).toBe("created");
      const r = await getRide("RIDE-1");
      expect(r.status).toBe("awaiting_driver_acceptance");
      expect(r.dispatch_status).toBe("offer_sent");
      expect(r.dispatch_attempts).toBe(1);
      expect(r.driver_id).toBeNull();
      expect(r.assigned_driver_id).toBeNull();
      expect(await getOffer(rows[0].offer_id)).toMatchObject({ ride_id: "RIDE-1", driver_id: "DRV-A", status: "pending", attempt: 1 });
    });

    test("carries a caller-incremented dispatch_attempts forward instead of adding another", async () => {
      await driver("DRV-A");
      await ride("RIDE-1", { dispatch_status: "redispatching", dispatch_attempts: 3 });

      const { rows } = await svc.query(DISPATCH, ["RIDE-1", "DRV-A"]);

      expect((await getRide("RIDE-1")).dispatch_attempts).toBe(3);
      expect((await getOffer(rows[0].offer_id)).attempt).toBe(3);
    });

    test("the deployed server's call shape (reads only offer_id) still works", async () => {
      await driver("DRV-A");
      await ride("RIDE-1", { status: "payment_authorized" });

      const { rows } = await svc.query("select offer_id from public.dispatch_ride_atomic($1, $2, $3)", ["RIDE-1", "DRV-A", 30]);

      expect(rows[0].offer_id).toMatch(/^OFFER-/);
    });

    test("a ride with a live pending offer returns ride_has_live_offer and creates nothing", async () => {
      await driver("DRV-A");
      await driver("DRV-B");
      await ride("RIDE-1");
      await offer("OFFER-A", "RIDE-1", "DRV-A");

      const { rows } = await svc.query(DISPATCH, ["RIDE-1", "DRV-B"]);

      expect(rows[0]).toEqual({ offer_id: null, outcome: "ride_has_live_offer" });
      expect(Object.keys(await offerStatuses("RIDE-1"))).toEqual(["OFFER-A"]);
    });

    test.each([
      ["assigned", { status: "driver_assigned", driver_id: "DRV-B" }],
      ["cancelled", { status: "cancelled" }]
    ])("an %s ride returns ride_not_dispatchable", async (_label, overrides) => {
      await driver("DRV-A");
      await driver("DRV-B");
      await ride("RIDE-1", overrides);

      const { rows } = await svc.query(DISPATCH, ["RIDE-1", "DRV-A"]);

      expect(rows[0].outcome).toBe("ride_not_dispatchable");
    });

    test("an unknown ride returns ride_not_found", async () => {
      const { rows } = await svc.query(DISPATCH, ["RIDE-NOPE", "DRV-A"]);
      expect(rows[0].outcome).toBe("ride_not_found");
    });

    test.each([
      ["on an active ride", async () => ride("RIDE-9", { status: "in_progress", driver_id: "DRV-A" })],
      ["holding another live offer", async () => { await ride("RIDE-9"); await offer("OFFER-9", "RIDE-9", "DRV-A"); }],
      ["offline", async () => admin.query("update public.drivers set online = false where id = 'DRV-A'")],
      ["access revoked", async () => admin.query("update public.drivers set access_revoked = true where id = 'DRV-A'")]
    ])("a driver %s returns driver_no_longer_available", async (_label, arrange) => {
      await driver("DRV-A");
      await ride("RIDE-1", { status: "payment_authorized" });
      await arrange();

      const { rows } = await svc.query(DISPATCH, ["RIDE-1", "DRV-A"]);

      expect(rows[0].outcome).toBe("driver_no_longer_available");
      expect(await offerStatuses("RIDE-1")).toEqual({});
    });
  });

  // ----------------------------------------------------- nearest_drivers

  describe("nearest_drivers (corrected)", () => {
    const point = "public.st_setsrid(public.st_makepoint($2, $1), 4326)::public.geography";

    async function placeDriver(id, overrides = {}) {
      await driver(id, overrides);
      await admin.query(`update public.drivers set geog = ${point} where id = $3`, [36.16, -86.78, id]);
    }

    test("returns eligible nearby drivers, excluding busy and access-revoked ones", async () => {
      await placeDriver("DRV-FREE");
      await placeDriver("DRV-BUSY");
      await placeDriver("DRV-REVOKED", { access_revoked: true });
      await ride("RIDE-9", { status: "driver_enroute", driver_id: "DRV-BUSY" });

      const { rows } = await svc.query("select id from public.nearest_drivers(36.16, -86.78, 25, 10)");

      expect(rows.map((r) => r.id)).toEqual(["DRV-FREE"]);
    });
  });
});
