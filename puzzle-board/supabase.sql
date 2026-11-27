-- Piece of Home on Supabase: run this once in the Supabase dashboard → SQL Editor → New query → Run.
-- It makes a table for the pieces and a public folder (bucket) for the photos.
-- Anyone with the board link may add a piece and see them all; nobody can change or delete them.

create table if not exists public.pieces (
  id bigint generated always as identity primary key,
  path text not null check (length(path) < 200),
  created_at timestamptz not null default now()
);
-- what the photo is about (people, animal, food, ...) and the place in the house it asked for
alter table public.pieces add column if not exists topic text check (topic is null or length(topic) < 20);
alter table public.pieces add column if not exists slot int check (slot is null or slot between 0 and 100000);
alter table public.pieces add column if not exists redraw boolean not null default false;
alter table public.pieces enable row level security;
drop policy if exists "pieces are public" on public.pieces;
create policy "pieces are public" on public.pieces for select to anon using (true);
drop policy if exists "anyone can add a piece" on public.pieces;
create policy "anyone can add a piece" on public.pieces for insert to anon with check (true);

-- the photos: public to read, max 3 MB each, JPEG only
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pieces', 'pieces', true, 3145728, array['image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg'];
drop policy if exists "anyone can upload a piece photo" on storage.objects;
create policy "anyone can upload a piece photo" on storage.objects for insert to anon with check (bucket_id = 'pieces');
