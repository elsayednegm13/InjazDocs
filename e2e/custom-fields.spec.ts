import { expect, test } from "@playwright/test";
import { api, createCase, createCustomer, login } from "./helpers";

const stamp = `cf${Date.now().toString().slice(-6)}`;

test("custom fields persist across customer, case, invoice, booking and container with access checks", async ({ page, browser }) => {
  const created: string[] = [];
  async function defineField(input: Record<string, unknown>) {
    const response = await api(page.request, "/api/v1/custom-fields", { method: "POST", data: input });
    expect(response.ok(), await response.text()).toBeTruthy();
    const body = await response.json();
    created.push(body.data.id as string);
    return body.data.id as string;
  }

  try {
    await page.goto("/settings");
    await page.locator('input[name="fieldKey"]').fill(`ui_${stamp}`);
    await page.locator('input[name="labelEn"]').fill(`UI label ${stamp}`);
    await page.locator('input[name="labelAr"]').fill(`تسمية ${stamp}`);
    await page.getByRole("button", { name: "Add field" }).click();
    await expect(page.getByText(`ui_${stamp}`)).toBeVisible();
    const catalog = await (await api(page.request, "/api/v1/custom-fields")).json();
    const uiField = catalog.data.find((field: { field_key: string }) => field.field_key === `ui_${stamp}`);
    created.push(uiField.id as string);

    await defineField({
      targetEntity: "CUSTOMER",
      fieldKey: `buyer_ref_${stamp}`,
      labelEn: `Buyer reference ${stamp}`,
      labelAr: `مرجع المشتري ${stamp}`,
      dataType: "TEXT",
    });
    const caseField = await defineField({
      targetEntity: "EXPORT_CASE",
      fieldKey: `file_no_${stamp}`,
      labelEn: `File number ${stamp}`,
      labelAr: `رقم الملف ${stamp}`,
      dataType: "TEXT",
      required: true,
    });
    await defineField({
      targetEntity: "INVOICE",
      fieldKey: `marks_${stamp}`,
      labelEn: `Marks ${stamp}`,
      labelAr: `العلامات ${stamp}`,
      dataType: "SELECT",
      options: ["Pier", "Yard"],
    });
    await defineField({
      targetEntity: "BOOKING",
      fieldKey: `agent_${stamp}`,
      labelEn: `Agent ${stamp}`,
      labelAr: `الوكيل ${stamp}`,
      dataType: "TEXT",
    });
    await defineField({
      targetEntity: "CONTAINER",
      fieldKey: `seal_${stamp}`,
      labelEn: `Seal ${stamp}`,
      labelAr: `الختم ${stamp}`,
      dataType: "TEXT",
    });
    const sensitive = await defineField({
      targetEntity: "CUSTOMER",
      fieldKey: `desk_note_${stamp}`,
      labelEn: `Desk note ${stamp}`,
      labelAr: `ملاحظة المكتب ${stamp}`,
      dataType: "TEXT",
      sensitive: true,
    });

    const customerName = `Field Buyer ${stamp}`;
    await createCustomer(page, customerName, `CF-${stamp}`);
    await expect(page.getByLabel(`Buyer reference ${stamp}`)).toBeVisible();
    await page.getByLabel(`Buyer reference ${stamp}`).fill(`REF-${stamp}`);
    await page.getByRole("button", { name: "Save custom fields" }).click();
    await expect(page.getByText("Custom fields saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(`Buyer reference ${stamp}`)).toHaveValue(`REF-${stamp}`);

    const customerId = page.url().split("/").pop();
    const saved = await api(page.request, `/api/v1/customers/${customerId}/custom-fields`, {
      method: "PUT",
      data: { [`buyer_ref_${stamp}`]: `REF-${stamp}`, [`desk_note_${stamp}`]: "internal-only" },
    });
    expect(saved.ok()).toBeTruthy();

    await createCase(page, {
      customer: customerName,
      route: "DIRECT_ROUTE",
      invoice: `INV-CF-${stamp}`,
      incoterm: "FOB",
      goods: "1000.00",
      invoicedFreight: "0",
      actualFreight: "0",
      total: "1000.00",
    });
    const caseId = page.url().split("/").pop();
    const blocked = await api(page.request, `/api/v1/export-cases/${caseId}/status`, {
      method: "POST",
      data: { to: "ACTIVE", version: 1 },
    });
    expect(blocked.status()).toBe(422);
    const blockedBody = await blocked.json();
    expect(blockedBody.error.code).toBe("CUSTOM_FIELD_REQUIRED");
    expect(JSON.stringify(blockedBody)).not.toContain("SQLITE");

    await page.getByLabel(`File number ${stamp}`).fill(`FILE-${stamp}`);
    await page.getByRole("button", { name: "Save custom fields" }).click();
    await expect(page.getByText("Custom fields saved.")).toBeVisible();
    const activated = await api(page.request, `/api/v1/export-cases/${caseId}/status`, {
      method: "POST",
      data: { to: "ACTIVE", version: 1 },
    });
    expect(activated.ok(), await activated.text()).toBeTruthy();

    await page.locator('[data-tab="invoices"]').click();
    await page.getByLabel(`Marks ${stamp}`).selectOption("Pier");
    await page.getByRole("button", { name: "Save custom fields" }).click();
    await expect(page.getByText("Custom fields saved.")).toBeVisible();

    const booking = await api(page.request, "/api/v1/bookings", {
      method: "POST",
      data: { caseId, bookingNumber: `BK-${stamp}`, expectedContainers: 2 },
    });
    expect(booking.ok(), await booking.text()).toBeTruthy();
    const bookingBody = await booking.json();
    const bookingId = bookingBody.data.id as string;
    await page.goto(`/bookings/${bookingId}`);
    await page.getByLabel(`Agent ${stamp}`).fill(`Agent ${stamp}`);
    await page.getByRole("button", { name: "Save custom fields" }).first().click();
    await expect(page.getByText("Custom fields saved.").first()).toBeVisible();
    const seal = page.getByLabel(`Seal ${stamp}`).first();
    await seal.fill(`SEAL-${stamp}`);
    await page.getByRole("button", { name: "Save custom fields" }).nth(1).click();
    await page.reload();
    await expect(page.getByLabel(`Agent ${stamp}`)).toHaveValue(`Agent ${stamp}`);
    await expect(page.getByLabel(`Seal ${stamp}`).first()).toHaveValue(`SEAL-${stamp}`);

    const forged = await api(page.request, `/api/v1/customers/${caseId}/custom-fields`, {
      method: "PUT",
      data: { [`buyer_ref_${stamp}`]: "nope" },
    });
    expect(forged.status()).toBe(404);

    const outsiderEmail = `outsider.${stamp}@example.com`;
    const outsiderPassword = "Outsider-pass-1";
    let outsider = await page.request.post("/api/v1/users", {
      data: { name: "Outsider", email: outsiderEmail, password: outsiderPassword, roleKeys: ["viewer"] },
      headers: { origin: "http://127.0.0.1:43174" },
    });
    let outsiderText = await outsider.text();
    if (outsider.status() === 500 && outsiderText.includes("fetch failed")) {
      outsider = await page.request.post("/api/v1/users", {
        data: { name: "Outsider", email: outsiderEmail, password: outsiderPassword, roleKeys: ["viewer"] },
        headers: { origin: "http://127.0.0.1:43174" },
      });
      outsiderText = await outsider.text();
    }
    expect(outsider.ok(), outsiderText).toBeTruthy();
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const employee = await context.newPage();
    await login(employee, outsiderEmail, outsiderPassword);
    const hiddenCase = await employee.request.get(`/api/v1/export-cases/${caseId}/custom-fields`);
    expect(hiddenCase.status()).toBe(403);
    const hidden = await employee.request.get(`/api/v1/customers/${customerId}/custom-fields`);
    expect(hidden.ok()).toBeTruthy();
    const hiddenBody = await hidden.json();
    const note = hiddenBody.data.find((field: { key: string }) => field.key === `desk_note_${stamp}`);
    expect(note.redacted).toBe(true);
    expect(note.value).toBeNull();
    const deniedWrite = await employee.request.put(`/api/v1/customers/${customerId}/custom-fields`, {
      data: { [`desk_note_${stamp}`]: "leaked" },
      headers: { origin: "http://127.0.0.1:43174" },
    });
    expect(deniedWrite.status()).toBe(403);
    let deniedDefine = await employee.request.post("/api/v1/custom-fields", {
      data: { targetEntity: "CUSTOMER", fieldKey: `hack_${stamp}`, labelEn: "Hack", labelAr: "اختراق", dataType: "TEXT" },
      headers: { origin: "http://127.0.0.1:43174" },
    });
    let deniedDefineText = await deniedDefine.text();
    if (deniedDefine.status() === 500 && (deniedDefineText.includes("fetch failed") || deniedDefineText.trimStart().startsWith("<"))) {
      deniedDefine = await employee.request.post("/api/v1/custom-fields", {
        data: { targetEntity: "CUSTOMER", fieldKey: `hack_${stamp}`, labelEn: "Hack", labelAr: "اختراق", dataType: "TEXT" },
        headers: { origin: "http://127.0.0.1:43174" },
      });
      deniedDefineText = await deniedDefine.text();
    }
    expect(deniedDefine.status(), deniedDefineText).toBe(403);
    expect(deniedDefineText).not.toContain("SQLITE");
    await context.close();

    await api(page.request, `/api/v1/custom-fields/${caseField}`, { method: "PATCH", data: { active: false } });
    const kept = await api(page.request, `/api/v1/export-cases/${caseId}/custom-fields`);
    const keptBody = await kept.json();
    const historical = keptBody.data.find((field: { key: string }) => field.key === `file_no_${stamp}`);
    expect(historical.active).toBe(false);
    expect(historical.value).toBe(`FILE-${stamp}`);
    void sensitive;
  } finally {
    for (const id of created) {
      await api(page.request, `/api/v1/custom-fields/${id}`, { method: "PATCH", data: { active: false, required: false } });
    }
  }
});
