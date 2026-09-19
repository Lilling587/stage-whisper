import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Standalone desktop (Electron) build: a static SPA that renders the same
// screen as the web app. It talks to the hosted transcription endpoint,
// configured through VITE_APP_SERVER_URL.
export default defineConfig({
  root: path.resolve(import.meta.dirname, "."),
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "../src") },
  },
  envDir: path.resolve(import.meta.dirname, ".."),
  build: {
    outDir: path.resolve(import.meta.dirname, "../desktop-dist"),
    emptyOutDir: true,
  },
});
