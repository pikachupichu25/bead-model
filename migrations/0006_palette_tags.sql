-- Tags on palettes, to find them by ("ocean", "cool", "christmas"): lower case,
-- comma-separated, at most 12. Browse palettes searches them with the name and
-- description.

alter table "palettes" add column "tags" text not null default '' check (length("tags") <= 320);
