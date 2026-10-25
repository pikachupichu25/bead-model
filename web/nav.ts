// The page links in the top bar, the same on every page: Home, a designer per
// technique, and My profile (with My beads under it).

export type Page = "home" | "peyote" | "flat" | "nora" | "profile";

const LINKS: { page: Page; href: string; label: string; title: string }[] = [
  { page: "home", href: "./index.html", label: "Home", title: "Designs and beads" },
  { page: "peyote", href: "./editor.html", label: "Circular", title: "Circular peyote: design and step through" },
  { page: "flat", href: "./flat.html", label: "Flat", title: "Flat peyote designer" },
  { page: "nora", href: "./nora.html", label: "Nora", title: "Nora net designer" },
  { page: "profile", href: "./profile.html", label: "My profile", title: "My designs and my beads" },
];

/** Fills the page's `#page-nav`, marking `current`. */
export function renderNav(current: Page): void {
  const nav = document.getElementById("page-nav");
  if (!nav) return;
  nav.innerHTML = LINKS.map(
    (l) => `<a href="${l.href}" title="${l.title}"${l.page === current ? ' aria-current="page"' : ""}>${l.label}</a>`,
  ).join("");
}
