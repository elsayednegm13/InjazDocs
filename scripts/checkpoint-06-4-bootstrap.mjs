import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { perfRoot } from "./checkpoint-06-4-guard.mjs";

const accounts = JSON.parse(readFileSync(path.join(perfRoot, "accounts.json"), "utf8"));
const base = accounts.base;

async function call(urlPath, init, attempts = 1) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(`${base}${urlPath}`, init);
    const text = await response.text();
    const reset = text.includes("fetch failed") || text.trimStart().startsWith("<!");
    if (reset && attempt + 1 < attempts) continue;
    if (reset) throw new Error(`${init?.method ?? "GET"} ${urlPath} transport ${response.status}`);
    const body = text ? JSON.parse(text) : null;
    last = { response, body, status: response.status };
    if (response.ok || response.status === 409) return last;
    throw new Error(`${urlPath} ${response.status} ${body?.error?.code ?? "error"}`);
  }
  return last;
}

await call("/api/v1/auth/bootstrap", {
  method: "POST",
  headers: { "content-type": "application/json", "x-bootstrap-secret": accounts.bootstrapSecret, origin: base },
  body: JSON.stringify({ email: accounts.email, password: accounts.password, name: "Perf Admin" }),
}, 2);
const signed = await call("/api/auth/sign-in/email", {
  method: "POST",
  headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ email: accounts.email, password: accounts.password }),
}, 3);
const cookie = signed.response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
await call("/api/v1/me/password", {
  method: "POST",
  headers: { "content-type": "application/json", origin: base, cookie },
  body: JSON.stringify({ currentPassword: accounts.password, newPassword: accounts.password }),
});
const officer = await call("/api/v1/users", {
  method: "POST",
  headers: { "content-type": "application/json", origin: base, cookie },
  body: JSON.stringify({
    email: accounts.officerEmail,
    password: accounts.officerPassword,
    name: "Perf Officer",
    roleKeys: ["export_officer"],
  }),
});
const me = await call("/api/v1/me", { headers: { cookie } });
writeFileSync(path.join(perfRoot, "actors.json"), JSON.stringify({
  adminId: me.body.data.id,
  officerId: officer.body.data.id,
}, null, 2));
console.log(JSON.stringify({ admin: true, officer: true }));
