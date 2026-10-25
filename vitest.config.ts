import { defineConfig } from "vitest/config";

// Separate from vite.config.ts, whose root is web/: tests run from the project root.
export default defineConfig({
  test: { include: ["test/**/*.test.ts", "worker/**/*.test.ts"] },
});
