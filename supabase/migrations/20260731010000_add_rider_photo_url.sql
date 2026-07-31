-- Mirrors the existing driver photo feature (photo_url column +
-- public storage bucket) for riders, so a rider can upload a photo
-- their driver can use to identify them, the same way drivers already
-- upload a photo riders use to identify them.

alter table public.riders
  add column if not exists photo_url text;

insert into storage.buckets (id, name, public)
values ('rider-photos', 'rider-photos', true)
on conflict (id) do nothing;
