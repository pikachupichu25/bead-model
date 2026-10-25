// The page links in the top bar, the same on every page: Home, a designer per
// technique, and My profile (with My beads under it), then signing in and out.

import { type Account, loadAccount, signInWith, signInWithPassword, signOut } from "./account.js";

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
  void loadAccount().then((account) => {
    if (account) renderAccount(nav, account);
  });
}

const PROVIDER_LABELS = { google: "Google", github: "GitHub" } as const;

/** "Sign in" (a menu of providers) when signed out; the name and "Sign out" when signed in. */
function renderAccount(nav: HTMLElement, account: Account): void {
  if (!account.user && account.providers.length === 0 && !account.password) return;
  const menu = document.createElement("details");
  menu.className = "nav-account";
  const { user } = account;
  if (user) {
    const initial = esc((user.name || user.email).slice(0, 1).toUpperCase());
    const avatar = user.image ? `<img src="${esc(user.image)}" alt="" referrerpolicy="no-referrer" />` : initial;
    menu.innerHTML = `
      <summary title="Signed in as ${esc(user.email)}"><span class="nav-avatar">${avatar}</span></summary>
      <div class="nav-account-menu">
        <p><strong>${esc(user.name || user.email)}</strong><br /><span>${esc(user.email)}</span></p>
        <button type="button" class="button" data-sign-out>Sign out</button>
      </div>`;
  } else {
    menu.innerHTML = `
      <summary>Sign in</summary>
      <div class="nav-account-menu">
        <p>Sign in to keep your designs and beads on every device.</p>
        ${account.providers.map((p) => `<button type="button" class="button" data-provider="${p}">Continue with ${PROVIDER_LABELS[p]}</button>`).join("")}
        ${
          account.password
            ? `<form data-password>
                <input type="email" name="email" placeholder="Email" required autocomplete="username" />
                <input type="password" name="password" placeholder="Password (8+ characters)" required minlength="8" autocomplete="current-password" />
                <div><button type="submit" class="button">Sign in</button> <button type="submit" class="button" data-create>Create account</button></div>
                <small>Email and password: local dev only.</small>
              </form>`
            : ""
        }
        <p class="nav-account-error" hidden></p>
      </div>`;
  }
  const error = menu.querySelector<HTMLElement>(".nav-account-error");
  const fail = (err: unknown) => {
    if (!error) return;
    error.textContent = err instanceof Error ? err.message : String(err);
    error.hidden = false;
  };
  menu.querySelector("[data-sign-out]")?.addEventListener("click", () => void signOut().catch(fail));
  for (const button of menu.querySelectorAll<HTMLButtonElement>("[data-provider]")) {
    button.addEventListener("click", () => void signInWith(button.dataset.provider as "google" | "github").catch(fail));
  }
  menu.querySelector<HTMLFormElement>("[data-password]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const create = (event as SubmitEvent).submitter?.hasAttribute("data-create") ?? false;
    void signInWithPassword(String(data.get("email")), String(data.get("password")), create).catch(fail);
  });
  // Clicking anywhere else closes the menu.
  document.addEventListener("click", (event) => {
    if (menu.open && !menu.contains(event.target as Node)) menu.open = false;
  });
  nav.append(menu);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
