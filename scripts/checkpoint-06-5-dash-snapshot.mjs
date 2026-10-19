import { readFileSync } from "node:fs";
import path from "node:path";
import { perfRoot } from "./checkpoint-06-4-guard.mjs";

const base = "http://127.0.0.1:43176";
const accounts = JSON.parse(readFileSync(path.join(perfRoot, "accounts.json"), "utf8"));
async function countsFor(email, password) {
  const response = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email, password }),
  });
  const text = await response.text();
  if (!response.ok || text.includes("fetch failed")) return { status: response.status, reset: text.includes("fetch failed") };
  const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const dash = await fetch(`${base}/api/v1/dashboard`, { headers: { cookie, origin: base } });
  const raw = await dash.text();
  if (!raw.startsWith("{")) return { status: dash.status, reset: true };
  const body = JSON.parse(raw);
  return { status: dash.status, counts: body.data?.counts ?? null, recent: body.data?.recent?.length ?? null };
}

console.log(JSON.stringify({
  admin: await countsFor(accounts.email, accounts.password),
  officer: await countsFor(accounts.officerEmail, accounts.officerPassword),
}));
