import { defineConfig, devices } from "@playwright/test";

// Pruebas de extremo a extremo (e2e/). Usa el servidor de desarrollo en el
// puerto 3000: si ya está corriendo lo reutiliza, si no lo levanta.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    locale: "es-PE",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "escritorio", use: { ...devices["Desktop Chrome"] } },
    // Celular con Chromium (el único navegador instalado)
    { name: "celular", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
