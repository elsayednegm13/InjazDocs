import { readFileSync, writeFileSync } from "node:fs";

const base = "http://127.0.0.1:43178";
const admin = JSON.parse(readFileSync(".wrangler-0654-race/admin.json", "utf8"));

function cookieHeader(response) {
  const lines = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  return lines.map((line) => line.split(";")[0]).join("; ");
}

async function send(cookie, method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", origin: base, cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, html: text.includes("fetch failed") };
}

const sign = await fetch(`${base}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ email: admin.email, password: admin.password }),
});
const cookie = cookieHeader(sign);
const customer = await send(cookie, "POST", "/api/v1/customers", {
  legalName: "Family Fixture",
  countryCode: "EG",
  contacts: [{ fullName: "Nada", phone: "+201000000077" }],
});
const customerId = customer.json?.data?.id;
const created = await send(cookie, "POST", "/api/v1/export-cases", { customerId, documentRoute: "DIRECT_ROUTE" });
const caseId = created.json?.data?.id;
const booking = await send(cookie, "POST", "/api/v1/bookings", {
  caseId,
  bookingNumber: "BK-0654-1",
  expectedContainers: 1,
  plannedLoadingDate: "2026-10-20",
  cutoffDate: "2026-10-18",
  plannedEtd: "2026-10-21",
  plannedEta: "2026-11-02",
});
const bookingId = booking.json?.data?.id;
const rulesResponse = await send(cookie, "GET", "/api/v1/reminder-rules");
const rules = rulesResponse.json.data;

function expectedFrom(row) {
  return {
    enabled: Number(row.enabled) === 1,
    offsetAmount: Number(row.offset_amount),
    offsetDirection: row.offset_direction,
    offsetUnit: row.offset_unit,
    repeatEveryDays: row.repeat_every_days == null ? null : Number(row.repeat_every_days),
    repeatCap: row.repeat_cap == null ? null : Number(row.repeat_cap),
  };
}

async function touch(id) {
  const row = rules.find((item) => item.id === id);
  return send(cookie, "PATCH", `/api/v1/reminder-rules/${id}`, {
    offsetAmount: Number(row.offset_amount),
    expected: expectedFrom(row),
  });
}

const touched = {};
for (const id of ["rr-load", "rr-cutoff", "rr-eta", "rr-goods", "rr-bank"]) {
  const result = await touch(id);
  touched[id] = { status: result.status, html: result.html };
}
const beforeGoods = await send(cookie, "GET", "/api/v1/reminders?filter=open");
const goodsBefore = (beforeGoods.json?.data ?? []).filter((row) => row.rule_id === "rr-goods").length;
const updated = await send(cookie, "PUT", `/api/v1/bookings/${bookingId}`, {
  version: 1,
  bookingNumber: "BK-0654-1",
  expectedContainers: 1,
  plannedLoadingDate: "2026-10-20",
  cutoffDate: "2026-10-18",
  plannedEtd: "2026-10-21",
  plannedEta: "2026-11-02",
  actualEta: "2026-11-03",
});
const goodsPatch = await touch("rr-goods");
const after = await send(cookie, "GET", "/api/v1/reminders?filter=open");
const rows = after.json?.data ?? [];
const byRule = {};
for (const row of rows) byRule[row.rule_id] = (byRule[row.rule_id] ?? 0) + 1;
const directBank = rows.filter((row) => row.rule_id === "rr-bank" && row.case_id === caseId).length;
const started = Date.now();
const cron = await fetch(`${base}/cdn-cgi/local/scheduled`, { signal: AbortSignal.timeout(60000) });
const report = {
  customer: customer.status,
  case: created.status,
  booking: booking.status,
  bookingUpdate: updated.status,
  touched,
  goodsBefore,
  goodsPatch: goodsPatch.status,
  openByRule: byRule,
  directCaseBankReminders: directBank,
  cron: { status: cron.status, ms: Date.now() - started },
};
writeFileSync("docs/performance/checkpoint-06-5-4/families.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
