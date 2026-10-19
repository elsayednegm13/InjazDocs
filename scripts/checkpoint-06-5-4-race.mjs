import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const base = "http://127.0.0.1:43178";
const admin = JSON.parse(readFileSync(".wrangler-0654-race/admin.json", "utf8"));
const outDir = "docs/performance/checkpoint-06-5-4";
mkdirSync(outDir, { recursive: true });

function cookieHeader(response) {
  const lines = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  return lines.map((line) => line.split(";")[0]).join("; ");
}

async function signIn(email, password) {
  const response = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email, password }),
  });
  return { status: response.status, cookie: cookieHeader(response) };
}

async function send(cookie, method, path, body) {
  const started = Date.now();
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", origin: base, cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    return { status: 0, ms: Date.now() - started, code: error instanceof Error ? error.name : "error", text: "" };
  }
  const text = await response.text();
  let code = "";
  try {
    code = JSON.parse(text).error?.code ?? "";
  } catch {
    code = text.includes("fetch failed") ? "FETCH_FAILED_HTML" : "";
  }
  return { status: response.status, ms: Date.now() - started, code, html: text.trimStart().startsWith("<"), text: text.slice(0, 180) };
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

const report = { races: [], controls: [], transport: {} };
const health = await fetch(`${base}/api/v1/health`);
if (!health.ok) throw new Error(`health ${health.status}`);
const boot = await fetch(`${base}/api/v1/auth/bootstrap`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: base, "x-bootstrap-secret": admin.bootstrapSecret },
  body: JSON.stringify({ email: admin.email, password: admin.password, name: "Race Admin" }),
});
const bootText = await boot.text();
if (!boot.ok) throw new Error(`bootstrap ${boot.status} ${bootText.slice(0, 120)}`);
const first = await signIn(admin.email, admin.password);
if (first.status !== 200 || !first.cookie) throw new Error(`signin ${first.status}`);
const secondPassword = "Race-second-pass-12";
const created = await send(first.cookie, "POST", "/api/v1/users", {
  name: "Second Admin",
  email: "cp0654-admin-b@example.com",
  password: secondPassword,
  roleKeys: ["administrator"],
});
report.controls.push({ step: "create-second-admin", status: created.status, code: created.code });
const second = await signIn("cp0654-admin-b@example.com", secondPassword);
report.controls.push({ step: "second-signin", status: second.status, cookie: Boolean(second.cookie) });
const actorB = second.status === 200 && second.cookie ? second.cookie : first.cookie;

async function loadRule(cookie, id) {
  const response = await fetch(`${base}/api/v1/reminder-rules`, { headers: { origin: base, cookie } });
  const payload = await response.json();
  return payload.data.find((row) => row.id === id);
}

for (let round = 1; round <= 2; round += 1) {
  const before = await loadRule(first.cookie, "rr-courier");
  const snapshot = expectedFrom(before);
  const [a, b] = await Promise.all([
    send(first.cookie, "PATCH", "/api/v1/reminder-rules/rr-courier", { offsetAmount: 5, expected: snapshot }),
    send(actorB, "PATCH", "/api/v1/reminder-rules/rr-courier", { offsetAmount: 9, expected: snapshot }),
  ]);
  const after = await loadRule(first.cookie, "rr-courier");
  report.races.push({
    round,
    rule: "rr-courier",
    beforeOffset: before.offset_amount,
    http: [a.status, b.status],
    codes: [a.code, b.code],
    html: [a.html, b.html],
    afterOffset: after.offset_amount,
    lost: ![5, 9].includes(Number(after.offset_amount)) || (a.status === 200 && b.status === 200),
  });
}

const staleBase = await loadRule(first.cookie, "rr-courier");
const missing = await send(first.cookie, "PATCH", "/api/v1/reminder-rules/rr-courier", { offsetAmount: 4 });
const afterMissing = await loadRule(first.cookie, "rr-courier");
const stale = await send(first.cookie, "PATCH", "/api/v1/reminder-rules/rr-courier", {
  offsetAmount: 3,
  expected: { ...expectedFrom(staleBase), offsetAmount: staleBase.offset_amount === 5 ? 9 : 5 },
});
const afterStale = await loadRule(first.cookie, "rr-courier");
report.controls.push({
  step: "missing-expected",
  status: missing.status,
  code: missing.code,
  offsetUnchanged: afterMissing.offset_amount === staleBase.offset_amount,
});
report.controls.push({
  step: "stale-expected",
  status: stale.status,
  code: stale.code,
  offsetUnchanged: afterStale.offset_amount === afterMissing.offset_amount,
});

const courier = await loadRule(first.cookie, "rr-courier");
const load = await loadRule(first.cookie, "rr-load");
const [courierWrite, loadWrite] = await Promise.all([
  send(first.cookie, "PATCH", "/api/v1/reminder-rules/rr-courier", { offsetAmount: Number(courier.offset_amount), expected: expectedFrom(courier) }),
  send(actorB, "PATCH", "/api/v1/reminder-rules/rr-load", { offsetAmount: Number(load.offset_amount) === 2 ? 4 : 2, expected: expectedFrom(load) }),
]);
const courierAfter = await loadRule(first.cookie, "rr-courier");
const loadAfter = await loadRule(first.cookie, "rr-load");
report.controls.push({
  step: "two-rules",
  http: [courierWrite.status, loadWrite.status],
  courierOffset: courierAfter.offset_amount,
  loadOffset: loadAfter.offset_amount,
});

const posts = [];
for (let i = 0; i < 20; i += 1) posts.push(await send("", "POST", "/api/v1/__test/d1-batch-probe", { size: 1 }));
const parallel = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(() => send("", "POST", "/api/v1/__test/d1-batch-probe", { size: 1 })));
const gets = [];
for (let i = 0; i < 16; i += 1) gets.push(await send("", "GET", "/api/v1/health"));
report.transport = {
  serialPost: { n: posts.length, bad: posts.filter((row) => row.status === 0 || row.html || row.code === "FETCH_FAILED_HTML").length, statuses: posts.map((row) => row.status) },
  parallelPost: { n: parallel.length, bad: parallel.filter((row) => row.status === 0 || row.html).length, statuses: parallel.map((row) => row.status), ms: parallel.map((row) => row.ms) },
  serialGet: { n: gets.length, bad: gets.filter((row) => row.status !== 200).length, ms: gets.map((row) => row.ms) },
};
writeFileSync(`${outDir}/race-and-transport.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
