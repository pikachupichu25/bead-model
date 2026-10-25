// The name on My profile, kept in this browser's localStorage.

import { announceSave } from "./store-events.js";

const NAME_KEY = "bead-model:profile-name";

export function loadProfileName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveProfileName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name.trim());
    announceSave();
  } catch {
    // Storage can be off: the name holds until the page closes.
  }
}
