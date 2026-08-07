import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: that one sets root to src/client so
// the app builds, which would otherwise hide every test outside the client.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
