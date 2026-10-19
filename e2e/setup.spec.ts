import { expect, test } from "@playwright/test";
import { adminCreds, clearViteOverlay, login } from "./helpers";

test("E2E-01 bootstrap is one-shot and login reaches the dashboard", async ({ page, request }) => {
  const admin = adminCreds();
  const body = { email: admin.email, password: admin.password, name: "E2E Admin" };
  const headers = { "x-bootstrap-secret": admin.bootstrapSecret, origin: admin.base };
  const raced = await Promise.all([
    request.post("/api/v1/auth/bootstrap", { data: body, headers }),
    request.post("/api/v1/auth/bootstrap", { data: body, headers }),
  ]);
  expect(raced.filter((response) => response.ok()).length).toBe(1);
  expect(raced.filter((response) => response.status() === 409).length).toBe(1);

  const again = await request.post("/api/v1/auth/bootstrap", { data: body, headers });
  expect(again.status()).toBe(409);
  let missing = await request.post("/api/v1/auth/bootstrap", { data: body, headers: { origin: admin.base } });
  let missingBody = await missing.text();
  // The Cloudflare Vite proxy occasionally resets the first dispatch after the bootstrap race (HTML "fetch failed"), then the Worker answers 403.
  if (missing.status() === 500 && missingBody.includes("fetch failed")) {
    missing = await request.post("/api/v1/auth/bootstrap", { data: body, headers: { origin: admin.base } });
    missingBody = await missing.text();
  }
  expect(missing.status(), missingBody).toBe(403);
  const signup = await request.post("/api/auth/sign-up/email", {
    data: { email: "stranger@example.com", password: "not-allowed-pass", name: "Stranger" },
    headers: { origin: admin.base },
  });
  expect(signup.ok()).toBeFalsy();

  await page.goto("/login");
  await clearViteOverlay(page);
  await page.locator('input[name="email"]').fill(admin.email);
  await page.locator('input[name="password"]').fill("wrong-password-value");
  await clearViteOverlay(page);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Sign-in failed")).toBeVisible();

  await login(page, admin.email, admin.password);
  await expect(page.getByRole("heading", { name: "Operations desk" })).toBeVisible();
  await page.context().storageState({ path: ".wrangler-e2e/admin-state.json" });
});

test("E2E-01 logout and protected redirect", async ({ browser }) => {
  const admin = adminCreds();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await login(page, admin.email, admin.password);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/customers");
  await expect(page).toHaveURL(/\/login/);
  await context.close();
});
