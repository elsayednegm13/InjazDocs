import { readFileSync, writeFileSync } from "node:fs";

const base = "http://127.0.0.1:43178";
const admin = JSON.parse(readFileSync(".wrangler-0654-race/admin.json", "utf8"));

function cookieHeader(response) {
  const lines = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  return lines.map((line) => line.split(";")[0]).join("; ");
}

async function signIn() {
  const response = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email: admin.email, password: admin.password }),
  });
  if (response.status !== 200) throw new Error(`signin ${response.status}`);
  return cookieHeader(response);
}

async function rule(cookie) {
  const response = await fetch(`${base}/api/v1/reminder-rules`, { headers: { origin: base, cookie } });
  const payload = await response.json();
  return payload.data.find((row) => row.id === "rr-courier");
}

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

async function patch(cookie, fault, offset, snapshot) {
  const response = await fetch(`${base}/api/v1/reminder-rules/rr-courier`, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: base, cookie, "x-exportflow-fault": fault },
    body: JSON.stringify({ offsetAmount: offset, expected: snapshot }),
  });
  const text = await response.text();
  let code = "";
  try {
    code = JSON.parse(text).error?.code ?? "";
  } catch {
    code = text.includes("fetch failed") ? "FETCH_FAILED_HTML" : "UNPARSED";
  }
  return { status: response.status, code, html: text.trimStart().startsWith("<") };
}

const boot = await fetch(`${base}/api/v1/auth/bootstrap`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: base, "x-bootstrap-secret": admin.bootstrapSecret },
  body: JSON.stringify({ email: admin.email, password: admin.password, name: "Fault Admin" }),
});
if (!boot.ok) throw new Error(`bootstrap ${boot.status}`);
const cookie = await signIn();
const report = [];

let current = await rule(cookie);
const beforeFault = await patch(cookie, "reminder-before-batch", Number(current.offset_amount) + 1, expectedFrom(current));
const afterBefore = await rule(cookie);
report.push({
  boundary: "before-batch",
  http: beforeFault.status,
  code: beforeFault.code,
  html: beforeFault.html,
  offsetBefore: current.offset_amount,
  offsetAfter: afterBefore.offset_amount,
  unchanged: afterBefore.offset_amount === current.offset_amount,
});

current = afterBefore;
const poison = await patch(cookie, "reminder-batch-poison", Number(current.offset_amount) + 1, expectedFrom(current));
const afterPoison = await rule(cookie);
report.push({
  boundary: "batch-poison",
  http: poison.status,
  code: poison.code,
  html: poison.html,
  offsetBefore: current.offset_amount,
  offsetAfter: afterPoison.offset_amount,
  unchanged: afterPoison.offset_amount === current.offset_amount,
});

current = afterPoison;
const lost = await patch(cookie, "reminder-after-commit", Number(current.offset_amount) + 1, expectedFrom(current));
const afterLost = await rule(cookie);
report.push({
  boundary: "after-commit",
  http: lost.status,
  code: lost.code,
  html: lost.html,
  offsetBefore: current.offset_amount,
  offsetAfter: afterLost.offset_amount,
  committed: Number(afterLost.offset_amount) === Number(current.offset_amount) + 1,
  retried: false,
});

async function probe(size, poisonFlag) {
  const response = await fetch(`${base}/api/v1/__test/d1-batch-probe`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, "x-exportflow-fault": "d1-batch-probe" },
    body: JSON.stringify({ size, poison: poisonFlag }),
  });
  const text = await response.text();
  return { status: response.status, body: text.slice(0, 240), html: text.trimStart().startsWith("<") };
}
report.push({ boundary: "statements-2000", ...(await probe(2000, false)) });
report.push({ boundary: "statements-2001", ...(await probe(2001, false)) });
report.push({ boundary: "statements-1999", ...(await probe(1999, false)) });
report.push({ boundary: "poison-80", ...(await probe(80, true)) });

const outside = await fetch(`${base}/api/v1/__test/d1-batch-probe`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ size: 1 }),
});
report.push({ boundary: "probe-without-header", status: outside.status });

writeFileSync("docs/performance/checkpoint-06-5-4/faults.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
