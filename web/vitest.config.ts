import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Default: pure-logic unit tests (node). Files that render components
    // opt into jsdom per-file with `// @vitest-environment jsdom`.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
