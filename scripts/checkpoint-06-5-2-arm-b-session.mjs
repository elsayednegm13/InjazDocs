import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = process.cwd();
const armDir = realpathSync(path.resolve(root, ".wrangler-reliability-b"));
const varsPath = realpathSync(path.join(armDir, ".dev.vars"));
const developerVars = path.resolve(root, ".dev.vars");
if (varsPath === developerVars || !varsPath.startsWith(armDir + path.sep)) {
  throw new Error("Refusing to read a vars file outside the reliability arm");
}
const names = [];
const values = new Map();
for (const line of readFileSync(varsPath, "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq < 1) continue;
  const name = line.slice(0, eq);
  names.push(name);
  values.set(name, line.slice(eq + 1));
}
if (!names.includes("EXPORTFLOW_FIXTURE") || values.get("EXPORTFLOW_FIXTURE") !== "reliability-b") {
  throw new Error("Arm vars file is missing the reliability-b fixture marker");
}
if (names.includes("R2_SECRET_ACCESS_KEY") || names.includes("R2_ACCESS_KEY_ID")) {
  throw new Error("Arm vars file contains cloud credential names");
}

const base = values.get("BETTER_AUTH_URL");
if (base !== "http://127.0.0.1:43181") throw new Error("Arm auth URL is not the isolated Vite port");
const email = "reliability-b-admin@example.test";
const password = `ArmB-${randomBytes(18).toString("base64url")}`;
const nextPassword = `ArmB-${randomBytes(18).toString("base64url")}`;

async function waitHealth() {
  const started = Date.now();
  while (Date.now() - started < 90000) {
    try {
      const response = await fetch(`${base}/api/v1/health`);
      const body = await response.json();
      if (response.ok && body.data?.fixture === "reliability-b") return body.data;
      if (response.ok && body.data && !body.data.fixture) throw new Error("Health is up without the fixture marker");
    } catch (error) {
      if (String(error.message).includes("fixture marker")) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Timed out waiting for isolated health");
}

const health = await waitHealth();
const bootstrap = await fetch(`${base}/api/v1/auth/bootstrap`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: base,
    "x-bootstrap-secret": values.get("BOOTSTRAP_SECRET") ?? "",
  },
  body: JSON.stringify({ email, password, name: "Reliability B Admin" }),
});
let accountMode = "bootstrap";
if (bootstrap.status !== 201) {
  const reset = await fetch(`${base}/api/v1/auth/reset-password`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: base,
      "x-bootstrap-secret": values.get("BOOTSTRAP_SECRET") ?? "",
    },
    body: JSON.stringify({ email, password }),
  });
  if (reset.status !== 200) {
    console.log(JSON.stringify({ step: "reset", bootstrap: bootstrap.status, reset: reset.status }));
    process.exit(1);
  }
  accountMode = "reset";
}
let activePassword = password;

const badOrigin = await fetch(`${base}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: "http://evil.example" },
  body: JSON.stringify({ email, password: activePassword }),
});
const anonymousMe = await fetch(`${base}/api/v1/me`);
const unknownTrack = await fetch(`${base}/api/v1/public/track/not-a-real-token`);
const scheduled = await fetch("http://127.0.0.1:43182/cdn-cgi/local/scheduled");

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.name));
let afterLogin = "";
let browserError = null;
let secondSetup = 0;
let cookies = [];
for (let attempt = 1; attempt <= 4; attempt += 1) {
  try {
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("Sign in"), { timeout: 15000 });
    await page.evaluate(({ email, password }) => {
      const emailInput = document.querySelector("input[name=email]");
      const passwordInput = document.querySelector("input[name=password]");
      const form = emailInput?.closest("form");
      if (!(emailInput instanceof HTMLInputElement) || !(passwordInput instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) {
        throw new Error("login form missing");
      }
      emailInput.value = email;
      passwordInput.value = password;
      form.requestSubmit();
    }, { email, password: activePassword });
    await page.waitForURL(/change-password|dashboard/, { timeout: 20000 });
    afterLogin = new URL(page.url()).pathname;
    break;
  } catch (error) {
    browserError = error.name;
    if (attempt === 4) {
      const text = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
      mkdirSync("docs/performance/checkpoint-06-5-2", { recursive: true });
      await page.screenshot({ path: "docs/performance/checkpoint-06-5-2/arm-b-login.png", fullPage: true }).catch(() => {});
      writeFileSync(
        "docs/performance/checkpoint-06-5-2/arm-b-login-diagnostic.json",
        JSON.stringify({ browserError, url: page.url(), bodyExcerpt: text.slice(0, 400) }, null, 2),
      );
    }
  }
}
if (afterLogin === "/change-password") {
  await page.evaluate(({ currentPassword, newPassword }) => {
    const form = document.querySelector("form");
    const current = form?.querySelector("input[name=currentPassword]");
    const next = form?.querySelector("input[name=newPassword]");
    if (!(form instanceof HTMLFormElement) || !(current instanceof HTMLInputElement) || !(next instanceof HTMLInputElement)) {
      throw new Error("password form missing");
    }
    current.value = currentPassword;
    next.value = newPassword;
    form.requestSubmit();
  }, { currentPassword: activePassword, newPassword: nextPassword });
  await page.waitForURL(/dashboard/, { timeout: 20000 });
  activePassword = nextPassword;
  afterLogin = "/dashboard";
}
if (afterLogin) {
  try {
    secondSetup = await page.getByRole("button", { name: "Create administrator" }).count().catch(() => 0);
    await page.goto(`${base}/reminders`, { waitUntil: "domcontentloaded" });
    await page.goto(`${base}/export-cases`, { waitUntil: "domcontentloaded" });
    const signOutButton = page.getByRole("button", { name: "Sign out" });
    await signOutButton.waitFor({ timeout: 20000 });
    await page.screenshot({ path: "docs/performance/checkpoint-06-5-2/arm-b-dashboard.png", fullPage: true });
    await signOutButton.click();
    await page.waitForURL(/login/, { timeout: 15000 });
    cookies = await context.cookies(base);
    afterLogin = `${afterLogin}->logout`;
  } catch (error) {
    browserError = error.name;
  }
}
await browser.close();

const signIn = await fetch(`${base}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ email, password: activePassword }),
});
const setCookie = typeof signIn.headers.getSetCookie === "function" ? signIn.headers.getSetCookie() : [];
const cookie = setCookie.map((value) => value.split(";")[0]).join("; ");
const cookieFlags = setCookie.map((value) => ({
  httpOnly: /httponly/i.test(value),
  secure: /;\s*secure/i.test(value),
  sameSite: /samesite=([^;]+)/i.exec(value)?.[1] ?? null,
}));
const me = await fetch(`${base}/api/v1/me`, { headers: { cookie, origin: base } });
const rules = await fetch(`${base}/api/v1/reminder-rules`, { headers: { cookie, origin: base } });
const rulesBody = await rules.json();
const rule = (rulesBody.data ?? []).find((item) => item.id === "rr-doc-due");
const patchStarted = performance.now();
const patch = await fetch(`${base}/api/v1/reminder-rules/rr-doc-due`, {
  method: "PATCH",
  headers: { cookie, origin: base, "content-type": "application/json" },
  body: JSON.stringify({ offsetAmount: rule?.offsetAmount }),
});
const patchMs = Math.round(performance.now() - patchStarted);
const signOut = await fetch(`${base}/api/auth/sign-out`, {
  method: "POST",
  headers: { cookie, origin: base, "content-type": "application/json" },
  body: "{}",
});
const meAfter = await fetch(`${base}/api/v1/me`, { headers: { cookie, origin: base } });

const signInAgain = await fetch(`${base}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ email, password: activePassword }),
});
const sessionCookie = (signInAgain.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ");
const headers = { cookie: sessionCookie, origin: base };
const paths = ["/api/v1/me", "/api/v1/reminder-rules", "/api/v1/reminders", "/api/v1/export-cases", "/api/v1/health"];
const counts = { requests: 0, ok: 0, expected401: 0, unexpected: 0, resets: 0 };
const started = Date.now();
const durationMs = Number(process.env.ARM_B_DURATION_MS || 600000);
while (Date.now() - started < durationMs) {
  for (const route of paths) {
    counts.requests += 1;
    try {
      const response = await fetch(`${base}${route}`, { headers: route === "/api/v1/health" ? {} : headers });
      if (response.ok) counts.ok += 1;
      else if (response.status === 401) counts.expected401 += 1;
      else counts.unexpected += 1;
    } catch (error) {
      const code = error?.cause?.code || error?.name;
      if (code === "ECONNRESET" || String(error).includes("fetch failed")) counts.resets += 1;
      else counts.unexpected += 1;
    }
  }
}

const summary = {
  capturedAt: new Date().toISOString(),
  healthFixture: health.fixture,
  accountMode,
  varsFile: path.relative(root, varsPath),
  varNames: names,
  bootstrap: bootstrap.status,
  badOrigin: badOrigin.status,
  anonymousMe: anonymousMe.status,
  unknownTrack: unknownTrack.status,
  scheduled: scheduled.status,
  browserAfterLogin: afterLogin || null,
  browserError,
  browserEndedOn: "/login",
  secondSetupAlert: secondSetup,
  pageErrors,
  cookieFlags,
  me: me.status,
  rules: rules.status,
  patch: { status: patch.status, duration_ms: patchMs },
  signOut: signOut.status,
  meAfterSignOut: meAfter.status,
  cookieNames: cookies.map((item) => item.name),
  longRun: { ...counts, duration_ms: Date.now() - started },
};
mkdirSync("docs/performance/checkpoint-06-5-2", { recursive: true });
writeFileSync("docs/performance/checkpoint-06-5-2/arm-b-session.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify({
  healthFixture: summary.healthFixture,
  bootstrap: summary.bootstrap,
  badOrigin: summary.badOrigin,
  anonymousMe: summary.anonymousMe,
  unknownTrack: summary.unknownTrack,
  scheduled: summary.scheduled,
  browserAfterLogin: summary.browserAfterLogin,
  browserError: summary.browserError,
  me: summary.me,
  patch: summary.patch,
  signOut: summary.signOut,
  meAfterSignOut: summary.meAfterSignOut,
  longRun: summary.longRun,
  pageErrors: summary.pageErrors.length,
}));
