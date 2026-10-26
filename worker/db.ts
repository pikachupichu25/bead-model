// Every query on the app's tables. Each one takes the signed-in user's id (from
// the session, never from the request) and only touches that user's rows: D1 has
// no row level security, so this file is where one account is kept from another.
// The one exception is reading public palettes, which anyone may do: those
// queries only ever return rows with visibility = 'public' and deleted = 0.

import type { OwnedBead } from "../src/collection/my-beads.js";
import { type PublicPalette, type PublicPalettePage, readMyPalette } from "../src/collection/my-palettes.js";
import {
  emptyChanges,
  profileOf,
  type SyncBead,
  type SyncChanges,
  type SyncDesign,
  type SyncPalette,
  type SyncPin,
  type SyncProfile,
  type SyncPull,
  type SyncPushResult,
} from "../src/collection/sync.js";

/** Everything of the user's stored at or after `since` (server time), with the time to pull from next. */
export async function pullChanges(db: D1Database, userId: string, since: number, now = Date.now()): Promise<SyncPull> {
  const [designs, pins, beads, palettes, profiles] = await db.batch([
    db.prepare(`select * from designs where owner_id = ? and synced_at >= ?`).bind(userId, since),
    db.prepare(`select * from pins where owner_id = ? and synced_at >= ?`).bind(userId, since),
    db.prepare(`select * from owned_beads where owner_id = ? and synced_at >= ?`).bind(userId, since),
    db.prepare(`select * from palettes where owner_id = ? and synced_at >= ?`).bind(userId, since),
    db.prepare(`select * from profiles where user_id = ? and synced_at >= ?`).bind(userId, since),
  ]);
  const profile = profiles?.results[0] as ProfileRow | undefined;
  return {
    now,
    designs: (designs?.results as DesignRow[]).map(designOf),
    pins: (pins?.results as PinRow[]).map(pinOf),
    beads: (beads?.results as BeadRow[]).map(beadOf),
    palettes: (palettes?.results as PaletteRow[]).map(paletteOf),
    ...(profile ? { profile: profileFrom(profile) } : {}),
  };
}

/**
 * Stores the changes, each only when it is at least as new as the stored row.
 * Returns the stored copies of the rows that were newer, for the browser to take.
 */
export async function pushChanges(db: D1Database, userId: string, changes: SyncChanges, now = Date.now()): Promise<SyncPushResult> {
  const statements: { kind: Kind; key: string; statement: D1PreparedStatement }[] = [];
  for (const d of changes.designs) {
    statements.push({
      kind: "design",
      key: d.id,
      statement: db
        .prepare(
          `insert into designs (owner_id, id, kind, title, yaml, deleted, created_at, updated_at, synced_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict (owner_id, id) do update set
             kind = excluded.kind, title = excluded.title, yaml = excluded.yaml, deleted = excluded.deleted,
             updated_at = excluded.updated_at, synced_at = excluded.synced_at
           where excluded.updated_at >= designs.updated_at`,
        )
        .bind(userId, d.id, d.kind, d.title, d.yaml, d.deleted ? 1 : 0, d.created, d.updated, now),
    });
  }
  for (const p of changes.pins) {
    statements.push({
      kind: "pin",
      key: p.target,
      statement: db
        .prepare(
          `insert into pins (owner_id, target, pinned, pinned_at, updated_at, synced_at)
           values (?, ?, ?, ?, ?, ?)
           on conflict (owner_id, target) do update set
             pinned = excluded.pinned, pinned_at = excluded.pinned_at,
             updated_at = excluded.updated_at, synced_at = excluded.synced_at
           where excluded.updated_at >= pins.updated_at`,
        )
        .bind(userId, p.target, p.pinned ? 1 : 0, p.pinnedAt, p.updated, now),
    });
  }
  for (const b of changes.beads) {
    const bead = b.bead;
    statements.push({
      kind: "bead",
      key: b.key,
      statement: db
        .prepare(
          `insert into owned_beads (owner_id, bead_key, kind, bead, size, name, rgb, amount, note, deleted, updated_at, synced_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict (owner_id, bead_key) do update set
             kind = coalesce(excluded.kind, owned_beads.kind), bead = coalesce(excluded.bead, owned_beads.bead),
             size = coalesce(excluded.size, owned_beads.size), name = coalesce(excluded.name, owned_beads.name),
             rgb = coalesce(excluded.rgb, owned_beads.rgb), amount = excluded.amount, note = excluded.note,
             deleted = excluded.deleted, updated_at = excluded.updated_at, synced_at = excluded.synced_at
           where excluded.updated_at >= owned_beads.updated_at`,
        )
        .bind(
          userId,
          b.key,
          bead?.kind ?? null,
          bead?.kind === "catalog" ? bead.bead : null,
          bead?.kind === "own" ? bead.size : null,
          bead?.kind === "own" ? bead.name : null,
          bead?.kind === "own" ? bead.rgb : null,
          bead?.amount ?? null,
          bead?.note ?? null,
          b.deleted ? 1 : 0,
          b.updated,
          now,
        ),
    });
  }
  for (const p of changes.palettes) {
    const palette = p.palette;
    statements.push({
      kind: "palette",
      key: p.id,
      statement: db
        .prepare(
          `insert into palettes (owner_id, id, name, description, colors, visibility, deleted, updated_at, synced_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict (owner_id, id) do update set
             name = excluded.name, description = excluded.description, colors = excluded.colors,
             visibility = excluded.visibility, deleted = excluded.deleted,
             updated_at = excluded.updated_at, synced_at = excluded.synced_at
           where excluded.updated_at >= palettes.updated_at`,
        )
        .bind(
          userId,
          p.id,
          palette?.name ?? "",
          palette?.description ?? "",
          palette ? JSON.stringify(palette.colors) : "[]",
          // A deleted palette is never public, so it can't be served.
          palette && !p.deleted ? palette.visibility : "private",
          p.deleted ? 1 : 0,
          p.updated,
          now,
        ),
    });
  }
  if (changes.profile) {
    const p = changes.profile;
    statements.push({
      kind: "profile",
      key: userId,
      statement: db
        .prepare(
          `insert into profiles (user_id, display_name, only_my_beads, color_source, updated_at, synced_at)
           values (?, ?, ?, ?, ?, ?)
           on conflict (user_id) do update set
             display_name = excluded.display_name, only_my_beads = excluded.only_my_beads, color_source = excluded.color_source,
             updated_at = excluded.updated_at, synced_at = excluded.synced_at
           where excluded.updated_at >= profiles.updated_at`,
        )
        .bind(userId, p.name, p.onlyMyBeads ? 1 : 0, p.colorSource, p.updated, now),
    });
  }
  const rejected = emptyChanges();
  if (statements.length === 0) return { now, rejected };

  const results = await db.batch(statements.map((s) => s.statement));
  const kept = statements.filter((_, i) => (results[i]?.meta.changes ?? 0) === 0);
  if (kept.length === 0) return { now, rejected };

  const keys = (kind: string) => kept.filter((s) => s.kind === kind).map((s) => s.key);
  const lookups: D1PreparedStatement[] = [];
  const designKeys = keys("design");
  const pinKeys = keys("pin");
  const beadKeys = keys("bead");
  const paletteKeys = keys("palette");
  const order: Kind[] = [];
  if (designKeys.length) {
    order.push("design");
    lookups.push(db.prepare(`select * from designs where owner_id = ? and id in (${marks(designKeys)})`).bind(userId, ...designKeys));
  }
  if (pinKeys.length) {
    order.push("pin");
    lookups.push(db.prepare(`select * from pins where owner_id = ? and target in (${marks(pinKeys)})`).bind(userId, ...pinKeys));
  }
  if (beadKeys.length) {
    order.push("bead");
    lookups.push(db.prepare(`select * from owned_beads where owner_id = ? and bead_key in (${marks(beadKeys)})`).bind(userId, ...beadKeys));
  }
  if (paletteKeys.length) {
    order.push("palette");
    lookups.push(db.prepare(`select * from palettes where owner_id = ? and id in (${marks(paletteKeys)})`).bind(userId, ...paletteKeys));
  }
  if (keys("profile").length) {
    order.push("profile");
    lookups.push(db.prepare(`select * from profiles where user_id = ?`).bind(userId));
  }
  const rows = await db.batch(lookups);
  order.forEach((kind, i) => {
    const found = rows[i]?.results ?? [];
    if (kind === "design") rejected.designs = (found as DesignRow[]).map(designOf);
    if (kind === "pin") rejected.pins = (found as PinRow[]).map(pinOf);
    if (kind === "bead") rejected.beads = (found as BeadRow[]).map(beadOf);
    if (kind === "palette") rejected.palettes = (found as PaletteRow[]).map(paletteOf);
    if (kind === "profile" && found[0]) rejected.profile = profileFrom(found[0] as ProfileRow);
  });
  return { now, rejected };
}

/** Public palettes per page of Browse palettes. */
export const PUBLIC_PAGE = 50;

/** A page of public palettes, newest first, whose name or description has `query` in it. */
export async function listPublicPalettes(db: D1Database, query: string, offset: number): Promise<PublicPalettePage> {
  const like = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { results } = await db
    .prepare(
      `select palettes.*, coalesce(profiles.display_name, '') as by from palettes
       left join profiles on profiles.user_id = palettes.owner_id
       where palettes.visibility = 'public' and palettes.deleted = 0
         and (?1 = '' or palettes.name like ?2 escape '\\' or palettes.description like ?2 escape '\\')
       order by palettes.updated_at desc, palettes.owner_id, palettes.id
       limit ?3 offset ?4`,
    )
    .bind(query, like, PUBLIC_PAGE + 1, offset)
    .all<PaletteRow & { by: string }>();
  const palettes = results.slice(0, PUBLIC_PAGE).flatMap(publicOf);
  return results.length > PUBLIC_PAGE ? { palettes, next: offset + PUBLIC_PAGE } : { palettes };
}

/** One public palette, or undefined when it's private, deleted or missing: the caller can't tell which. */
export async function getPublicPalette(db: D1Database, owner: string, id: string): Promise<PublicPalette | undefined> {
  const row = await db
    .prepare(
      `select palettes.*, coalesce(profiles.display_name, '') as by from palettes
       left join profiles on profiles.user_id = palettes.owner_id
       where palettes.owner_id = ? and palettes.id = ? and palettes.visibility = 'public' and palettes.deleted = 0`,
    )
    .bind(owner, id)
    .first<PaletteRow & { by: string }>();
  return row ? publicOf(row)[0] : undefined;
}

/** How many live designs and beads the user has, for the profile. */
export async function countRows(db: D1Database, userId: string): Promise<{ designs: number; beads: number }> {
  const row = await db
    .prepare(
      `select (select count(*) from designs where owner_id = ?1 and deleted = 0) as designs,
              (select count(*) from owned_beads where owner_id = ?1 and deleted = 0) as beads`,
    )
    .bind(userId)
    .first<{ designs: number; beads: number }>();
  return row ?? { designs: 0, beads: 0 };
}

interface DesignRow {
  id: string;
  kind: SyncDesign["kind"];
  title: string;
  yaml: string;
  deleted: number;
  created_at: number;
  updated_at: number;
}

interface PinRow {
  target: string;
  pinned: number;
  pinned_at: number;
  updated_at: number;
}

interface BeadRow {
  bead_key: string;
  kind: "catalog" | "own" | null;
  bead: string | null;
  size: string | null;
  name: string | null;
  rgb: string | null;
  amount: string | null;
  note: string | null;
  deleted: number;
  updated_at: number;
}

type Kind = "design" | "pin" | "bead" | "palette" | "profile";

interface PaletteRow {
  owner_id: string;
  id: string;
  name: string;
  description: string;
  colors: string;
  visibility: string;
  deleted: number;
  updated_at: number;
}

interface ProfileRow {
  display_name: string;
  only_my_beads: number;
  color_source: string;
  updated_at: number;
}

function designOf(r: DesignRow): SyncDesign {
  const design: SyncDesign = { id: r.id, kind: r.kind, title: r.title, yaml: r.yaml, created: r.created_at, updated: r.updated_at };
  return r.deleted ? { ...design, deleted: true } : design;
}

function pinOf(r: PinRow): SyncPin {
  return { target: r.target, pinned: r.pinned === 1, pinnedAt: r.pinned_at, updated: r.updated_at };
}

function beadOf(r: BeadRow): SyncBead {
  const extra = { ...(r.amount ? { amount: r.amount } : {}), ...(r.note ? { note: r.note } : {}) };
  let bead: OwnedBead | undefined;
  if (r.kind === "catalog" && r.bead) bead = { kind: "catalog", bead: r.bead, ...extra };
  if (r.kind === "own" && r.size && r.name && r.rgb) bead = { kind: "own", size: r.size, name: r.name, rgb: r.rgb, ...extra };
  return { key: r.bead_key, ...(bead ? { bead } : {}), updated: r.updated_at, ...(r.deleted ? { deleted: true as const } : {}) };
}

function paletteOf(r: PaletteRow): SyncPalette {
  const palette = r.deleted ? undefined : readStoredPalette(r);
  return palette ? { id: r.id, palette, updated: r.updated_at } : { id: r.id, updated: r.updated_at, deleted: true };
}

/** A stored palette, read the way the browser reads one. */
function readStoredPalette(r: PaletteRow) {
  let colors: unknown;
  try {
    colors = JSON.parse(r.colors);
  } catch {
    return undefined;
  }
  return readMyPalette({ id: r.id, name: r.name, ...(r.description ? { description: r.description } : {}), colors, visibility: r.visibility });
}

function publicOf(r: PaletteRow & { by: string }): PublicPalette[] {
  const palette = readStoredPalette(r);
  if (!palette) return [];
  const shown = { id: palette.id, name: palette.name, ...(palette.description ? { description: palette.description } : {}), colors: palette.colors };
  return [{ owner: r.owner_id, by: r.by, updated: r.updated_at, palette: shown }];
}

function profileFrom(r: ProfileRow): SyncProfile {
  return profileOf(r.display_name, (r.color_source as SyncProfile["colorSource"]) ?? (r.only_my_beads === 1 ? "mine" : "all"), r.updated_at);
}

function marks(values: unknown[]): string {
  return values.map(() => "?").join(", ");
}
