import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Minimal Vitest setup — the frontend had no test framework before
// Phase 3.10. Vitest was chosen because it needs the least new
// configuration for a Vite/Next-compatible React 19 + TypeScript
// project (native ESM, fast, no separate transform config), not
// because of any strong opinion beyond "smallest addition that lets
// us actually test the existing architecture."
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    // The server-side origin has no default (src/lib/backend-origin.ts), so the
    // suite supplies one. Tests of the "unset" case stub it empty explicitly.
    env: { BACKEND_API_ORIGIN: "http://backend.test" },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // See test/server-only-stub.ts for why.
      "server-only": path.resolve(import.meta.dirname, "./test/server-only-stub.ts"),
    },
  },
});
