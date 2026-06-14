import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: "@idco/ui",
        replacement: fileURLToPath(
          new URL("./packages/ui/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@quanghuy1242/idco-ui",
        replacement: fileURLToPath(
          new URL("./packages/ui/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@idco/lib",
        replacement: fileURLToPath(
          new URL("./packages/lib/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@idco/content-renderer",
        replacement: fileURLToPath(
          new URL("./packages/content-renderer/src/index.tsx", import.meta.url),
        ),
      },
      {
        find: "@idco/editor",
        replacement: fileURLToPath(
          new URL("./packages/editor/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "@quanghuy1242/idco-editor",
        replacement: fileURLToPath(
          new URL("./packages/editor/src/index.ts", import.meta.url),
        ),
      },
      {
        find: "next/link",
        replacement: fileURLToPath(
          new URL("./.ladle/mocks/next-link.tsx", import.meta.url),
        ),
      },
    ],
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/all.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
