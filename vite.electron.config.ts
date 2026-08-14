/**
 * vite.electron.config.ts
 * Vite configuration for Electron production builds.
 *
 * Key differences from the web config:
 * - base: './' for relative paths (required for file:// protocol)
 * - No dev-server plugins (manus-runtime, debug-collector)
 * - Output to dist/public (same location electron-builder.yml expects)
 */

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  // CRITICAL: Use relative base for Electron file:// protocol
  base: "./",
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Optimize for desktop
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          charts: ["recharts"],
          ui: ["@radix-ui/react-dialog", "@radix-ui/react-select", "@radix-ui/react-tabs"],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
});
