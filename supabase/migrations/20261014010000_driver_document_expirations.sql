-- PROPOSED, NOT APPLIED. Needs owner approval before it is run.
--
-- Driver document expiration dates, for the driver review assistant
-- (docs/driver-review-assistant.md). Harvey Taxi does not record these
-- today, so the assistant reports "not recorded". Staff would enter the
-- dates after checking the documents; nothing fills them automatically.
-- Additive and nullable: no existing data or behaviour changes.

alter table public.drivers add column if not exists license_expires_on date;
alter table public.drivers add column if not exists insurance_expires_on date;
alter table public.drivers add column if not exists registration_expires_on date;
