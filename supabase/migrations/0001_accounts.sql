-- Accounts for bead-model: profiles, My designs, pins and My beads.
-- Sign-in itself is Supabase Auth (auth.users); every table here hangs off it.
-- Each table is locked down with row level security, so the browser can talk
-- to the database directly with the public anon key and only ever see its own rows.

-- A profile per account, made when someone signs up.
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null default '' check (char_length(display_name) <= 80),
  only_my_beads boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- A design in any technique. `yaml` is the design file, exactly as the designer downloads it.
create table public.designs (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  -- The id the design had in localStorage ("d…"), so uploading on first sign-in can run twice safely.
  local_id   text,
  kind       text not null check (kind in ('peyote', 'flat', 'nora')),
  title      text not null default 'Untitled design' check (char_length(title) <= 200),
  yaml       text not null check (octet_length(yaml) <= 1000000),
  -- For a shared feed later. Off until the owner shares it.
  is_public  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, local_id)
);
create index designs_owner_updated on public.designs (owner_id, updated_at desc);
create index designs_public_updated on public.designs (updated_at desc) where is_public;

-- Pins: a design's id, or an example's ("example:flat:heart-band"), so not a foreign key.
-- The Home feed orders pins newest first.
create table public.pins (
  owner_id  uuid not null references auth.users (id) on delete cascade,
  target    text not null check (char_length(target) <= 200),
  pinned_at timestamptz not null default now(),
  primary key (owner_id, target)
);

-- My beads: one row per bead (keyed by ownedId), so two devices only clash on the same bead.
create table public.owned_beads (
  owner_id   uuid not null references auth.users (id) on delete cascade,
  bead_key   text not null,          -- ownedId(): "catalog:miyuki db-0010" or "own:<size>:<name>"
  kind       text not null check (kind in ('catalog', 'own')),
  bead       text,                   -- catalog: "miyuki DB-0010"
  size       text,                   -- own: "miyuki delica DB"
  name       text,                   -- own
  rgb        text check (rgb is null or rgb ~ '^#[0-9a-f]{6}$'),
  amount     text check (char_length(amount) <= 100),
  note       text check (char_length(note) <= 500),
  updated_at timestamptz not null default now(),
  primary key (owner_id, bead_key),
  check (
    (kind = 'catalog' and bead is not null)
    or (kind = 'own' and size is not null and name is not null and rgb is not null)
  )
);

-- Keep updated_at honest.
create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger designs_touch before update on public.designs
  for each row execute function public.touch_updated_at();
create trigger owned_beads_touch before update on public.owned_beads
  for each row execute function public.touch_updated_at();

-- Make the profile when someone signs up.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row level security: each person sees and changes only their own rows.
alter table public.profiles    enable row level security;
alter table public.designs     enable row level security;
alter table public.pins        enable row level security;
alter table public.owned_beads enable row level security;

create policy "own profile" on public.profiles
  for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "own designs" on public.designs
  for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

-- Anyone, signed in or not, can read a shared design.
create policy "shared designs" on public.designs
  for select to anon, authenticated
  using (is_public);

create policy "own pins" on public.pins
  for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

create policy "own beads" on public.owned_beads
  for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
