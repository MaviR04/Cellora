import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The API runs separately on :4000; proxying keeps the browser on one origin (no CORS,
    // and session cookies just work in Phase 3).
    proxy: { "/api": "http://localhost:4000" },
  },
});
