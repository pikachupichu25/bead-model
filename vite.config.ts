import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

const page = (name: string) => fileURLToPath(new URL(`./web/${name}`, import.meta.url));

// The app lives in web/ and reads patterns and the catalog from the project root.
export default defineConfig({
  root: "web",
  // Runs the Worker (/api) and a local D1 inside the dev server, from wrangler.jsonc.
  // Local D1 data lives in .wrangler/state, where `wrangler d1 migrations apply --local` puts it.
  plugins: [
    cloudflare({
      configPath: fileURLToPath(new URL("./wrangler.jsonc", import.meta.url)),
      persistState: { path: fileURLToPath(new URL("./.wrangler/state", import.meta.url)) },
    }),
  ],
  base: "./",
  // The 3D viewer chunk is mostly three.js (about 560 kB, 140 kB gzipped). It is
  // only loaded when the 3D view is opened.
  // The pages: Home (index.html), My profile (profile.html), the step viewer
  // (steps.html), the pattern editor (editor.html), the flat peyote designer
  // (flat.html), the Nora net designer (nora.html), My beads (beads.html),
  // Palettes (palettes.html) and one public palette (palette.html).
  build: {
    chunkSizeWarningLimit: 700,
  },
  // The pages are the client build's entries (the Worker has its own, from wrangler.jsonc).
  environments: {
    bead_bench: { build: { outDir: "../dist/bead_bench" } },
    client: {
      build: {
        outDir: "../dist/client",
        emptyOutDir: true,
        rolldownOptions: {
          input: {
            index: page("index.html"),
            profile: page("profile.html"),
            steps: page("steps.html"),
            editor: page("editor.html"),
            flat: page("flat.html"),
            nora: page("nora.html"),
            beads: page("beads.html"),
            palettes: page("palettes.html"),
            palette: page("palette.html"),
          },
        },
      },
    },
  },
  server: { fs: { allow: [".."] } },
});
