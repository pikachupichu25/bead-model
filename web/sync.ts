// Keeps this browser's My designs, pins, My beads and profile in step with the
// signed-in account. localStorage stays the working copy every page reads and
// writes at once; this runs alongside: on page load, when the tab comes back
// into view, and a few seconds after a save. Each time it works out what
// changed here since the last sync, pulls what changed in the account, keeps
// the newer of each, and pushes the rest. See docs/cloudflare-plan.md (Phase 3).

import {
  applyRemote,
  batches,
  changeCount,
  emptyRecord,
  type LocalState,
  localChanges,
  pinTimesOf,
  readSyncRecord,
  recordOf,
  type SyncChanges,
  type SyncPull,
  type SyncPushResult,
} from "../src/collection/sync.js";
import { loadMyDesigns, saveMyDesigns } from "./designs-store.js";
import { loadMyBeads, loadOnlyMine, saveMyBeads, saveOnlyMine } from "./my-beads-store.js";
import { loadProfileName, saveProfileName } from "./profile-store.js";
import { announceSynced, onSave, quietly } from "./store-events.js";

/** How long after a save to sync. */
const AFTER_SAVE_MS = 3000;
/** A push sent as the page closes must be small (browsers cap keepalive requests at 64 kB). */
const KEEPALIVE_BYTES = 60_000;

const recordKey = (userId: string) => `bead-model:sync:${userId}`;

let userId: string | undefined;
let timer: number | undefined;
let stopped = false;

/** Starts keeping this browser in step with the account. Called once per page, when someone is signed in. */
export function startSync(id: string): void {
  if (userId) return;
  userId = id;
  void syncNow();
  onSave(() => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void syncNow(), AFTER_SAVE_MS);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNow();
    else flushOnLeave();
  });
  window.addEventListener("online", () => void syncNow());
  window.addEventListener("pagehide", flushOnLeave);
}

/** One sync, one at a time across this browser's tabs. Resolves false when it couldn't reach the account. */
export async function syncNow(): Promise<boolean> {
  if (!userId || stopped) return false;
  clearTimeout(timer);
  timer = undefined;
  const run = () => syncOnce(userId!);
  try {
    return await (navigator.locks ? navigator.locks.request("bead-model:sync", run) : run());
  } catch (err) {
    console.warn("sync failed; trying again later", err);
    return false;
  }
}

async function syncOnce(id: string): Promise<boolean> {
  const saved = readSyncRecord(read(recordKey(id)));
  const firstTime = !saved;
  const record = saved ?? emptyRecord();
  const before = loadState();
  const mine = localChanges(before, record, Date.now());
  const pinTimes = pinTimesOf(before, record, mine);

  const pull = await api<SyncPull>(`/api/sync?since=${record.since}`);
  if (!pull) return false;
  let { state, local } = applyRemote(before, pull, mine, pinTimes);

  for (const batch of batches(local)) {
    // On failure nothing is saved: the next sync finds the same changes and pulls again.
    const result = await api<SyncPushResult>("/api/sync", batch);
    if (!result) return false;
    ({ state } = applyRemote(state, result.rejected, { designs: [], pins: [], beads: [] }, pinTimes));
  }

  // If the page saved something while this ran, start over rather than overwrite it.
  if (JSON.stringify(loadState()) !== JSON.stringify(before)) {
    timer = window.setTimeout(() => void syncNow(), 500);
    return true;
  }
  saveState(before, state);
  write(recordKey(id), JSON.stringify(recordOf(state, pull.now, pinTimes)));
  if (firstTime) announceFirstSync(mine, pull);
  return true;
}

/** As the page closes or hides: send this page's unsent changes if a sync was waiting, without waiting for the reply. */
function flushOnLeave(): void {
  if (!userId || stopped || timer === undefined) return;
  clearTimeout(timer);
  timer = undefined;
  const record = readSyncRecord(read(recordKey(userId)));
  if (!record) return;
  const changes = localChanges(loadState(), record, Date.now());
  const body = JSON.stringify(changes);
  if (changeCount(changes) === 0 || body.length > KEEPALIVE_BYTES) return;
  void fetch("/api/sync", { method: "POST", credentials: "same-origin", keepalive: true, headers: { "content-type": "application/json" }, body }).catch(() => {});
}

/**
 * Before signing out: one last sync, then (if asked) removes everything this
 * site keeps in this browser, so a shared computer doesn't keep the account's designs.
 */
export async function beforeSignOut(clear: boolean): Promise<void> {
  await syncNow();
  stopped = true;
  if (!clear) return;
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith("bead-model:")) localStorage.removeItem(key);
  } catch {
    // Without storage there is nothing to clear.
  }
}

/** Whether this browser holds designs or beads (to ask about before signing out). */
export function hasLocalData(): boolean {
  const state = loadState();
  return state.designs.designs.length > 0 || state.beads.beads.length > 0;
}

function loadState(): LocalState {
  return { designs: loadMyDesigns(), beads: loadMyBeads(), name: loadProfileName(), onlyMyBeads: loadOnlyMine() };
}

/** Writes what changed, without starting another sync, and tells the page to re-draw. */
function saveState(before: LocalState, after: LocalState): void {
  let changed = false;
  quietly(() => {
    if (JSON.stringify(after.designs) !== JSON.stringify(before.designs)) {
      saveMyDesigns(after.designs);
      changed = true;
    }
    if (JSON.stringify(after.beads) !== JSON.stringify(before.beads)) {
      saveMyBeads(after.beads);
      changed = true;
    }
    if (after.name !== before.name) {
      saveProfileName(after.name);
      changed = true;
    }
    if (after.onlyMyBeads !== before.onlyMyBeads) {
      saveOnlyMine(after.onlyMyBeads);
      changed = true;
    }
  });
  if (changed) announceSynced();
}

/** After the first sync on this browser: says what was added each way. */
function announceFirstSync(mine: SyncChanges, pull: SyncPull): void {
  const up = mine.designs.filter((d) => !d.deleted).length;
  const beadsUp = mine.beads.filter((b) => !b.deleted).length;
  const down = pull.designs.filter((d) => !d.deleted).length;
  const parts: string[] = [];
  if (up || beadsUp) parts.push(`added ${plural(up, "design")} and ${plural(beadsUp, "bead")} from this browser to your account`);
  if (down) parts.push(`brought in ${plural(down, "design")} from your account`);
  if (!parts.length) return;
  const notice = document.getElementById("notice");
  if (!notice) return;
  const text = parts.join(", and ");
  notice.textContent = `Signed in: ${text}.`;
  notice.hidden = false;
  window.setTimeout(() => (notice.hidden = true), 8000);
}

/** GET (no body) or POST (a body) to the API. Undefined when it can't be reached or the session ended. */
async function api<T>(url: string, body?: unknown): Promise<T | undefined> {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  }).catch(() => undefined);
  if (res?.status === 401) stopped = true;
  if (!res?.ok) return undefined;
  return (await res.json()) as T;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Without storage the record isn't kept: the next sync compares with nothing and pushes everything again, which is harmless.
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
