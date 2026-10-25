// A design as a card, for the Home feed and the profile: its picture, title,
// technique and what can be done with it.

import type { Catalog } from "../src/catalog/catalog.js";
import { type FeedItem, KIND_LABELS } from "../src/collection/designs.js";
import { thumbnailSvg } from "../src/gallery/thumbnail.js";
import { designUrl, stepsUrl } from "./examples.js";

/** Pictures by design id and file, so redrawing the feed doesn't lay every design out again. */
const pictures = new Map<string, string>();

function picture(item: FeedItem, catalog: Catalog): string {
  const key = `${item.id}\n${item.yaml}`;
  let svg = pictures.get(key);
  if (svg === undefined) {
    try {
      svg = thumbnailSvg(item.kind, item.yaml, catalog) ?? `<span class="card-empty muted">No beads yet</span>`;
    } catch {
      svg = `<span class="card-empty muted">Can't draw this design</span>`;
    }
    pictures.set(key, svg);
  }
  return svg;
}

export interface CardOptions {
  pinned: boolean;
  /** Show Delete (for my own designs on the profile). */
  deletable?: boolean;
  now?: number;
}

const WEEK = 7 * 24 * 60 * 60 * 1000;

export function designCard(item: FeedItem, catalog: Catalog, { pinned, deletable = false, now = Date.now() }: CardOptions): string {
  const steps = stepsUrl(item);
  const fresh = !item.example && item.updated !== undefined && now - item.updated < WEEK;
  const badges = [
    pinned ? `<span class="badge pin">Pinned</span>` : "",
    item.example ? `<span class="badge">Example</span>` : fresh ? `<span class="badge new">New</span>` : "",
  ].join("");
  const when = item.updated ? `<span class="muted">${esc(timeAgo(item.updated, now))}</span>` : "";
  return `<article class="design-card" data-id="${esc(item.id)}">
    <a class="card-picture" href="${esc(designUrl(item))}" aria-label="Open ${esc(item.title)}">${picture(item, catalog)}</a>
    <div class="card-body">
      <div class="card-badges">${badges}</div>
      <h3><a href="${esc(designUrl(item))}">${esc(item.title)}</a></h3>
      <p class="card-meta"><span class="kind kind-${item.kind}">${esc(KIND_LABELS[item.kind])}</span>${when}</p>
      <div class="card-actions">
        <a class="button small" href="${esc(designUrl(item))}">${item.example ? "Open a copy" : "Open"}</a>
        ${steps ? `<a class="button small" href="${esc(steps)}">Step through</a>` : ""}
        <span class="spacer"></span>
        <button type="button" class="button small icon" data-action="pin" aria-pressed="${pinned}" title="${pinned ? "Unpin" : "Pin to the top of Home"}" aria-label="${pinned ? "Unpin" : "Pin"} ${esc(item.title)}">${pinned ? "★" : "☆"}</button>
        ${deletable ? `<button type="button" class="button small icon" data-action="delete" title="Delete" aria-label="Delete ${esc(item.title)}">🗑</button>` : ""}
      </div>
    </div>
  </article>`;
}

function timeAgo(then: number, now: number): string {
  const minutes = Math.round((now - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(then).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
