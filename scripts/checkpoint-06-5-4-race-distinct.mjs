import { readFileSync, writeFileSync } from "node:fs";

const base = "http://127.0.0.1:43178";
const admin = JSON.parse(readFileSync(".wrangler-0654-race/admin.json", "utf8"));

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
  return cookieHeader(response);
}

async function send(cookie, path, body) {
  const started = Date.now();
  const response = await fetch(`${base}${path}`, {
    method: body ? "PATCH" : "GET",
    headers: { "content-type": "application/json", origin: base, cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let code = "";
  try {
    code = JSON.parse(text).error?.code ?? "";
  } catch {
    code = text.includes("fetch failed") ? "FETCH_FAILED_HTML" : "";
  }
  return { status: response.status, ms: Date.now() - started, code, html: text.trimStart().startsWith("<"), text };
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

const cookieA = await signIn(admin.email, admin.password);
const cookieB = await signIn("cp0654-admin-b@example.com", "Race-second-pass-12");
const rounds = [];
for (const pair of [[6, 7], [8, 11]]) {
  const listed = JSON.parse((await send(cookieA, "/api/v1/reminder-rules")).text);
  const before = listed.data.find((row) => row.id === "rr-courier");
  const snapshot = expectedFrom(before);
  const [a, b] = await Promise.all([
    send(cookieA, "/api/v1/reminder-rules/rr-courier", { offsetAmount: pair[0], expected: snapshot }),
    send(cookieB, "/api/v1/reminder-rules/rr-courier", { offsetAmount: pair[1], expected: snapshot }),
  ]);
  const afterListed = JSON.parse((await send(cookieA, "/api/v1/reminder-rules")).text);
  const after = afterListed.data.find((row) => row.id === "rr-courier");
  const winners = [a, b].filter((row) => row.status === 200).length;
  rounds.push({
    pair,
    beforeOffset: before.offset_amount,
    http: [a.status, b.status],
    codes: [a.code, b.code],
    html: [a.html, b.html],
    afterOffset: after.offset_amount,
    singleWinner: winners === 1 && pair.includes(Number(after.offset_amount)),
  });
}
writeFileSync("docs/performance/checkpoint-06-5-4/race-distinct.json", JSON.stringify({ rounds }, null, 2));
console.log(JSON.stringify({ rounds }, null, 2));
