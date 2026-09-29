import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// A local-only UI harness. Every server action resolves to an in-memory stub.
// No real patient data, credentials, authentication or database connections.
export default defineConfig({
  root: local("./"),
  resolve: {
    alias: [
      { find: /^@\/actions\/.+$/, replacement: local("./mock-actions.ts") },
      { find: "next/navigation", replacement: local("./mock-navigation.ts") },
      { find: "@", replacement: local("../../src") },
    ],
  },
  css: { postcss: local("../../") },
  server: { host: "127.0.0.1", port: 4173, strictPort: true, fs: { allow: [local("../../")] } },
});
