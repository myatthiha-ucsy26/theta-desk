/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // `npm run dev` on :5173 talks to the Flask server started by ./run.sh.
    proxy: { "/api": "http://127.0.0.1:5057" },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // The screen tests render whole pages in jsdom; with 44 files in parallel on a busy
    // machine a single one can pass 5s. The default made them fail on load, not on bugs.
    testTimeout: 20_000,
  },
});
