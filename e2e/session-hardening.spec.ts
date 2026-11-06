import { expect, test } from "@playwright/test";

const headers = { origin: "http://127.0.0.1:43174" };

test("a temporary password gates the API and a password change revokes older sessions", async ({ page, browser }) => {
  const stamp = Date.now().toString().slice(-6);
  const email = `temp.${stamp}@example.com`;
  const initial = "Temp-pass-1234";
  const next = "Temp-pass-5678";
  const created = await page.request.post("/api/v1/users", {
    data: { name: "Temporary User", email, password: initial, roleKeys: ["export_officer"] },
    headers,
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const userId = (await created.json()).data.id as string;

  const first = await browser.newContext();
  const second = await browser.newContext();
  const firstSignIn = await first.request.post("/api/auth/sign-in/email", {
    data: { email, password: initial },
    headers,
  });
  expect(firstSignIn.ok(), await firstSignIn.text()).toBeTruthy();
  const secondSignIn = await second.request.post("/api/auth/sign-in/email", {
    data: { email, password: initial },
    headers,
  });
  expect(secondSignIn.ok(), await secondSignIn.text()).toBeTruthy();

  const blocked = await first.request.get("/api/v1/customers", { headers });
  expect(blocked.status()).toBe(403);
  const blockedBody = await blocked.json();
  expect(blockedBody.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
  expect(JSON.stringify(blockedBody)).not.toContain("SQLITE");

  // /me stays available so the change-password screen can identify the user.
  const me = await first.request.get("/api/v1/me", { headers });
  expect(me.ok()).toBeTruthy();
  expect((await me.json()).data.mustChangePassword).toBe(true);

  const changed = await first.request.post("/api/v1/me/password", {
    data: { currentPassword: initial, newPassword: next },
    headers,
  });
  expect(changed.ok(), await changed.text()).toBeTruthy();

  const allowed = await first.request.get("/api/v1/customers", { headers });
  expect(allowed.ok(), await allowed.text()).toBeTruthy();

  // The second session was established before the password changed and must
  // no longer authenticate.
  const revoked = await second.request.get("/api/v1/customers", { headers });
  expect(revoked.status()).toBe(401);

  const oldPassword = await browser.newContext();
  const oldSignIn = await oldPassword.request.post("/api/auth/sign-in/email", {
    data: { email, password: initial },
    headers,
  });
  expect(oldSignIn.ok()).toBeFalsy();

  const newPassword = await browser.newContext();
  const newSignIn = await newPassword.request.post("/api/auth/sign-in/email", {
    data: { email, password: next },
    headers,
  });
  expect(newSignIn.ok(), await newSignIn.text()).toBeTruthy();
  const after = await (await newPassword.request.get("/api/v1/me", { headers })).json();
  expect(after.data.mustChangePassword).toBe(false);

  await page.request.post(`/api/v1/users/${userId}/active`, { data: { active: false }, headers });
  await Promise.all([first.close(), second.close(), oldPassword.close(), newPassword.close()]);
});
