import { newId } from "../../../server/db/sql";

export type AuthControl = {
  failCreateUser?: boolean;
  failHash?: boolean;
  failLinkAccount?: boolean;
  failFindUser?: boolean;
  failChangePassword?: boolean;
  nextUserId?: string;
};

/**
 * Test-only Better Auth surface. It performs the same user/account row writes
 * the real adapter performs, so compensation can be counted, but it never
 * touches a real identity provider, password hash or session store.
 */
export function createFakeAuth(control: AuthControl = {}) {
  return (env: Env) => {
    const db = env.DB;
    return {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const userId = headers.get("x-test-actor");
          if (!userId || userId === "none") return null;
          return { user: { id: userId }, session: { id: `test-session-${userId}` } };
        },
        changePassword: async () => {
          if (control.failChangePassword) throw new Error("induced password change failure");
          return { ok: true };
        },
      },
      handler: async () => new Response("not found", { status: 404 }),
      $context: Promise.resolve({
        internalAdapter: {
          createUser: async (input: { email: string; name: string }) => {
            if (control.failCreateUser) throw new Error("induced createUser failure");
            const id = control.nextUserId ?? newId();
            const now = Date.now();
            await db
              .prepare(
                `INSERT INTO user (id, name, email, email_verified, created_at, updated_at, must_change_password, is_active)
                 VALUES (?, ?, ?, 1, ?, ?, 0, 1)`,
              )
              .bind(id, input.name, input.email, now, now)
              .run();
            return { id, email: input.email, name: input.name };
          },
          linkAccount: async (input: { userId: string; providerId: string; accountId: string; password: string }) => {
            if (control.failLinkAccount) throw new Error("induced linkAccount failure");
            const now = Date.now();
            await db
              .prepare(
                `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
              )
              .bind(newId(), input.accountId, input.providerId, input.userId, input.password, now, now)
              .run();
          },
          findUserByEmail: async (email: string) => {
            if (control.failFindUser) throw new Error("induced findUser failure");
            const row = await db.prepare("SELECT id, email FROM user WHERE lower(email) = ?").bind(email.toLowerCase()).first<{ id: string; email: string }>();
            return row ? { user: row } : null;
          },
          updatePassword: async (userId: string, password: string) => {
            await db.prepare("UPDATE account SET password = ? WHERE user_id = ?").bind(password, userId).run();
          },
        },
        password: {
          hash: async () => {
            if (control.failHash) throw new Error("induced password hash failure");
            return "test-only-hash";
          },
        },
      }),
    };
  };
}
