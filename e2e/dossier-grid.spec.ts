import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { wranglerSql } from "./helpers";

const phase = process.env.DOSSIER_PHASE === "before" ? "before" : "after";
const root = process.env.DOSSIER_ROOT ? `${process.env.DOSSIER_ROOT}/${phase}` : `docs/qa-screenshots/checkpoint-06-6-1/${phase}`;
const headers = { origin: "http://127.0.0.1:43174" };
const viewports = [
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1366", width: 1366, height: 900 },
] as const;

test("06.6.1 dossier visual grid", async ({ page, browser }) => {
  test.setTimeout(420_000);
  mkdirSync(root, { recursive: true });
  const stamp = Date.now().toString().slice(-6);
  const customer = await page.request.post("/api/v1/customers", {
    data: { legalName: `Grid Buyer ${stamp}`, countryCode: "EG", contacts: [{ fullName: "Nada", phone: "+201000009991" }] },
    headers,
  });
  expect(customer.ok()).toBeTruthy();
  const customerId = (await customer.json()).data.id as string;

  async function makeCase(route: "BANK_ROUTE" | "DIRECT_ROUTE", invoice: string) {
    const created = await page.request.post("/api/v1/export-cases", {
      data: {
        customerId,
        documentRoute: route,
        destinationCountry: "NL",
        invoice: {
          invoiceNumber: invoice,
          invoiceDate: "2026-10-12",
          paymentTermCode: "TT",
          incoterm: route === "BANK_ROUTE" ? "FOB" : "CFR",
          currency: "USD",
          goodsValue: "40.00",
          invoicedFreight: route === "BANK_ROUTE" ? "0" : "5.00",
          actualFreightExpense: "2.00",
          invoiceTotal: route === "BANK_ROUTE" ? "40.00" : "45.00",
          grossWeight: 12.5,
          netWeight: 11.2,
          weightUnit: "KG",
          portOfLoading: "Alexandria",
          portOfDischarge: "Rotterdam",
        },
      },
      headers,
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    return (await created.json()).data.id as string;
  }

  const bankId = await makeCase("BANK_ROUTE", `INV-BANK-${stamp}`);
  const directId = await makeCase("DIRECT_ROUTE", `INV-DIR-${stamp}`);
  const lockedId = await makeCase("DIRECT_ROUTE", `INV-LOCK-${stamp}`);
  wranglerSql(".wrangler-e2e/state", `UPDATE export_cases SET status = 'COMPLETED' WHERE id = '${lockedId}'`);
  const booking = await page.request.post("/api/v1/bookings", {
    data: { caseId: bankId, bookingNumber: `BK-${stamp}`, expectedContainers: 5, plannedEta: "2026-12-15", plannedEtd: "2026-12-01" },
    headers,
  });
  expect(booking.ok(), await booking.text()).toBeTruthy();
  const containers = await (await page.request.get(`/api/v1/export-cases/${bankId}`, { headers })).json();
  const slots = (containers.data.containers as Array<{ id: string; version: number }>) ?? [];
  const known = ["TCLU0000009", "HLXU1111119"];
  for (let i = 0; i < Math.min(2, slots.length); i += 1) {
    const numbered = await page.request.post(`/api/v1/containers/${slots[i].id}/number`, {
      data: { officialNumber: known[i], version: slots[i].version },
      headers,
    });
    expect(numbered.ok(), await numbered.text()).toBeTruthy();
  }

  const officerEmail = `grid.officer.${stamp}@example.com`;
  const officerPassword = "Officer-pass-12";
  const officer = await page.request.post("/api/v1/users", {
    data: { name: "Grid Officer", email: officerEmail, password: officerPassword, roleKeys: ["export_officer"] },
    headers,
  });
  expect(officer.ok(), await officer.text()).toBeTruthy();
  const officerId = (await officer.json()).data.id as string;
  wranglerSql(".wrangler-e2e/state", `UPDATE user SET must_change_password = 0 WHERE id = '${officerId}'`);
  wranglerSql(".wrangler-e2e/state", `UPDATE export_cases SET assigned_to = '${officerId}' WHERE id = '${directId}'`);

  const manifest: Array<Record<string, string>> = [];

  async function shoot(target: Page, scenario: string, caseId: string) {
    const started = Date.now();
    await target.goto(`/export-cases/${caseId}`);
    await expect(target.locator("[data-dossier='loaded']")).toBeVisible({ timeout: 20_000 });
    const readyMs = Date.now() - started;
    await expect(target.locator("h1")).toContainText("EF-");
    for (const locale of ["en", "ar"] as const) {
      const toggle = target.getByRole("button", { name: locale === "ar" ? "ع" : "EN" });
      if (await toggle.isVisible().catch(() => false)) await toggle.click();
      await expect(target.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
      await expect(target.locator("[data-dossier='loaded']")).toBeVisible();
      for (const viewport of viewports) {
        await target.setViewportSize({ width: viewport.width, height: viewport.height });
        const file = `${scenario}-${locale}-${viewport.name}.png`;
        await target.screenshot({ path: `${root}/${file}`, fullPage: true });
        manifest.push({
          phase,
          scenario,
          locale,
          viewport: `${viewport.width}x${viewport.height}`,
          caseId,
          file: `${root}/${file}`,
          ready: "data-dossier=loaded",
          readyMs: String(readyMs),
        });
      }
    }
  }

  await shoot(page, "bank", bankId);
  await shoot(page, "direct", directId);
  await shoot(page, "completed", lockedId);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.locator("[data-tab='invoices']").click();
  await expect(page.getByText(/Invoice locked|الفاتورة مقفلة/)).toBeVisible();
  await page.screenshot({ path: `${root}/completed-invoices-locked-1366.png`, fullPage: true });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.locator("[data-tab='invoices']").click();
  await expect(page.getByText(/Invoice locked|الفاتورة مقفلة/)).toBeVisible();
  await page.screenshot({ path: `${root}/completed-invoices-locked-1366.png`, fullPage: true });

  const officerContext = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const signed = await officerContext.request.post("/api/auth/sign-in/email", {
    data: { email: officerEmail, password: officerPassword },
    headers,
  });
  expect(signed.ok(), await signed.text()).toBeTruthy();
  const officerPage = await officerContext.newPage();
  await officerPage.goto("/dashboard");
  await expect(officerPage.getByRole("heading", { name: /Operations desk|برج/ })).toBeVisible();
  await shoot(officerPage, "limited", directId);
  const denied = await officerPage.goto(`/export-cases/${bankId}`);
  manifest.push({ phase, scenario: "limited-denied-bank", status: String(denied?.status() ?? 0), caseId: bankId, file: "" });
  await officerContext.close();
  writeFileSync(`${root}/evidence-manifest.json`, JSON.stringify(manifest, null, 2));
  expect(manifest.filter((row) => row.file.endsWith(".png"))).toHaveLength(24);
});
