-- My palettes: one row per palette, owned by a Better Auth user, kept like
-- owned_beads (see 0002_app.sql): `updated_at` decides which change wins,
-- `synced_at` is what pulls ask for, and deleting keeps the row with deleted = 1.
-- A public palette can be read by anyone; see docs/preset-palettes.md.

create table "palettes" (
  "owner_id"    text not null references "user" ("id") on delete cascade,
  -- The id the browser gave it ("my-…"), unique per owner.
  "id"          text not null check (length("id") between 4 and 64 and "id" like 'my-%'),
  "name"        text not null default '' check (length("name") <= 80),
  "description" text not null default '' check (length("description") <= 200),
  -- The colors, as the JSON list the browser keeps ([{ "bead": … } or { "rgb": …, "name": … }]). Empty once deleted.
  "colors"      text not null default '[]' check (length("colors") <= 20000),
  "visibility"  text not null default 'private' check ("visibility" in ('private', 'public')),
  "deleted"     integer not null default 0 check ("deleted" in (0, 1)),
  "updated_at"  integer not null,
  "synced_at"   integer not null,
  primary key ("owner_id", "id")
) without rowid;
create index "palettes_owner_synced" on "palettes" ("owner_id", "synced_at");
-- For Browse palettes: the public ones, newest first.
create index "palettes_public" on "palettes" ("visibility", "deleted", "updated_at");
