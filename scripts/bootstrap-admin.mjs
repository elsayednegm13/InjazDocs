#!/usr/bin/env node
/**
 * One-time local admin bootstrap. Does not print or store the password.
 * Usage:
 *   BOOTSTRAP_SECRET=... ADMIN_EMAIL=... ADMIN_PASSWORD=... ADMIN_NAME=... \
 *   node scripts/bootstrap-admin.mjs
 */
const base = process.env.BETTER_AUTH_URL || "http://127.0.0.1:43173";
const secret = process.env.BOOTSTRAP_SECRET;
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME || "Administrator";

if (!secret || !email || !password) {
  console.error("Set BOOTSTRAP_SECRET, ADMIN_EMAIL, and ADMIN_PASSWORD in the environment.");
  process.exit(1);
}
if (password.length < 12) {
  console.error("ADMIN_PASSWORD must be at least 12 characters.");
  process.exit(1);
}

const res = await fetch(`${base}/api/v1/auth/bootstrap`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-bootstrap-secret": secret,
  },
  body: JSON.stringify({ email, password, name }),
});
const body = await res.json();
if (!res.ok) {
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}
console.log("Administrator created. Sign in and change the password immediately.");
console.log(`userId=${body.data?.userId ?? "?"}`);
