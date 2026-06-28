import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { aliases } from "./vitest.shared";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: aliases,
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/all.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
