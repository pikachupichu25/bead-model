import { defineConfig } from "vite";

// The app lives in web/ and reads patterns and the catalog from the project root.
export default defineConfig({
  root: "web",
  base: "./",
  build: { outDir: "../dist", emptyOutDir: true },
  server: { fs: { allow: [".."] } },
});
