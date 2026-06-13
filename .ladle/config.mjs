import { fileURLToPath } from "node:url";

const viteConfigPath = fileURLToPath(
  new URL("./vite.config.ts", import.meta.url),
);

/** @type {import("@ladle/react").UserConfig} */
export default {
  stories: ["stories/**/*.stories.{js,jsx,ts,tsx,mdx}"],
  viteConfig: viteConfigPath,
  base: process.env.LADLE_BASE,
};
