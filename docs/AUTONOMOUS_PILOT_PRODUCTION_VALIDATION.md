# Autonomous Pilot V1 — Manual Production Validation

PR: #36  
Environment: Production  
Operator:  
Date:  
Branch/commit tested:  

## Safety rules

- Use only a controlled test rider and approved test payment method.
- Keep `autonomous_pilot_enabled` enabled only for the test window.
- Use a clearly identified manual/simulated vehicle label.
- Do not represent this test as real autonomous-driving capability.
- Pause testing immediately if an unexpected payment, dispatch, or data issue occurs.
- Confirm the pilot flag is `false` before ending the test session.

---

# Scenario 1 — Full Pilot Request

## Test setup

- Operator:
- Test start time:
- Commit SHA deployed:
- Production URL:
- Pilot zone ID:
- Pilot zone name:
- Zone active:
- Service hours valid:
- Initial `autonomous_pilot_enabled` value:

## Feature-flag window

- Flag enabled at:
- Enabled by:
- Enable reason:
- Flag state confirmed through:
- Flag disabled at:
- Disabled by:
- Disable reason:

## Rider and request

- Rider ID:
- Rider name or test label:
- Ride ID:
- Pickup:
- Destination:
- Pickup coordinates:
- Destination coordinates:
- Scheduled or immediate:
- Accessibility request, if any:

## Disclosure and consent

- Disclosure version:
- Disclosure displayed successfully:
- Consent checkbox initially disabled until config loaded:
- Rider consent recorded:
- Consent timestamp:
- Eligibility result:
- Matched pilot zone:
- UI language clearly identified the service as a pilot:
- Manual/simulated provider disclosure visible:

## Pricing and payment

- Fare estimate:
- Booking fee:
- Payment method:
- Payment authorization attempted:
- Payment authorization outcome:
- Stripe/payment reference:
- Duplicate charge observed:
- Notes:

## Lifecycle progression

| Sequence | Timestamp | `rides.status` | `pilot_status` | Action/source | Event ID | Notes |
|---:|---|---|---|---|---|---|
| 1 |  |  | `pilot_requested` | Rider creation |  |  |
| 2 |  |  |  | Admin approval |  |  |
| 3 |  |  | `waitlisted` | Lifecycle transition |  |  |
| 4 |  |  | `vehicle_reserved` | Vehicle assignment |  |  |
| 5 |  |  | `vehicle_enroute` | Manual operation |  |  |
| 6 |  |  | `vehicle_arrived` | Manual operation |  |  |
| 7 |  |  | `boarding_confirmation` | Rider/admin confirmation |  |  |
| 8 |  |  | `trip_in_progress` | Manual operation |  |  |
| 9 |  |  | `trip_completed` | Manual operation |  |  |

## Reservation and vehicle

- Provider:
- Reservation row ID:
- Provider reservation ID:
- Vehicle label/identifier:
- Reservation created once:
- Retry updated the same reservation:
- Duplicate reservation rejected/prevented:
- Vehicle/location data clearly labeled manual or simulated:

## Dispatch verification

- Standard human dispatch attempted before fallback:
- Expected result: blocked
- Actual result:
- `dispatch_status`:
- Driver offer created unexpectedly:
- Dispatch-block event ID:
- Notes:

## Rider status experience

- Rider-safe status endpoint worked:
- Internal zone/provider/event metadata remained hidden:
- Status card updated correctly:
- Human-assistance button worked:
- Emergency-service disclaimer visible:
- No simulated telemetry presented as real:

## Completion and cleanup

- Ride completed successfully:
- Final `rides.status`:
- Final `pilot_status`:
- Test reservation cleaned up:
- Test ride retained or deleted:
- Test events retained or deleted:
- Payment voided/refunded, if applicable:
- Zone restored:
- Pilot flag confirmed `false`:
- Final confirmation timestamp:
- Cleanup performed by:
- Issues observed:

## Scenario 1 result

- [ ] PASS
- [ ] FAIL
- [ ] PASS WITH FOLLOW-UP

Evidence:
- Screenshots:
- Logs:
- Database query results:
- Payment reference:
- Notes:

---

# Scenario 2 — Human-Fallback Dispatch

## Test setup

- Operator:
- Test start time:
- Commit SHA deployed:
- Pilot zone ID:
- Initial `autonomous_pilot_enabled` value:

## Feature-flag window

- Flag enabled at:
- Enable reason:
- Flag disabled at:
- Disable reason:

## Rider and request

- Rider ID:
- Ride ID:
- Pickup:
- Destination:
- Disclosure version:
- Consent timestamp:
- Eligibility result:
- Payment authorization outcome:

## Pre-fallback dispatch guard

- `autonomous_pilot`:
- `human_fallback_allowed` before fallback:
- Normal dispatch attempted:
- Expected result: blocked
- Actual result:
- Driver offer created:
- `dispatch_status`:
- `human_dispatch_blocked` event ID:

## Fallback action

- Fallback offered at:
- Admin/operator:
- Fallback reason:
- `human_fallback_allowed` after action:
- `human_fallback_reason`:
- New `pilot_status`:
- Fallback event ID:
- Existing `dispatchRide()` re-invoked:
- Parallel dispatch path used:
- Expected: no

## Human-driver dispatch

- Dispatch result:
- Driver offer ID:
- Driver ID:
- Driver accepted:
- Dispatch timestamp:
- Rider notified:
- Duplicate driver offers observed:
- Payment authorization reused:
- Duplicate payment observed:

## Final outcome

- Final `rides.status`:
- Final `pilot_status`:
- Human-operated trip completed:
- Rider status language remained accurate:
- No autonomous-vehicle claim was shown:
- Reservation cancelled or cleaned up:
- Payment finalized/voided/refunded:
- Pilot flag confirmed `false`:
- Final confirmation timestamp:
- Issues observed:

## Scenario 2 result

- [ ] PASS
- [ ] FAIL
- [ ] PASS WITH FOLLOW-UP

Evidence:
- Screenshots:
- Logs:
- Database query results:
- Driver offer reference:
- Payment reference:
- Notes:

---

# Final Production Sign-Off

- [ ] Scenario 1 passed
- [ ] Scenario 2 passed
- [ ] No unauthorized human dispatch occurred
- [ ] No duplicate payment occurred
- [ ] No duplicate provider reservation occurred
- [ ] Rider-safe API leaked no internal data
- [ ] Audit events were recorded
- [ ] Test records were cleaned up or intentionally retained
- [ ] Production pilot flag is confirmed `false`
- [ ] Any issues discovered have follow-up GitHub issues

Final flag value:  
Verified at:  
Verified by:  

Recommendation:

- [ ] Ready to mark PR #36 ready for review
- [ ] Keep PR #36 in draft
- [ ] Blocked pending fixes

Operator signature/name:  
Reviewer signature/name:  
Final notes:
