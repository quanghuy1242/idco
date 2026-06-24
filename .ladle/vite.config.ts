import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const uiSrc = fileURLToPath(
  new URL("../packages/ui/src/index.ts", import.meta.url),
);
const libSrc = fileURLToPath(
  new URL("../packages/lib/src/index.ts", import.meta.url),
);
const readerSrc = fileURLToPath(
  new URL("../packages/reader/src/index.ts", import.meta.url),
);
const readerIslandsSrc = fileURLToPath(
  new URL("../packages/reader/src/islands/index.ts", import.meta.url),
);
const editorSrc = fileURLToPath(
  new URL("../packages/editor/src/index.ts", import.meta.url),
);
const editorLegacySrc = fileURLToPath(
  new URL("../packages/editor-legacy/src/index.ts", import.meta.url),
);
const nextLinkMock = fileURLToPath(
  new URL("./mocks/next-link.tsx", import.meta.url),
);
const nextNavigationMock = fileURLToPath(
  new URL("./mocks/next-navigation.ts", import.meta.url),
);
const nodeModules = fileURLToPath(new URL("../node_modules", import.meta.url));

export default defineConfig({
  plugins: [tailwindcss()],
  esbuild: {
    target: "esnext",
    tsconfigRaw: {
      compilerOptions: {
        jsx: "react-jsx",
        target: "ESNext",
      },
    },
  },
  build: {
    target: "esnext",
  },
  resolve: {
    dedupe: [
      "lucide-react",
      "react",
      "react-aria",
      "react-aria-components",
      "react-dom",
      "react-stately",
    ],
    alias: [
      { find: "@idco/ui", replacement: uiSrc },
      { find: "@quanghuy1242/idco-ui", replacement: uiSrc },
      { find: "@idco/lib", replacement: libSrc },
      { find: "@quanghuy1242/idco-lib", replacement: libSrc },
      {
        find: "@quanghuy1242/idco-reader/islands",
        replacement: readerIslandsSrc,
      },
      { find: "@quanghuy1242/idco-reader", replacement: readerSrc },
      { find: "@idco/reader", replacement: readerSrc },
      { find: "@idco/editor-legacy", replacement: editorLegacySrc },
      {
        find: "@quanghuy1242/idco-editor-legacy",
        replacement: editorLegacySrc,
      },
      { find: "@idco/editor", replacement: editorSrc },
      { find: "@quanghuy1242/idco-editor", replacement: editorSrc },
      {
        find: /^lucide-react$/,
        replacement: `${nodeModules}/lucide-react/dist/cjs/lucide-react.js`,
      },
      { find: "next/link", replacement: nextLinkMock },
      { find: "next/navigation", replacement: nextNavigationMock },
      {
        find: /^react\/jsx-dev-runtime$/,
        replacement: `${nodeModules}/react/jsx-dev-runtime.js`,
      },
      {
        find: /^react\/jsx-runtime$/,
        replacement: `${nodeModules}/react/jsx-runtime.js`,
      },
      { find: /^react$/, replacement: `${nodeModules}/react/index.js` },
      {
        find: /^react-aria$/,
        replacement: `${nodeModules}/react-aria/dist/exports/index.mjs`,
      },
      {
        find: /^react-aria-components$/,
        replacement: `${nodeModules}/react-aria-components/dist/exports/index.mjs`,
      },
      {
        find: /^react-dom\/client$/,
        replacement: `${nodeModules}/react-dom/client.js`,
      },
      { find: /^react-dom$/, replacement: `${nodeModules}/react-dom/index.js` },
      {
        find: /^react-stately$/,
        replacement: `${nodeModules}/react-stately/dist/exports/index.mjs`,
      },
    ],
  },
});
