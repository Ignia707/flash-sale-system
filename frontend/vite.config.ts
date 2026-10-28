import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    // `pnpm dev` talks to the API running on this machine (pnpm dev in backend/)
    proxy: { "/api": "http://localhost:3000" },
  },
  build: { target: "es2022" },
  test: { environment: "jsdom", include: ["test/**/*.test.{ts,tsx}"], setupFiles: ["test/setup.ts"] },
});
