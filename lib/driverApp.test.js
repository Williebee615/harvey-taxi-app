const da = require("./driverApp");

test("phoneLast10 accepts U.S. formats only", () => {
  expect(da.phoneLast10("(615) 555-0201")).toBe("6155550201");
  expect(da.phoneLast10("+1 615 555 0201")).toBe("6155550201");
  expect(da.phoneLast10("+44 20 7946 0958")).toBe("");
  expect(da.phoneLast10("555-0201")).toBe("");
  expect(da.phoneLikePattern("6155550201")).toBe("%6%1%5%5%5%5%0%2%0%1");
});

test("selectDriverForPhone: exactly one active exact match", () => {
  const rows = [
    { id: "A", phone: "(615) 555-0201" },
    { id: "R", phone: "16155550201", access_revoked: true },
    { id: "X", phone: "96155550201" }
  ];
  expect(da.selectDriverForPhone(rows, "6155550201")).toEqual({ driver: rows[0], matchCount: 1 });
  expect(da.selectDriverForPhone([...rows, { id: "B", phone: "+16155550201" }], "6155550201").driver).toBeNull();
  expect(da.selectDriverForPhone(rows, "").driver).toBeNull();
});

test("mode and polling", () => {
  expect(da.driverMode({ online: false, offers: [], activeRide: null })).toBe("offline");
  expect(da.driverMode({ online: true, offers: [], activeRide: null })).toBe("online_idle");
  expect(da.driverMode({ online: false, offers: [{}], activeRide: null })).toBe("offer_pending");
  expect(da.driverMode({ online: false, offers: [{}], activeRide: {} })).toBe("on_trip");
  expect(da.pollIntervalFor("offline")).toBe(0);
  expect(da.pollIntervalFor("offer_pending")).toBeLessThan(da.pollIntervalFor("on_trip"));
});

test("offers never carry rider contact details; seconds_left counts down and floors at 0", () => {
  const now = Date.parse("2026-10-03T12:00:00Z");
  const offer = da.shapeOffer(
    { id: "O", ride_id: "R", expires_at: "2026-10-03T12:00:20Z" },
    { rider_name: "Jamie Rivera", rider_phone: "+16155550101", pickup_address: "1 Broadway", estimated_fare: "18.50" },
    now
  );
  expect(offer.seconds_left).toBe(20);
  expect(offer.estimated_fare).toBe(18.5);
  expect(JSON.stringify(offer)).not.toMatch(/Jamie|5550101/);
  expect(da.shapeOffer({ id: "O", expires_at: "2026-10-03T11:59:00Z" }, {}, now).seconds_left).toBe(0);
});

test("location policy", () => {
  expect(da.locationPolicy({ driver: { online: false }, activeRide: { id: "R" } })).toBe("trip");
  expect(da.locationPolicy({ driver: { online: true }, activeRide: null })).toBe("online_idle");
  expect(da.locationPolicy({ driver: { online: false }, activeRide: null })).toBe("reject");
  expect(da.locationPolicy({ driver: { online: "true" }, activeRide: null })).toBe("reject");
});

test("page parsing and results", () => {
  expect(da.parsePageQuery({})).toBeNull();
  expect(da.parsePageQuery({ limit: "500" })).toEqual({ limit: 50, before: null });
  expect(da.parsePageQuery({ limit: "x" })).toEqual({ limit: 20, before: null });
  expect(da.parsePageQuery({ before: "nope" }).error).toBeTruthy();
  const rows = [{ t: "3" }, { t: "2" }, { t: "1" }];
  expect(da.pageResult(rows, 2, "t")).toEqual({ items: rows.slice(0, 2), next_before: "2" });
  expect(da.pageResult(rows.slice(0, 2), 2, "t").next_before).toBeNull();
});

test("Expo messages: valid tokens only, offers urgent and short-lived; dead tokens found from tickets", () => {
  const msgs = da.buildExpoMessages(["ExponentPushToken[abcdefghij12]", "bad"], { title: "New Ride Request", body: "Pickup", kind: "ride_offer" });
  expect(msgs).toEqual([expect.objectContaining({ to: "ExponentPushToken[abcdefghij12]", priority: "high", channelId: "ride-offers", ttl: 60 })]);
  expect(da.invalidTokensFromTickets(msgs, [{ status: "error", details: { error: "DeviceNotRegistered" } }])).toEqual(["ExponentPushToken[abcdefghij12]"]);
  expect(da.pushKindForTitle("New Ride Request")).toBe("ride_offer");
  expect(da.pushKindForTitle("Ride Cancelled")).toBe("ride_update");
});
