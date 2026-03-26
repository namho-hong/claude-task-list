import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "e2e-*.spec.ts",
  timeout: 15000,
  use: {
    baseURL: "http://localhost:1420",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
