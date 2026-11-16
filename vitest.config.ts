import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // fast-check properties run hundreds of cases; 5 s (the default) is too tight on a busy machine.
    testTimeout: 30000,
  },
});
