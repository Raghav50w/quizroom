import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// P2 is client-only. P3 adds a proxy to Express; in production Express serves
// this build, so there is one port, one deploy, and no CORS.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "src/client",
  server: {
    // Dev only. In production Express serves this build from the same origin,
    // so there is one port and no CORS anywhere.
    proxy: {
      "/api": "http://localhost:4000",
      "/healthz": "http://localhost:4000",
    },
  },
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
});
