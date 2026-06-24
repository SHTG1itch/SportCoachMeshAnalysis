import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import * as path from "path";
import { readFileSync } from "fs";

// Single source of truth for the displayed app version: package.json. Injected
// as a compile-time constant so the renderer never drifts from the real version.
const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
) as { version: string };

export default defineConfig({
  root: path.resolve(__dirname, "renderer"),
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "renderer/src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
});
