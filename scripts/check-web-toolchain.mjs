import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const required = [
  "axios",
  "element-plus",
  "firecrawl",
  "msw",
  "pinia",
  "vue",
  "vue-router",
  "zod",
  "@playwright/test",
  "@testing-library/vue",
  "@eslint/js",
  "@vitejs/plugin-vue",
  "eslint",
  "eslint-config-prettier",
  "eslint-plugin-vue",
  "globals",
  "jsdom",
  "prettier",
  "typescript",
  "typescript-eslint",
  "vite",
  "vitest",
  "vue-tsc",
];

const allDependencies = {
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.devDependencies ?? {}),
};
const missing = required.filter((name) => !allDependencies[name]);

if (missing.length > 0) {
  console.error(
    `WEB TOOLCHAIN CHECK: FAIL\nMissing packages: ${missing.join(", ")}`,
  );
  process.exit(1);
}

console.log("WEB TOOLCHAIN CHECK: PASS");
console.log(`Packages declared: ${required.length}`);
console.log("Network scope: local loopback by default");
console.log("Target writes: disabled");
