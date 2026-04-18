import { defineConfig } from "vitest/config";
import * as path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "renderer/src"),
    },
  },
  test: {
    include: ["renderer/src/**/*.test.ts"],
    environment: "node",
  },
});
