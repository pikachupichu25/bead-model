import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const page = (name: string) => fileURLToPath(new URL(`./web/${name}`, import.meta.url));

// The app lives in web/ and reads patterns and the catalog from the project root.
export default defineConfig({
  root: "web",
  base: "./",
  // The 3D viewer chunk is mostly three.js (about 560 kB, 140 kB gzipped). It is
  // only loaded when the 3D view is opened.
  // Four pages: the step viewer (index.html), the pattern editor (editor.html),
  // the flat peyote designer (flat.html) and My beads (beads.html).
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
    rolldownOptions: { input: { index: page("index.html"), editor: page("editor.html"), flat: page("flat.html"), beads: page("beads.html") } },
  },
  server: { fs: { allow: [".."] } },
});
