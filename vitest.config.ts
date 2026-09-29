import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Starts one in-memory MongoDB per test file and connects Mongoose to it.
    setupFiles: ["./test/setup.ts"],
  },
});
