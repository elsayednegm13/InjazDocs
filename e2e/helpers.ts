import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";
import { assertIsolatedPersist } from "../scripts/isolation-guard.mjs";

export type IsolatedPersistOptions = { root?: string; requireRunMarker?: boolean };

export { assertIsolatedPersist };

/**
 * E2E run root binding.
 *
 * Every E2E path consumer (runStamp, adminCreds, setup storageState) must be
 * bound to the same newly created, uniquely owned disposable root supplied via
 * EXPORTFLOW_E2E_ROOT. Falling back to the historical .wrangler-e2e root is a
 * hard isolation violation and must fail closed.
 */
export function e2eRunRoot(): string {
  const root = process.cwd();
  const explicit = process.env.EXPORTFLOW_E2E_ROOT;
  if (!explicit || !String(explicit).trim()) {
    throw new Error(
      "EXPORTFLOW_E2E_ROOT_REQUIRED: E2E paths must be bound to a run-owned disposable root",
    );
  }
  return assertIsolatedPersist(explicit, { root, requireRunMarker: true } as IsolatedPersistOptions);
}

/**
 * W1-G0 GAP-14: the SQL helpers must target the same generated, run-owned
 * Worker config as the Vite plugin. Without an explicit --config, wrangler
 * resolves the project config and may read the real project .dev.vars.
 */
function wranglerConfigPath(): string {
  const config = process.env.EXPORTFLOW_E2E_WRANGLER_CONFIG_PATH;
  if (!config || !String(config).trim()) {
    throw new Error(
      "EXPORTFLOW_E2E_WRANGLER_CONFIG_REQUIRED: E2E SQL helpers must use the generated run-owned Worker config",
    );
  }
  return assertIsolatedPersist(config, { root: process.cwd(), requireRunMarker: true } as IsolatedPersistOptions);
}

const WRANGLER_ENV_ALLOWLIST = [
  "PATH",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "OS",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
];

function wranglerEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of WRANGLER_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env.CI = "1";
  env.WRANGLER_SEND_METRICS = "false";
  env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";
  return env;
}

export function wranglerSql(persistTo: string, command: string) {
  assertIsolatedPersist(persistTo);
  return execFileSync(
    process.execPath,
    [
      path.join("node_modules", "wrangler", "bin", "wrangler.js"),
      "d1",
      "execute",
      "exportflow-local",
      "--local",
      "--persist-to",
      persistTo,
      "--config",
      wranglerConfigPath(),
      "--command",
      command,
    ],
    { encoding: "utf8", env: wranglerEnv() },
  );
}

export function wranglerRows<T>(persistTo: string, command: string): T[] {
  assertIsolatedPersist(persistTo);
  const output = execFileSync(
    process.execPath,
    [
      path.join("node_modules", "wrangler", "bin", "wrangler.js"),
      "d1",
      "execute",
      "exportflow-local",
      "--local",
      "--persist-to",
      persistTo,
      "--config",
      wranglerConfigPath(),
      "--json",
      "--command",
      command,
    ],
    { encoding: "utf8", env: wranglerEnv() },
  );
  const parsed = JSON.parse(output) as Array<{ results?: T[] }>;
  return parsed[0]?.results ?? [];
}

export type E2EAdmin = {
  email: string;
  password: string;
  bootstrapSecret: string;
  base: string;
};

export function runStamp(): string {
  const runRoot = e2eRunRoot();
  const file = path.join(runRoot, "stamp.txt");
  if (!existsSync(file)) writeFileSync(file, Date.now().toString().slice(-6));
  return readFileSync(file, "utf8").trim();
}

export function adminCreds(): E2EAdmin {
  const runRoot = e2eRunRoot();
  return JSON.parse(readFileSync(path.join(runRoot, "admin.json"), "utf8")) as E2EAdmin;
}

/** Removes Vite's dev overlay when Miniflare dispatchFetch blips. Does not hide HTTP 4xx. */
export async function clearViteOverlay(page: Page) {
  const overlay = page.locator("vite-error-overlay");
  if ((await overlay.count()) === 0) return;
  await page.evaluate(() => {
    document.querySelectorAll("vite-error-overlay").forEach((node) => node.remove());
  });
}

export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await clearViteOverlay(page);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await clearViteOverlay(page);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|change-password)/);
  if (page.url().includes("change-password")) {
    await page.locator('input[name="currentPassword"]').fill(password);
    await page.locator('input[name="newPassword"]').fill(password);
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL("**/dashboard");
  }
}

/**
 * API sign-in for a user provisioned with a temporary password. The business
 * API refuses every route except /me and /me/password until the change is done.
 */
export async function signInWithTemporaryPassword(
  request: APIRequestContext,
  email: string,
  password: string,
  newPassword = password,
) {
  const headers = { origin: "http://127.0.0.1:43174" };
  const signedIn = await request.post("/api/auth/sign-in/email", {
    data: { email, password },
    headers,
  });
  if (!signedIn.ok()) return signedIn;
  const changed = await request.post("/api/v1/me/password", {
    data: { currentPassword: password, newPassword },
    headers,
  });
  if (!changed.ok()) {
    throw new Error(`Temporary password change failed ${changed.status()} ${await changed.text()}`);
  }
  return signedIn;
}

export async function createCustomer(page: Page, name: string, taxId: string) {
  await page.goto("/customers/new");
  await clearViteOverlay(page);
  const nameField = page.locator('input[name="legalName"]');
  if (!(await nameField.isVisible().catch(() => false)) && (await page.getByText("fetch failed").isVisible().catch(() => false))) {
    await page.reload();
    await clearViteOverlay(page);
  }
  await nameField.waitFor({ state: "visible" });
  await nameField.fill(name);
  await page.locator('input[name="countryCode"]').fill("EG");
  await page.locator('input[name="taxId"]').fill(taxId);
  await page.locator('input[name="contactName"]').fill("Mona Saleh");
  await page.locator('input[name="phone"]').fill("+20100000001");
  await page.locator('input[name="contactName2"]').fill("Hany Adel");
  await page.locator('input[name="phone2"]').fill("+20100000002");
  await page.locator('input[name="line1"]').fill("12 Corniche");
  await page.locator('input[name="city"]').fill("Alexandria");
  await page.locator('input[name="line1b"]').fill("5 Billing Street");
  await page.locator('input[name="cityb"]').fill("Cairo");
  await page.locator('input[name="bankName"]').fill("Bank of Alexandria");
  await page.locator('input[name="accountNumber"]').fill("123456789");
  await page.locator('input[name="iban"]').fill("EG123456789012345678901234");
  await page.getByRole("button", { name: "Save customer" }).click();
  await page.waitForURL("**/customers");
  const link = page.getByRole("link", { name });
  if (!(await link.isVisible().catch(() => false))) {
    await page.keyboard.press("Escape");
    await page.reload();
  }
  await link.click();
}

export async function createCase(
  page: Page,
  input: {
    customer: string;
    route: "DIRECT_ROUTE" | "BANK_ROUTE";
    invoice: string;
    incoterm: "FOB" | "CFR";
    goods: string;
    invoicedFreight: string;
    actualFreight: string;
    total: string;
  },
) {
  await page.goto("/export-cases/new");
  await page.locator('select[name="customerId"]').selectOption({ label: input.customer });
  await page.locator('select[name="documentRoute"]').selectOption(input.route);
  await page.locator('input[name="destinationCountry"]').fill("NL");
  await page.locator('input[name="invoiceNumber"]').fill(input.invoice);
  await page.locator('input[name="invoiceDate"]').fill("2026-10-12");
  await page.locator('select[name="incoterm"]').selectOption(input.incoterm);
  await page.locator('input[name="namedPlace"]').fill("Alexandria");
  await page.locator('input[name="currency"]').fill("USD");
  await page.locator('input[name="goodsValue"]').fill(input.goods);
  await page.locator('input[name="invoicedFreight"]').fill(input.invoicedFreight);
  await page.locator('input[name="actualFreightExpense"]').fill(input.actualFreight);
  await page.locator('input[name="invoiceTotal"]').fill(input.total);
  await page.locator('input[name="portOfLoading"]').fill("Alexandria");
  await page.locator('input[name="portOfDischarge"]').fill("Rotterdam");
  await page.locator('input[name="grossWeight"]').fill("12.5");
  await page.locator('input[name="netWeight"]').fill("11.2");
  await page.getByRole("button", { name: "Create draft case" }).click();
  await page.waitForURL(/\/export-cases\/[0-9a-f-]+$/);
}

export async function caseIdFromUrl(page: Page) {
  const match = page.url().match(/export-cases\/([0-9a-f-]+)/);
  if (!match) throw new Error(`No case id in ${page.url()}`);
  return match[1];
}

export async function caseReferenceFromPage(page: Page) {
  const heading = page.locator("h1").filter({ hasText: /^EF-\d{4}-\d+$/ });
  await heading.waitFor();
  return (await heading.innerText()).trim();
}

export function requirementCard(page: Page, requirementText: string) {
  return page.locator("div.rounded-xl").filter({ hasText: requirementText }).filter({ has: page.locator('input[type="file"]') }).first();
}

export async function uploadPdf(page: Page, requirementText: string, file = "e2e/fixtures/sample.pdf") {
  const card = requirementCard(page, requirementText);
  const complete = page.waitForResponse((response) => response.url().includes("/files/uploads/") && response.url().endsWith("/complete"));
  await card.locator('input[type="file"]').setInputFiles(file);
  const response = await complete;
  if (!response.ok()) throw new Error(`Upload failed ${response.status()} ${await response.text()}`);
  const payload = await response.json();
  // The card header badge and the version history both expose data-status.
  await card.locator('[data-status="UPLOADED"]').first().waitFor();
  return payload.data.objectKey as string;
}

export async function patchReminderRule(
  request: APIRequestContext,
  id: string,
  patch: Record<string, unknown>,
  headers: Record<string, string>,
) {
  const rules = await (await request.get("/api/v1/reminder-rules", { headers })).json();
  const row = (rules.data as Array<Record<string, unknown>>).find((item) => item.id === id);
  if (!row) throw new Error(`missing reminder rule ${id}`);
  return request.patch(`/api/v1/reminder-rules/${id}`, {
    headers,
    data: {
      ...patch,
      expected: {
        enabled: Number(row.enabled) === 1,
        offsetAmount: Number(row.offset_amount),
        offsetDirection: row.offset_direction,
        offsetUnit: row.offset_unit,
        repeatEveryDays: row.repeat_every_days == null ? null : Number(row.repeat_every_days),
        repeatCap: row.repeat_cap == null ? null : Number(row.repeat_cap),
      },
    },
  });
}

export async function api(
  request: APIRequestContext,
  path: string,
  init?: { method?: string; data?: unknown; timeout?: number },
) {
  return request.fetch(path, {
    method: init?.method ?? "GET",
    data: init?.data,
    headers: init?.data ? { origin: "http://127.0.0.1:43174" } : undefined,
    ...(init?.timeout ? { timeout: init.timeout } : {}),
  });
}
