/**
 * Browser suite. Runs against the BUILT package (dist/), so `pnpm build`
 * first — `pnpm test` does both.
 *
 * Most specs measure real layout: column widths after a drag, line boxes,
 * font metrics, print parity. Those need a real rendering engine, which is the
 * point of this suite; jsdom covers everything that does not (tests/unit).
 *
 * PW_CHANNEL=chrome runs against the installed Google Chrome instead of
 * Playwright's bundled Chromium.
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 4178);

export default defineConfig({
  testDir: "tests/browser",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  use: {
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
        channel: process.env.PW_CHANNEL || undefined,
      },
    },
  ],
  webServer: {
    command: `node tests/browser/support/server.mjs`,
    url: `http://127.0.0.1:${PORT}/__health`,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
  },
});
