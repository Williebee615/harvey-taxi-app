# App Review standalone demonstrations

Off by default. The system flag `review_demo_autopilot_enabled` turns it on; leave it off until the owner approves activation. Review rides and the review driver account only. No payment is collected and Stripe is never called.

## Rider demo: simulated driver
A reviewer's ride that no review driver takes is driven by a simulated driver. That covers three cases: the review driver is offline, the review driver is busy, or the review driver lets the 30-second offer expire.
- **Stages,** one every 25 seconds: assigned, on the way, arrived, trip started, completed.
- **Labels:**
  - the driver shows as "Simulated driver" / "Demo vehicle (simulated)";
  - the position shows as "Simulated location";
  - the status response carries `simulated: true` and an App Review label.
- **Payment and earnings:** no driver account is involved, no earnings are recorded, and the final fare equals the estimate, with payment not required.
- **Cancellation:** each stage is an atomic status claim, so a rider cancellation stops the simulated driver.

## Driver demo: simulated offer
One simulated ride is offered to the review driver when all of these hold:
- the review driver has been online and idle for 20 seconds;
- they have no active ride and no pending offer;
- there is no open review ride anywhere.

About the ride:
- It has no rider account, a "Demo rider (simulated)" name, and labelled demo addresses in downtown Nashville.
- The driver accepts and completes it with the app's normal buttons, and earnings show as simulated, as for any review ride.
- If the offer expires, the simulated ride is withdrawn (cancelled). The next one comes after another 20 idle seconds.

## Connected two-app test (unchanged)
- With the review driver online, a reviewer's ride is offered to them exactly as before. The simulated driver never steps in unless that offer expires.
- When the rider reviewer books while a simulated offer is waiting, the simulated offer is withdrawn first, so the rider's request reaches the driver.

## Duplicates and clean-up
- **One simulated offer:** at most one open simulated offer exists at a time. A database unique index enforces this across server instances, and the code also checks for it.
- **Rider request first:** a simulated offer created at the same moment as a rider's ride withdraws itself.
- **Abandoned rides:** demo rides untouched for 30 minutes are cancelled. This applies to review demo rides only.

## Turning it on (owner approval required)
1. Apply migration `20261005150000_review_demo.sql`. It adds two nullable columns, one check and two partial indexes; existing rides are unaffected.
2. Deploy.
3. Set `review_demo_autopilot_enabled` to `true`. While it is off, nothing reads or writes the new columns.
