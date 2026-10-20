import { test, expect } from "@playwright/test";

// Credenciales de una cuenta de prueba (no se guardan en el repositorio):
//   PowerShell:  $env:E2E_EMAIL="..."; $env:E2E_PASSWORD="..."; npm run test:e2e
const E2E_EMAIL = process.env.E2E_EMAIL;
const E2E_PASSWORD = process.env.E2E_PASSWORD;

test("muestra la pantalla de inicio de sesión", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Registro de Acampantes" })).toBeVisible();
  await expect(page.getByLabel("Correo electrónico")).toBeVisible();
  await expect(page.getByLabel("Contraseña")).toBeVisible();
  await expect(page.getByRole("button", { name: "Iniciar sesión" })).toBeVisible();
});

test("inicia sesión y muestra el lector", async ({ page }) => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD, "Define E2E_EMAIL y E2E_PASSWORD");

  await page.goto("/");
  await page.getByLabel("Correo electrónico").fill(E2E_EMAIL!);
  await page.getByLabel("Contraseña").fill(E2E_PASSWORD!);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  await expect(page.getByPlaceholder("Escanea o escribe el DNI")).toBeVisible();
  await expect(page.getByText("Cargar lista de invitados")).toBeVisible();
});
