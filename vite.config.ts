import { defineConfig } from "vite";

// The app lives in web/ and reads patterns and the catalog from the project root.
export default defineConfig({
  root: "web",
  base: "./",
  // The 3D viewer chunk is mostly three.js (about 560 kB, 140 kB gzipped). It is
  // only loaded when the 3D view is opened.
  build: { outDir: "../dist", emptyOutDir: true, chunkSizeWarningLimit: 700 },
  server: { fs: { allow: [".."] } },
});
