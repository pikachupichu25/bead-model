-- Where the designers take their colors from: "all", "mine" or "palette:<id>".
-- It replaces only_my_beads, which stays (set to color_source = 'mine') for
-- pages from before the color source.

alter table "profiles" add column "color_source" text not null default 'all' check (length("color_source") <= 80);
update "profiles" set "color_source" = case "only_my_beads" when 1 then 'mine' else 'all' end;
