-- Business partnership inquiries (owner decision 2026-10-22: the
-- merchant page gets a second path for hotels, healthcare organizations,
-- businesses and local merchants to ask about partnering). An inquiry is
-- a request to talk; nothing is approved by submitting one. Stores joining
-- the delivery pilot still apply through public.merchants.
--
-- Server-only: RLS on, no policies, no anon/authenticated access. Contact
-- details are business contacts supplied by the applicant.

create table if not exists public.partnership_inquiries (
  id uuid primary key default gen_random_uuid(),
  organization_name text not null check (length(btrim(organization_name)) between 2 and 160),
  website text check (website is null or length(website) <= 300),
  business_type text not null check (business_type in ('sole_proprietorship', 'llc', 'corporation', 'nonprofit', 'partnership', 'other')),
  industry text not null check (industry in ('retail', 'hospitality', 'healthcare', 'travel_tourism', 'property_management', 'professional_services', 'other')),
  address_line text check (address_line is null or length(address_line) <= 240),
  city text not null check (length(btrim(city)) between 2 and 80),
  state text not null check (state ~ '^[A-Z]{2}$'),
  postal_code text check (postal_code is null or postal_code ~ '^[0-9]{5}$'),
  contact_name text not null check (length(btrim(contact_name)) between 2 and 120),
  job_title text check (job_title is null or length(job_title) <= 120),
  contact_email text not null check (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(contact_email) <= 254),
  contact_phone text not null check (contact_phone ~ '^\+1[0-9]{10}$'),
  interests text[] not null check (
    cardinality(interests) between 1 and 6
    and interests <@ array['transportation_partnership', 'merchant_collaboration', 'corporate_transportation', 'customer_referrals', 'promotional_partnership', 'other']::text[]
  ),
  message text not null check (length(btrim(message)) between 20 and 2000),
  -- The consent wording version the applicant agreed to, and when.
  consent_version text not null,
  consented_at timestamptz not null,
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  staff_note text check (staff_note is null or length(staff_note) <= 1000),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists partnership_inquiries_status_created_idx
  on public.partnership_inquiries (status, created_at desc);
create index if not exists partnership_inquiries_email_idx
  on public.partnership_inquiries (lower(contact_email));

alter table public.partnership_inquiries enable row level security;
revoke all on public.partnership_inquiries from anon, authenticated;
