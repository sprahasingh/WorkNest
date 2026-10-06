import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Every test file starts a MongoDB replica set. Keeping only two alive at
    // once avoids resource-related registration failures on CI runners.
    maxWorkers: 2,
  },
});
