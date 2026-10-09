import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure-logic unit tests only — no DOM, no Three.js. Node is enough.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
