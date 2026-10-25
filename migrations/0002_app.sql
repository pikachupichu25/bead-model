-- The app's own tables: the profile, My designs, pins and My beads, one row per
-- item, each owned by a Better Auth user. See docs/cloudflare-plan.md.
--
-- Every row has `updated_at`, when it last changed on the device that changed it
-- (the newer change wins), and `synced_at`, when the server stored it (pulls ask
-- for rows stored since their last pull). Deleting keeps the row with deleted = 1,
-- so other devices learn about it. Times are ms since 1970.

create table "profiles" (
  "user_id"       text not null primary key references "user" ("id") on delete cascade,
  "display_name"  text not null default '' check (length("display_name") <= 80),
  "only_my_beads" integer not null default 0 check ("only_my_beads" in (0, 1)),
  "updated_at"    integer not null,
  "synced_at"     integer not null
);

create table "designs" (
  "owner_id"   text not null references "user" ("id") on delete cascade,
  -- The id the browser gave it ("d…"), unique per owner.
  "id"         text not null check (length("id") between 1 and 64),
  "kind"       text not null check ("kind" in ('peyote', 'flat', 'nora')),
  "title"      text not null check (length("title") <= 200),
  -- The design file, as the designer downloads it. Empty once deleted.
  "yaml"       text not null check (length("yaml") <= 1000000),
  -- For a shared feed later. Nothing sets it yet.
  "is_public"  integer not null default 0 check ("is_public" in (0, 1)),
  "deleted"    integer not null default 0 check ("deleted" in (0, 1)),
  "created_at" integer not null,
  "updated_at" integer not null,
  "synced_at"  integer not null,
  primary key ("owner_id", "id")
);
create index "designs_owner_synced" on "designs" ("owner_id", "synced_at");

-- A pinned design id or example id ("example:<kind>:<name>"). Unpinning keeps the row with pinned = 0.
create table "pins" (
  "owner_id"   text not null references "user" ("id") on delete cascade,
  "target"     text not null check (length("target") between 1 and 200),
  "pinned"     integer not null check ("pinned" in (0, 1)),
  "pinned_at"  integer not null,
  "updated_at" integer not null,
  "synced_at"  integer not null,
  primary key ("owner_id", "target")
) without rowid;
create index "pins_owner_synced" on "pins" ("owner_id", "synced_at");

-- One row per owned bead, keyed by ownedId() ("catalog:miyuki db-0010" or "own:<size>:<name>").
create table "owned_beads" (
  "owner_id"   text not null references "user" ("id") on delete cascade,
  "bead_key"   text not null check (length("bead_key") between 1 and 200),
  "kind"       text check ("kind" in ('catalog', 'own')),
  "bead"       text,                -- catalog: "miyuki DB-0010"
  "size"       text,                -- own: "miyuki delica DB"
  "name"       text,                -- own
  "rgb"        text check ("rgb" is null or "rgb" glob '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
  "amount"     text check (length("amount") <= 100),
  "note"       text check (length("note") <= 500),
  "deleted"    integer not null default 0 check ("deleted" in (0, 1)),
  "updated_at" integer not null,
  "synced_at"  integer not null,
  primary key ("owner_id", "bead_key"),
  check (
    "deleted" = 1
    or ("kind" = 'catalog' and "bead" is not null)
    or ("kind" = 'own' and "size" is not null and "name" is not null and "rgb" is not null)
  )
) without rowid;
create index "owned_beads_owner_synced" on "owned_beads" ("owner_id", "synced_at");
