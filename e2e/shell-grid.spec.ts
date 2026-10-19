import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { wranglerSql } from "./helpers";

const phase = process.env.SHELL_PHASE === "before" || process.env.SHELL_PHASE === "after" ? process.env.SHELL_PHASE : null;
const root = `docs/qa-screenshots/checkpoint-06-7-1/${phase ?? "scratch"}`;
const headers = { origin: "http://127.0.0.1:43174" };
const viewports = [
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1366", width: 1366, height: 900 },
] as const;

test("06.7.1 premium workspace visual grid", async ({ page, browser }) => {
  test.setTimeout(420_000);
  if (phase) mkdirSync(root, { recursive: true });
  const stamp = Date.now().toString().slice(-6);
  const customer = await page.request.post("/api/v1/customers", {
    data: { legalName: `Desk Buyer ${stamp}`, countryCode: "EG", contacts: [{ fullName: "Nada", phone: "+201000008881" }] },
    headers,
  });
  expect(customer.ok(), await customer.text()).toBeTruthy();
  const customerId = (await customer.json()).data.id as string;
  const created = await page.request.post("/api/v1/export-cases", {
    data: {
      customerId,
      documentRoute: "DIRECT_ROUTE",
      destinationCountry: "NL",
      invoice: {
        invoiceNumber: `INV-DESK-${stamp}`,
        invoiceDate: "2026-12-02",
        paymentTermCode: "TT",
        incoterm: "FOB",
        currency: "USD",
        goodsValue: "20.00",
        invoicedFreight: "0",
        actualFreightExpense: "0",
        invoiceTotal: "20.00",
        grossWeight: 2,
        netWeight: 1,
        weightUnit: "KG",
      },
    },
    headers,
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const caseId = (await created.json()).data.id as string;
  const officerEmail = `desk.officer.${stamp}@example.com`;
  const officerPassword = "Officer-pass-12";
  const officer = await page.request.post("/api/v1/users", {
    data: { name: "Desk Officer", email: officerEmail, password: officerPassword, roleKeys: ["export_officer"] },
    headers,
  });
  expect(officer.ok(), await officer.text()).toBeTruthy();
  const officerId = (await officer.json()).data.id as string;
  wranglerSql(".wrangler-e2e/state", `UPDATE user SET must_change_password = 0 WHERE id = '${officerId}'`);
  wranglerSql(".wrangler-e2e/state", `UPDATE export_cases SET assigned_to = '${officerId}' WHERE id = '${caseId}'`);

  const manifest: Array<Record<string, string>> = [];
  const timings: number[] = [];

  async function shoot(target: Page, role: string, pathName: string, ready: string) {
    const started = Date.now();
    await target.goto(pathName);
    await expect(target.locator(ready)).toBeVisible({ timeout: 20_000 });
    const readyMs = String(Date.now() - started);
    if (role === "admin") timings.push(Date.now() - started);
    for (const locale of ["en", "ar"] as const) {
      const toggle = target.getByRole("button", { name: locale === "ar" ? "ع" : "EN" });
      if (await toggle.isVisible().catch(() => false)) await toggle.click();
      await expect(target.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
      for (const viewport of viewports) {
        await target.setViewportSize({ width: viewport.width, height: viewport.height });
        const pageName = pathName.startsWith("/export-cases") ? "cases" : "dashboard";
        const file = `${pageName}-${role}-${locale}-${viewport.name}.png`;
        if (phase) await target.screenshot({ path: `${root}/${file}`, fullPage: true });
        manifest.push({
          phase,
          role,
          page: pageName,
          locale,
          viewport: `${viewport.width}x${viewport.height}`,
          file: `${root}/${file}`,
          ready,
          readyMs,
          fixture: `INV-DESK-${stamp}`,
        });
      }
    }
  }

  await shoot(page, "admin", "/dashboard", "[data-dashboard='ready']");
  for (let i = 0; i < 4; i += 1) {
    const started = Date.now();
    await page.goto("/dashboard");
    await expect(page.locator("[data-dashboard='ready']")).toBeVisible({ timeout: 20_000 });
    timings.push(Date.now() - started);
  }
  await shoot(page, "admin", "/export-cases", "[data-cases='ready']");
  const context = await browser.newContext();
  const signed = await context.request.post("/api/auth/sign-in/email", {
    data: { email: officerEmail, password: officerPassword },
    headers,
  });
  expect(signed.ok(), await signed.text()).toBeTruthy();
  const officerPage = await context.newPage();
  await shoot(officerPage, "limited", "/dashboard", "[data-dashboard='ready']");
  await shoot(officerPage, "limited", "/export-cases", "[data-cases='ready']");
  const denied = await officerPage.request.get("/api/v1/users", { headers });
  manifest.push({ phase, role: "limited", page: "users-api", status: String(denied.status()), file: "" });
  await context.close();
  if (phase) writeFileSync(`${root}/visual-manifest.json`, JSON.stringify({ manifest, adminDashboardWarmMs: timings }, null, 2));
  expect(manifest.filter((row) => row.file)).toHaveLength(phase ? 24 : 24);
});
