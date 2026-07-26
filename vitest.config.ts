import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
      include: [
        "src/lib/**/*.{ts,tsx}",
        "src/actions/**/*.{ts,tsx}",
        "src/components/**/*.{ts,tsx}",
      ],
      exclude: ["src/components/ui/**"],
      thresholds: {
        statements: 30,
        branches: 35,
        functions: 30,
        lines: 30,
      },
    },
  },
});
