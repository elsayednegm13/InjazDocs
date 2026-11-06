import { afterEach, describe, expect, it } from "vitest";
import { createTestHarness } from "./harness/app";
import { count, createAuditDatabase, setBootstrapAvailable, type AuditDatabase } from "./harness/db";

const openDatabases: AuditDatabase[] = [];

function fresh() {
  const audit = createAuditDatabase();
  openDatabases.push(audit);
  return audit;
}

afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.close();
});

const bootstrapSecret = "test-only-bootstrap-secret";
const strongPassword = "temporary-pass-123";

function bootstrapConsumed(audit: AuditDatabase) {
  const row = audit.sqlite
    .prepare("SELECT bootstrap_consumed FROM company_settings WHERE id = 'default'")
    .get() as { bootstrap_consumed: number };
  return Number(row.bootstrap_consumed);
}

function incidents(audit: AuditDatabase, operation: string) {
  return audit.sqlite
    .prepare("SELECT * FROM auth_compensation_incidents WHERE operation = ? ORDER BY created_at")
    .all(operation) as Record<string, unknown>[];
}

function faultyRoleInsert(audit: AuditDatabase): AuditDatabase {
  const proxy = new Proxy(audit.db, {
    get(target, property) {
      if (property === "prepare") {
        return (sql: string) => {
          const statement = target.prepare(sql);
          if (!sql.includes("INSERT INTO user_roles")) return statement;
          return {
            bind: () => {
              throw new Error("induced role assignment failure");
            },
          };
        };
      }
      return Reflect.get(target, property);
    },
  });
  return { ...audit, db: proxy as AuditDatabase["db"] };
}

function bootstrapBody(email: string) {
  return { email, password: strongPassword, name: "Bootstrap Admin" };
}

describe("D3 bootstrap and user creation compensation", () => {
  it("D3-01 invalid bootstrap input and an unknown role create no identity and consume nothing", async () => {
    const audit = fresh();
    setBootstrapAvailable(audit.sqlite);
    const harness = createTestHarness(audit);
    const invalidBootstrap = await harness.request({
      method: "POST",
      path: "/api/v1/auth/bootstrap",
      actor: null,
      headers: { "x-bootstrap-secret": bootstrapSecret },
      body: { email: "not-an-email", password: "short", name: "Bad" },
    });
    expect(invalidBootstrap.status).toBe(422);
    expect(bootstrapConsumed(audit)).toBe(0);
    expect(count(audit.sqlite, "user")).toBe(4);

    const invalidRole = await harness.request({
      method: "POST",
      path: "/api/v1/users",
      body: {
        email: "invalid-role@example.invalid",
        name: "Invalid Role",
        password: strongPassword,
        roleKeys: ["does_not_exist"],
      },
    });
    expect(invalidRole.status).toBe(422);
    expect(count(audit.sqlite, "user")).toBe(4);
    expect(count(audit.sqlite, "account")).toBe(0);
  });

  it("D3-02 a valid user is created with exactly one credential, one role and forced rotation", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const created = await harness.request({
      method: "POST",
      path: "/api/v1/users",
      body: {
        email: "new.officer@example.invalid",
        name: "New Officer",
        password: strongPassword,
        roleKeys: ["export_officer"],
      },
    });
    expect(created.status).toBe(201);
    const userId = (created.json as { data: { id: string } }).data.id;
    expect(count(audit.sqlite, "user")).toBe(5);
    expect(count(audit.sqlite, "account", "user_id = ?", userId)).toBe(1);
    expect(count(audit.sqlite, "user_roles", "user_id = ? AND role_id = 'role-officer'", userId)).toBe(1);
    const row = audit.sqlite
      .prepare("SELECT must_change_password, is_active FROM user WHERE id = ?")
      .get(userId) as { must_change_password: number; is_active: number };
    expect(Number(row.must_change_password)).toBe(1);
    expect(Number(row.is_active)).toBe(1);

    const blocked = await harness.request({
      method: "GET",
      path: "/api/v1/customers",
      actor: userId,
    });
    expect(blocked.status).toBe(403);
    expect((blocked.json as { error: { code: string } }).error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    audit.sqlite.prepare("UPDATE user SET must_change_password = 0 WHERE id = ?").run(userId);
    const allowed = await harness.request({ method: "GET", path: "/api/v1/customers", actor: userId });
    expect(allowed.status).toBe(200);
    const createdCustomer = await harness.request({
      method: "POST",
      path: "/api/v1/customers",
      actor: userId,
      body: { legalName: "D3-02 Officer Customer" },
    });
    expect(createdCustomer.status).toBe(201);
    expect(count(audit.sqlite, "customers")).toBe(2);
  });

  it("D3-03 a credential failure after identity creation removes the half-built account", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit, { failLinkAccount: true });
    const response = await harness.request({
      method: "POST",
      path: "/api/v1/users",
      body: {
        email: "failed.credential@example.invalid",
        name: "Failed Credential",
        password: strongPassword,
        roleKeys: ["export_officer"],
      },
    });
    expect(response.status).toBe(500);
    expect((response.json as { error: { code: string } }).error.code).toBe("SERVER_TEMPORARILY_UNAVAILABLE");
    expect(count(audit.sqlite, "user")).toBe(4);
    expect(count(audit.sqlite, "account")).toBe(0);
    expect(incidents(audit, "USER_CREATE")).toHaveLength(0);
  });

  it("D3-04 a role-assignment failure after identity creation removes the half-built account", async () => {
    const audit = fresh();
    const faulty = faultyRoleInsert(audit);
    const harness = createTestHarness(faulty);
    const response = await harness.request({
      method: "POST",
      path: "/api/v1/users",
      body: {
        email: "failed.role@example.invalid",
        name: "Failed Role",
        password: strongPassword,
        roleKeys: ["export_officer"],
      },
    });
    expect(response.status).toBe(500);
    expect(count(audit.sqlite, "user")).toBe(4);
    expect(count(audit.sqlite, "account")).toBe(0);
    expect(count(audit.sqlite, "user_roles", "user_id != 'user-admin' AND user_id != 'user-officer' AND user_id != 'user-viewer'")).toBe(0);
    expect(incidents(audit, "USER_CREATE")).toHaveLength(0);
  });

  it("D3-05 a compensation failure is recorded and returns an explicit recovery code, never success", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit, { failLinkAccount: true }, { failUserCompensation: true });
    const response = await harness.request({
      method: "POST",
      path: "/api/v1/users",
      body: {
        email: "residual.user@example.invalid",
        name: "Residual User",
        password: strongPassword,
        roleKeys: ["export_officer"],
      },
    });
    expect(response.status).toBe(500);
    const body = response.json as { error: { code: string; fieldErrors?: { reference?: string } } };
    expect(body.error.code).toBe("USER_RECOVERY_REQUIRED");
    expect(body.error.fieldErrors?.reference).toBeTruthy();
    expect(count(audit.sqlite, "user")).toBe(5);
    expect(count(audit.sqlite, "account")).toBe(0);
    const residual = audit.sqlite
      .prepare("SELECT id FROM user WHERE email = 'residual.user@example.invalid'")
      .get() as { id: string };
    expect(count(audit.sqlite, "user_roles", "user_id = ?", residual.id)).toBe(0);
    const recorded = incidents(audit, "USER_CREATE");
    expect(recorded).toHaveLength(1);
    expect(recorded[0].stage).toBe("INDUCED_COMPENSATION_FAILURE");
    expect(recorded[0].correlation_id).toBe(body.error.fieldErrors?.reference);
  });

  it("D3-06 two simultaneous bootstraps create one administrator and consume the secret once", async () => {
    const audit = fresh();
    setBootstrapAvailable(audit.sqlite);
    const harness = createTestHarness(audit);
    const responses = await Promise.all([
      harness.request({
        method: "POST",
        path: "/api/v1/auth/bootstrap",
        actor: null,
        headers: { "x-bootstrap-secret": bootstrapSecret },
        body: bootstrapBody("bootstrap.one@example.invalid"),
      }),
      harness.request({
        method: "POST",
        path: "/api/v1/auth/bootstrap",
        actor: null,
        headers: { "x-bootstrap-secret": bootstrapSecret },
        body: bootstrapBody("bootstrap.two@example.invalid"),
      }),
    ]);
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(bootstrapConsumed(audit)).toBe(1);
    expect(count(audit.sqlite, "user", "email LIKE 'bootstrap.%'")).toBe(1);
    expect(count(audit.sqlite, "user")).toBe(5);
  });

  it("D3-07 a validation failure leaves bootstrap available and writes no identity", async () => {
    const audit = fresh();
    setBootstrapAvailable(audit.sqlite);
    const harness = createTestHarness(audit);
    const response = await harness.request({
      method: "POST",
      path: "/api/v1/auth/bootstrap",
      actor: null,
      headers: { "x-bootstrap-secret": bootstrapSecret },
      body: { email: "bootstrap@example.invalid", password: "short", name: "Admin" },
    });
    expect(response.status).toBe(422);
    expect(bootstrapConsumed(audit)).toBe(0);
    expect(count(audit.sqlite, "user")).toBe(4);
  });

  it("D3-08 a bootstrap failure after consuming the secret re-arms it only after verified cleanup", async () => {
    const audit = fresh();
    setBootstrapAvailable(audit.sqlite);
    const failedHarness = createTestHarness(audit, { failLinkAccount: true });
    const failed = await failedHarness.request({
      method: "POST",
      path: "/api/v1/auth/bootstrap",
      actor: null,
      headers: { "x-bootstrap-secret": bootstrapSecret },
      body: bootstrapBody("bootstrap.failed@example.invalid"),
    });
    expect(failed.status).toBe(500);
    expect(bootstrapConsumed(audit)).toBe(0);
    expect(count(audit.sqlite, "user")).toBe(4);
    expect(incidents(audit, "BOOTSTRAP")).toHaveLength(0);

    const healthy = createTestHarness(audit);
    const retried = await healthy.request({
      method: "POST",
      path: "/api/v1/auth/bootstrap",
      actor: null,
      headers: { "x-bootstrap-secret": bootstrapSecret },
      body: bootstrapBody("bootstrap.retried@example.invalid"),
    });
    expect(retried.status).toBe(201);
    expect(bootstrapConsumed(audit)).toBe(1);
    expect(count(audit.sqlite, "user")).toBe(5);
    const created = audit.sqlite
      .prepare("SELECT id FROM user WHERE email = 'bootstrap.retried@example.invalid'")
      .get() as { id: string };
    expect(count(audit.sqlite, "user_roles", "user_id = ? AND role_id = 'role-admin'", created.id)).toBe(1);
  });

  it("D3-09 a failed bootstrap compensation leaves the secret consumed and blocks a second bootstrap", async () => {
    const audit = fresh();
    setBootstrapAvailable(audit.sqlite);
    const harness = createTestHarness(audit, { failLinkAccount: true }, { failBootstrapCompensation: true });
    const failed = await harness.request({
      method: "POST",
      path: "/api/v1/auth/bootstrap",
      actor: null,
      headers: { "x-bootstrap-secret": bootstrapSecret },
      body: bootstrapBody("bootstrap.residual@example.invalid"),
    });
    expect(failed.status).toBe(500);
    const body = failed.json as { error: { code: string; fieldErrors?: { reference?: string } } };
    expect(body.error.code).toBe("BOOTSTRAP_RECOVERY_REQUIRED");
    expect(body.error.fieldErrors?.reference).toBeTruthy();
    expect(bootstrapConsumed(audit)).toBe(1);
    expect(count(audit.sqlite, "user")).toBe(5);
    const residual = audit.sqlite
      .prepare("SELECT id FROM user WHERE email = 'bootstrap.residual@example.invalid'")
      .get() as { id: string };
    expect(count(audit.sqlite, "user_roles", "user_id = ?", residual.id)).toBe(0);
    const recorded = incidents(audit, "BOOTSTRAP");
    expect(recorded).toHaveLength(1);
    expect(recorded[0].stage).toBe("INDUCED_COMPENSATION_FAILURE");
    expect(recorded[0].correlation_id).toBe(body.error.fieldErrors?.reference);

    const second = await harness.request({
      method: "POST",
      path: "/api/v1/auth/bootstrap",
      actor: null,
      headers: { "x-bootstrap-secret": bootstrapSecret },
      body: bootstrapBody("bootstrap.second@example.invalid"),
    });
    expect(second.status).toBe(409);
    expect(count(audit.sqlite, "user", "email = 'bootstrap.second@example.invalid'")).toBe(0);
  });

  it("D3-10 a lost bootstrap response cannot be replayed into a second administrator", async () => {
    const audit = fresh();
    setBootstrapAvailable(audit.sqlite);
    const harness = createTestHarness(audit);
    const first = await harness.request({
      method: "POST",
      path: "/api/v1/auth/bootstrap",
      actor: null,
      headers: { "x-bootstrap-secret": bootstrapSecret },
      body: bootstrapBody("bootstrap.once@example.invalid"),
    });
    expect(first.status).toBe(201);
    const retry = await harness.request({
      method: "POST",
      path: "/api/v1/auth/bootstrap",
      actor: null,
      headers: { "x-bootstrap-secret": bootstrapSecret },
      body: bootstrapBody("bootstrap.once@example.invalid"),
    });
    expect(retry.status).toBe(409);
    expect(count(audit.sqlite, "user", "email = 'bootstrap.once@example.invalid'")).toBe(1);
    expect(count(audit.sqlite, "user_roles", "role_id = 'role-admin'")).toBe(2);
  });

  it("D3-11 the last root administrator cannot be demoted and the previous roles are restored", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const response = await harness.request({
      method: "POST",
      path: "/api/v1/users/user-admin/roles",
      body: { roleKeys: ["viewer"] },
    });
    expect(response.status).toBe(409);
    expect((response.json as { error: { code: string } }).error.code).toBe("LAST_ADMIN");
    expect(count(audit.sqlite, "user_roles", "user_id = 'user-admin' AND role_id = 'role-admin'")).toBe(1);
    expect(count(audit.sqlite, "user_roles", "user_id = 'user-admin' AND role_id = 'role-viewer'")).toBe(0);
  });

  it("D3-12 forced password rotation is enforced by the API, not only the screen", async () => {
    const audit = fresh();
    audit.sqlite.prepare("UPDATE user SET must_change_password = 1 WHERE id = 'user-admin'").run();
    const harness = createTestHarness(audit);
    const blocked = await harness.request({ method: "GET", path: "/api/v1/customers" });
    expect(blocked.status).toBe(403);
    expect((blocked.json as { error: { code: string } }).error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    const changed = await harness.request({
      method: "POST",
      path: "/api/v1/me/password",
      body: { currentPassword: "old-password", newPassword: "new-password-123" },
    });
    expect(changed.status).toBe(200);
    const row = audit.sqlite
      .prepare("SELECT must_change_password FROM user WHERE id = 'user-admin'")
      .get() as { must_change_password: number };
    expect(Number(row.must_change_password)).toBe(0);
    const allowed = await harness.request({ method: "GET", path: "/api/v1/customers" });
    expect(allowed.status).toBe(200);
  });

  it("D3-13 password change and recovery revoke the sessions they claim to revoke", async () => {
    const audit = fresh();
    const now = Date.now();
    const insertSession = audit.sqlite.prepare(
      `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id)
       VALUES (?, ?, ?, ?, ?, 'user-admin')`,
    );
    insertSession.run("test-session-user-admin", now + 86_400_000, "token-current", now, now);
    insertSession.run("other-session", now + 86_400_000, "token-other", now, now);
    const harness = createTestHarness(audit);
    const changed = await harness.request({
      method: "POST",
      path: "/api/v1/me/password",
      body: { currentPassword: "old-password", newPassword: "new-password-123" },
    });
    expect(changed.status).toBe(200);
    expect(count(audit.sqlite, "session", "user_id = 'user-admin'")).toBe(1);
    expect(count(audit.sqlite, "session", "user_id = 'user-admin' AND id = 'test-session-user-admin'")).toBe(1);
    expect(count(audit.sqlite, "session", "user_id = 'user-admin' AND id = 'other-session'")).toBe(0);

    insertSession.run("recovery-one", now + 86_400_000, "token-recovery-one", now, now);
    insertSession.run("recovery-two", now + 86_400_000, "token-recovery-two", now, now);
    const recovered = await harness.request({
      method: "POST",
      path: "/api/v1/auth/reset-password",
      actor: null,
      headers: { "x-bootstrap-secret": bootstrapSecret },
      body: { email: "admin@example.invalid", password: "recovered-pass-123" },
    });
    expect(recovered.status).toBe(200);
    expect(count(audit.sqlite, "session", "user_id = 'user-admin'")).toBe(0);
    const rotated = audit.sqlite
      .prepare("SELECT must_change_password, is_active FROM user WHERE id = 'user-admin'")
      .get() as { must_change_password: number; is_active: number };
    expect(Number(rotated.must_change_password)).toBe(1);
    expect(Number(rotated.is_active)).toBe(1);
    expect(count(audit.sqlite, "audit_log", "action = 'password.bootstrap_reset' AND entity_id = 'user-admin'")).toBe(1);

    const missing = await harness.request({
      method: "POST",
      path: "/api/v1/auth/reset-password",
      actor: null,
      headers: { "x-bootstrap-secret": bootstrapSecret },
      body: { email: "nobody@example.invalid", password: "recovered-pass-123" },
    });
    expect(missing.status).toBe(200);
    expect((missing.json as { data: { ok: boolean } }).data).toEqual({ ok: true });
    expect((missing.json as { error?: unknown }).error).toBeUndefined();
    expect(count(audit.sqlite, "audit_log", "action = 'password.bootstrap_reset'")).toBe(1);
  });

  it("D3-14 break-glass reset stays available and stops after five attempts in a minute", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await harness.request({
        method: "POST",
        path: "/api/v1/auth/reset-password",
        actor: null,
        headers: { "x-bootstrap-secret": bootstrapSecret },
        body: { email: "nobody@example.invalid", password: "recovered-pass-123" },
      });
      expect(response.status).toBe(200);
    }
    const limited = await harness.request({
      method: "POST",
      path: "/api/v1/auth/reset-password",
      actor: null,
      headers: { "x-bootstrap-secret": bootstrapSecret },
      body: { email: "nobody@example.invalid", password: "recovered-pass-123" },
    });
    expect(limited.status).toBe(429);
  });
});
