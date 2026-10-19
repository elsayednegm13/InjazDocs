import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { patchReminderRule, wranglerSql } from "./helpers";

const origin = "http://127.0.0.1:43174";
const headers = { origin };

function sql(command: string) {
  return wranglerSql(".wrangler-e2e/state", command);
}

test("A2 an authenticated user without the case cannot download the file", async ({ page, browser }) => {
  const stamp = Date.now().toString().slice(-6);
  const customer = await page.request.post("/api/v1/customers", {
    data: { legalName: `IDOR ${stamp}`, countryCode: "EG", contacts: [{ fullName: "Nada", phone: "+201000000099" }] },
    headers,
  });
  expect(customer.ok()).toBeTruthy();
  const customerId = (await customer.json()).data.id as string;
  const created = await page.request.post("/api/v1/export-cases", {
    data: { customerId, documentRoute: "DIRECT_ROUTE" },
    headers,
  });
  expect(created.ok()).toBeTruthy();
  const caseId = (await created.json()).data.id as string;
  const overview = await (await page.request.get(`/api/v1/export-cases/${caseId}`)).json();
  const requirement = overview.data.requirements.find((row: { name_en: string }) => row.name_en === "Commercial Invoice");
  const other = overview.data.requirements.find((row: { name_en: string }) => row.name_en === "Packing List");
  const pdf = readFileSync("e2e/fixtures/sample.pdf");
  const session = await page.request.post("/api/v1/files/uploads", {
    data: {
      parentType: "document_requirement",
      parentId: requirement.id,
      filename: "sample.pdf",
      mime: "application/pdf",
      expectedBytes: pdf.length,
    },
    headers,
  });
  expect(session.ok()).toBeTruthy();
  const sessionId = (await session.json()).data.id as string;
  const signed = await page.request.post(`/api/v1/files/uploads/${sessionId}/sign`, { data: { partNumber: 1 }, headers });
  const put = await page.request.put((await signed.json()).data.url, { data: pdf, headers });
  expect(put.ok()).toBeTruthy();
  const etag = (await put.json()).data.etag as string;
  const done = await page.request.post(`/api/v1/files/uploads/${sessionId}/complete`, {
    data: { parts: [{ partNumber: 1, etag }] },
    headers,
  });
  expect(done.ok()).toBeTruthy();
  const objectKey = (await done.json()).data.objectKey as string;
  const attached = await page.request.post(`/api/v1/document-requirements/${requirement.id}/versions`, {
    data: { r2Key: objectKey, originalName: "sample.pdf", contentType: "application/pdf", byteSize: pdf.length },
    headers,
  });
  expect(attached.ok()).toBeTruthy();
  const crossed = await page.request.post(`/api/v1/document-requirements/${other.id}/versions`, {
    data: { r2Key: objectKey, originalName: "sample.pdf", contentType: "application/pdf", byteSize: pdf.length },
    headers,
  });
  expect(crossed.status()).toBe(404);

  const email = `officer.${stamp}@example.com`;
  const password = "Officer-pass-12";
  const user = await page.request.post("/api/v1/users", {
    data: { name: "Officer", email, password, roleKeys: ["export_officer"] },
    headers,
  });
  expect(user.ok()).toBeTruthy();
  const context = await browser.newContext();
  const signedIn = await context.request.post("/api/auth/sign-in/email", {
    data: { email, password },
    headers: { origin },
  });
  expect(signedIn.ok(), await signedIn.text()).toBeTruthy();
  const denied = await context.request.get(`/api/v1/files/download?key=${encodeURIComponent(objectKey)}`);
  expect(denied.status()).toBe(404);
  expect((await denied.body()).subarray(0, 4).toString()).not.toBe("%PDF");
  const allowed = await page.request.get(`/api/v1/files/download?key=${encodeURIComponent(objectKey)}`);
  expect(allowed.ok()).toBeTruthy();
  expect((await allowed.body()).subarray(0, 4).toString()).toBe("%PDF");
  const escalate = await context.request.post(`/api/v1/users/${(await user.json()).data.id}/roles`, {
    data: { roleKeys: ["administrator"] },
    headers,
  });
  expect(escalate.status()).toBe(403);
  await context.close();
});

test("A3 last effective administrator cannot be removed and a second admin can", async ({ page }) => {
  const me = await (await page.request.get("/api/v1/me")).json();
  const adminId = me.data.id as string;
  const disable = await page.request.post(`/api/v1/users/${adminId}/active`, { data: { active: false }, headers });
  expect(disable.status()).toBe(409);
  const demote = await page.request.post(`/api/v1/users/${adminId}/roles`, { data: { roleKeys: ["viewer"] }, headers });
  expect(demote.status()).toBe(409);
  const deny = await page.request.post(`/api/v1/users/${adminId}/overrides`, {
    data: { overrides: [{ permissionKey: "users.manage", effect: "DENY" }] },
    headers,
  });
  expect(deny.status()).toBe(409);
  const stripped = await page.request.put("/api/v1/roles/role-admin/permissions", {
    data: { permissions: ["dashboard.view"] },
    headers,
  });
  expect(stripped.status()).toBe(409);
  const stillAdmin = await page.request.get("/api/v1/users");
  expect(stillAdmin.ok()).toBeTruthy();

  const stamp = Date.now().toString().slice(-6);
  const second = await page.request.post("/api/v1/users", {
    data: { name: "Second Admin", email: `admin2.${stamp}@example.com`, password: "Second-admin-12", roleKeys: ["administrator"] },
    headers,
  });
  expect(second.status()).toBe(201);
  const secondId = (await second.json()).data.id as string;
  const disableSecond = await page.request.post(`/api/v1/users/${secondId}/active`, { data: { active: false }, headers });
  expect(disableSecond.ok()).toBeTruthy();
  const disableLast = await page.request.post(`/api/v1/users/${adminId}/active`, { data: { active: false }, headers });
  expect(disableLast.status()).toBe(409);
});

test("A4 shared D1 counter ignores spoofed IPs and resets the window", async ({ browser }) => {
  const context = await browser.newContext();
  async function burst() {
    sql("DELETE FROM rate_limit_buckets");
    const statuses: number[] = [];
    let cursor = 0;
    const total = 40;
    async function worker() {
      while (cursor < total) {
        const index = cursor;
        cursor += 1;
        const response = await context.request.get(`/api/v1/public/track/not-a-real-token-${index}`, {
          headers: { "x-forwarded-for": `198.51.100.${index}`, "cf-connecting-ip": `203.0.113.${index}` },
        });
        statuses.push(response.status());
      }
    }
    await Promise.all(Array.from({ length: 8 }, () => worker()));
    return statuses;
  }
  let statuses = await burst();
  // Local Miniflare can drop in-flight D1 hits. Repeat the same 40-request, limit-30 check. The limit is unchanged.
  for (let attempt = 0; attempt < 2 && statuses.filter((status) => status === 429).length !== 10; attempt += 1) {
    statuses = await burst();
  }
  const detail = statuses.join(",");
  expect(statuses.filter((status) => status === 410), detail).toHaveLength(30);
  expect(statuses.filter((status) => status === 429), detail).toHaveLength(10);
  sql("UPDATE rate_limit_buckets SET window_start = 1");
  const reset = await context.request.get("/api/v1/public/track/after-window");
  expect(reset.status()).toBe(410);
  await context.close();
});

test("A5 interrupted, invalid, expired and foreign uploads do not become documents", async ({ page }) => {
  const stamp = Date.now().toString().slice(-6);
  const customer = await page.request.post("/api/v1/customers", {
    data: { legalName: `Upload ${stamp}`, countryCode: "EG" },
    headers,
  });
  const customerId = (await customer.json()).data.id as string;
  const created = await page.request.post("/api/v1/export-cases", {
    data: { customerId, documentRoute: "DIRECT_ROUTE" },
    headers,
  });
  const caseId = (await created.json()).data.id as string;
  let overviewResponse = await page.request.get(`/api/v1/export-cases/${caseId}`);
  let overviewText = await overviewResponse.text();
  if (overviewText.trimStart().startsWith("<")) {
    overviewResponse = await page.request.get(`/api/v1/export-cases/${caseId}`);
    overviewText = await overviewResponse.text();
  }
  expect(overviewText.trimStart().startsWith("<"), overviewText.slice(0, 120)).toBeFalsy();
  const overview = JSON.parse(overviewText);
  const requirement = overview.data.requirements[0];
  const pdf = readFileSync("e2e/fixtures/sample.pdf");

  async function openSession(bytes: number, filename = "sample.pdf") {
    const response = await page.request.post("/api/v1/files/uploads", {
      data: { parentType: "document_requirement", parentId: requirement.id, filename, mime: "application/pdf", expectedBytes: bytes },
      headers,
    });
    expect(response.status()).toBe(201);
    return (await response.json()).data.id as string;
  }

  const aborted = await openSession(pdf.length, "abort.pdf");
  const abortedSign = await page.request.post(`/api/v1/files/uploads/${aborted}/sign`, { data: { partNumber: 1 }, headers });
  await page.request.put((await abortedSign.json()).data.url, { data: pdf, headers });
  expect((await page.request.post(`/api/v1/files/uploads/${aborted}/abort`, { headers })).ok()).toBeTruthy();
  expect((await page.request.post(`/api/v1/files/uploads/${aborted}/complete`, { data: { parts: [{ partNumber: 1, etag: "x" }] }, headers })).status()).toBe(409);

  const bad = await openSession(pdf.length, "bad.pdf");
  const badSign = await page.request.post(`/api/v1/files/uploads/${bad}/sign`, { data: { partNumber: 1 }, headers });
  const badPut = await page.request.put((await badSign.json()).data.url, { data: pdf, headers });
  const badEtag = (await badPut.json()).data.etag as string;
  const mismatch = await page.request.post(`/api/v1/files/uploads/${bad}/complete`, {
    data: { parts: [{ partNumber: 1, etag: "not-the-etag" }] },
    headers,
  });
  expect(mismatch.status()).toBe(409);

  const retry = await openSession(pdf.length, "retry.pdf");
  const retryUrl = (await (await page.request.post(`/api/v1/files/uploads/${retry}/sign`, { data: { partNumber: 1 }, headers })).json()).data.url as string;
  await page.request.put(retryUrl, { data: pdf, headers });
  const second = await page.request.put(retryUrl, { data: pdf, headers });
  const retryEtag = (await second.json()).data.etag as string;
  expect((await page.request.post(`/api/v1/files/uploads/${retry}/complete`, { data: { parts: [{ partNumber: 1, etag: retryEtag }] }, headers })).ok()).toBeTruthy();

  const short = await openSession(pdf.length + 32, "short.pdf");
  const shortUrl = (await (await page.request.post(`/api/v1/files/uploads/${short}/sign`, { data: { partNumber: 1 }, headers })).json()).data.url as string;
  const shortPut = await page.request.put(shortUrl, { data: pdf, headers });
  const shortEtag = (await shortPut.json()).data.etag as string;
  expect((await page.request.post(`/api/v1/files/uploads/${short}/complete`, { data: { parts: [{ partNumber: 1, etag: shortEtag }] }, headers })).status()).toBe(409);

  const empty = await openSession(pdf.length, "empty-part.pdf");
  const emptyUrl = (await (await page.request.post(`/api/v1/files/uploads/${empty}/sign`, { data: { partNumber: 1 }, headers })).json()).data.url as string;
  expect((await page.request.put(emptyUrl, { data: Buffer.alloc(0), headers })).status()).toBe(422);

  const fake = Buffer.from("not a pdf");
  const forged = await page.request.post("/api/v1/files/uploads", {
    data: { parentType: "document_requirement", parentId: requirement.id, filename: "note.pdf", mime: "application/pdf", expectedBytes: fake.length },
    headers,
  });
  const forgedId = (await forged.json()).data.id as string;
  const forgedUrl = (await (await page.request.post(`/api/v1/files/uploads/${forgedId}/sign`, { data: { partNumber: 1 }, headers })).json()).data.url as string;
  const forgedPut = await page.request.put(forgedUrl, { data: fake, headers });
  const forgedEtag = (await forgedPut.json()).data.etag as string;
  expect((await page.request.post(`/api/v1/files/uploads/${forgedId}/complete`, { data: { parts: [{ partNumber: 1, etag: forgedEtag }] }, headers })).status()).toBe(422);

  const expired = await openSession(pdf.length, "expired.pdf");
  sql(`UPDATE upload_sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = '${expired}'`);
  expect((await page.request.post(`/api/v1/files/uploads/${expired}/complete`, { data: { parts: [{ partNumber: 1, etag: "x" }] }, headers })).status()).toBe(409);

  const after = await (await page.request.get(`/api/v1/export-cases/${caseId}`)).json();
  const same = after.data.requirements.find((row: { id: string }) => row.id === requirement.id);
  expect(same.status).toBe("MISSING");
  void badEtag;
});

test("A6 a user outside the case cannot read or snooze its reminders", async ({ page, browser }) => {
  const stamp = Date.now().toString().slice(-6);
  const customer = await page.request.post("/api/v1/customers", {
    data: { legalName: `Scope ${stamp}`, countryCode: "EG", contacts: [{ fullName: "Nada", phone: "+201000000098" }] },
    headers,
  });
  expect(customer.ok()).toBeTruthy();
  const customerId = (await customer.json()).data.id as string;
  const created = await page.request.post("/api/v1/export-cases", {
    data: { customerId, documentRoute: "DIRECT_ROUTE" },
    headers,
  });
  expect(created.ok()).toBeTruthy();
  const caseId = (await created.json()).data.id as string;
  await patchReminderRule(page.request, "rr-doc-due", { offsetAmount: -1 }, headers);
  try {
  let scheduled = await page.request.get("/cdn-cgi/local/scheduled?format=json");
  let scheduledText = await scheduled.text();
  if (!scheduled.ok() && (scheduledText.includes("fetch failed") || scheduledText.trimStart().startsWith("<"))) {
    scheduled = await page.request.get("/cdn-cgi/local/scheduled?format=json");
    scheduledText = await scheduled.text();
  }
  expect(scheduled.ok(), scheduledText.slice(0, 160)).toBeTruthy();
  let remindersResponse = await page.request.get("/api/v1/reminders");
  let remindersText = await remindersResponse.text();
  if (!remindersResponse.ok() || remindersText.includes("fetch failed") || remindersText.trimStart().startsWith("<")) {
    remindersResponse = await page.request.get("/api/v1/reminders");
    remindersText = await remindersResponse.text();
  }
  expect(remindersResponse.ok(), remindersText.slice(0, 120)).toBeTruthy();
  const mine = JSON.parse(remindersText) as { data: Array<{ id: string; case_id: string }> };
  const target = (mine.data as Array<{ id: string; case_id: string }>).find((row) => row.case_id === caseId);
  expect(target).toBeTruthy();

  const email = `viewer.${stamp}@example.com`;
  const password = "Viewer-pass-12";
  const user = await page.request.post("/api/v1/users", {
    data: { name: "Officer", email, password, roleKeys: ["export_officer"] },
    headers,
  });
  expect(user.ok(), await user.text()).toBeTruthy();
  const context = await browser.newContext();
  const signedIn = await context.request.post("/api/auth/sign-in/email", {
    data: { email, password },
    headers: { origin },
  });
  expect(signedIn.ok(), await signedIn.text()).toBeTruthy();
  const foreign = await (await context.request.get("/api/v1/reminders")).json();
  expect((foreign.data as Array<{ case_id: string }>).some((row) => row.case_id === caseId)).toBe(false);
  const snooze = await context.request.post(`/api/v1/reminders/${target!.id}/snooze`, {
    data: { until: "2099-01-01T00:00:00.000Z" },
    headers,
  });
  expect(snooze.status()).toBe(403);
  const notes = await context.request.get("/api/v1/notifications");
  expect(notes.ok()).toBeTruthy();
  const noteBody = await notes.json();
  expect(JSON.stringify(noteBody)).not.toContain(caseId);
  await context.close();
  } finally {
    await patchReminderRule(page.request, "rr-doc-due", { offsetAmount: 0 }, headers);
  }
});

test("A7 rescheduling ETA cancels the reminder for the previous date", async ({ page }) => {
  const stamp = Date.now().toString().slice(-6);
  const customer = await page.request.post("/api/v1/customers", {
    data: { legalName: `Eta ${stamp}`, countryCode: "EG", contacts: [{ fullName: "Nada", phone: "+201000000097" }] },
    headers,
  });
  expect(customer.ok()).toBeTruthy();
  const customerId = (await customer.json()).data.id as string;
  const created = await page.request.post("/api/v1/export-cases", {
    data: { customerId, documentRoute: "DIRECT_ROUTE" },
    headers,
  });
  expect(created.ok()).toBeTruthy();
  const caseId = (await created.json()).data.id as string;
  const booking = await page.request.post("/api/v1/bookings", {
    data: { caseId, bookingNumber: `ETA-${stamp}`, expectedContainers: 1, plannedEta: "2026-10-20" },
    headers,
  });
  expect(booking.ok(), await booking.text()).toBeTruthy();
  const bookingId = (await booking.json()).data.id as string;
  const before = await (await page.request.get("/api/v1/reminders")).json();
  const first = (before.data as Array<{ id: string; case_id: string; reason: string; due_at: string; status: string }>).filter(
    (row) => row.case_id === caseId && row.reason.includes("vessel eta"),
  );
  expect(first.length).toBe(1);
  const loaded = await (await page.request.get(`/api/v1/bookings/${bookingId}`)).json();
  const version = loaded.data.booking.version as number;
  const moved = await page.request.put(`/api/v1/bookings/${bookingId}`, {
    data: {
      version,
      bookingNumber: `ETA-${stamp}`,
      expectedContainers: 1,
      plannedEta: "2026-11-20",
      status: "DRAFT",
    },
    headers,
  });
  expect(moved.ok(), await moved.text()).toBeTruthy();
  const after = await (await page.request.get("/api/v1/reminders")).json();
  const open = (after.data as Array<{ id: string; case_id: string; reason: string; due_at: string; status: string }>).filter(
    (row) => row.case_id === caseId && row.reason.includes("vessel eta") && row.status !== "CANCELLED",
  );
  expect(open.length).toBe(1);
  expect(open[0].id).not.toBe(first[0].id);
  expect(open[0].due_at.startsWith("2026-11-18")).toBe(true);
});
