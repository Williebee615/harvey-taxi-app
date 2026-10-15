# Review assistants: supervised production smoke tests

**Owner decision (2026-10-14):**
- Keep both review assistants off until the owner is signed in and ready.
- Enable one assistant at a time.
- An assistant may stay on if authorization, corrections, minimal audit records and an unchanged application or driver status all pass. If anything fails, turn it off.
- Synthetic records must be excluded from public totals and must not trigger messages, dispatch, charges or payouts.

## 1. Synthetic records

Both records are labelled `SMOKE TEST` and use the reserved `example.test` email domain. That domain can never belong to a real person, and the public HTAF totals exclude it. Phone numbers use the fictional 555-01xx range.

| Record | Why it cannot cause side effects |
|---|---|
| HTAF application `HTAF-SMOKE-0001` | **Messages:** applicant emails and SMS are sent only by the public submit route and by staff status changes. This record is inserted directly, and the test doesn't change its status. HTAF SMS sending is off. **Totals:** excluded from `/api/foundation/public-stats` by its `example.test` email. **Rides:** HTAF ride creation is blocked by default. |
| Driver `DRV-SMOKE-0001` | **Dispatch:** only drivers that are online and approved get offers; this one is `online = false` and `approval_status = 'pending'`, and has no push token. **Payouts:** come from completed rides, and it has none. **Charges:** it has no rides. **Hours sweep:** acts on online drivers only. **Public totals:** count online drivers only. Not a review account, so no reviewer-demo behavior. |

Insert just before the test (Claude runs this with owner approval for the window):

```sql
insert into public.htaf_applications
  (id, application_code, first_name, last_name, email, phone, county, city, program_type,
   pickup_city, destination, ride_date, transportation_need, status)
values
  ('HTAF-SMOKE-0001', 'HTAF-SMOKE-0001', 'SMOKE TEST', 'Synthetic Applicant', 'htaf-smoke-1@example.test',
   '6155550199', 'Davidson', 'Nashville', 'medical', 'Nashville', 'SMOKE TEST destination (not real)',
   current_date + 14, 'SMOKE TEST: synthetic application for the review-assistant check. Not a real request.',
   'submitted');

insert into public.drivers
  (id, first_name, last_name, email, phone, status, approval_status, online,
   email_verified, phone_verified, is_review_account, access_revoked)
values
  ('DRV-SMOKE-0001', 'SMOKE TEST', 'Synthetic Driver', 'driver-smoke-1@example.test', '+16155550198',
   'pending', 'pending', false, true, false, false, false);
```

## 2. HTAF review assistant (run first, alone)

| Step | Who | Action | Pass condition |
|---|---|---|---|
| 1 | Claude | Confirm the owner is signed in to the HTAF admin and ready. Record `status` of `HTAF-SMOKE-0001`. | Status `submitted` |
| 2 | Claude | `update system_flags set value='true' where key='htaf_review_assist_enabled'` (insert if missing) | Flag `true` |
| 3 | Owner | Open `HTAF-SMOKE-0001` → **Review Assistant** | Panel shows labelled suggestions and staff checks |
| 4 | Owner | Mark one suggestion **Wrong** and pick a reason | Saved message |
| 5 | Owner (optional) | From a non-HTAF admin account, if one exists, try the same page | Refused |
| 6 | Claude | Verify in SQL (below) | All pass |
| 7 | Claude | Pass: leave the flag on. Fail: set it to `false` immediately. | — |

Verification:

```sql
select action, actor_id, entity_id, metadata, created_at from public.audit_logs
where action in ('htaf_review_assist_run','htaf_review_assist_feedback','htaf_access_denied','htaf_review_assist_blocked')
  and created_at > now() - interval '30 minutes' order by created_at;
select id, status, updated_at from public.htaf_applications where id = 'HTAF-SMOKE-0001';
```

Pass means all of the following:
- A `htaf_review_assist_run` row exists for the owner's email. Its metadata holds only `engine` and `checks`.
- A `htaf_review_assist_feedback` row exists. Its metadata holds only `engine`, `check`, `verdict` and `reason`.
- No applicant name, email or phone appears in any audit row.
- The application's status is unchanged.
- If step 5 ran, a `htaf_access_denied` row exists.

## 3. Driver review assistant (second, alone)

Same procedure with `DRV-SMOKE-0001` in the Harvey Taxi admin dashboard. The flag is `driver_review_assist_enabled`, and the audit actions are `driver_review_assist_run`, `driver_review_assist_feedback` and `driver_review_access_denied`.

**Pass** additionally requires:
- the driver's `approval_status`, `status` and `online` are unchanged;
- no `admin_capability_grants` row was created;
- the owner's access comes from super_admin, not a grant.

## 4. Afterwards

**Remove the synthetic records** (owner confirms):

```sql
delete from public.htaf_applications where id = 'HTAF-SMOKE-0001' and email = 'htaf-smoke-1@example.test';
delete from public.drivers where id = 'DRV-SMOKE-0001' and email = 'driver-smoke-1@example.test';
```

The audit rows from the test stay. They contain identifiers only.

**Rollback at any time:** set the flag to `false`. It takes effect on the next request.
