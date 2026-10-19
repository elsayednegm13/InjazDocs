import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/d1";
import { authSchema } from "./db/auth-schema";

export function createAuth(env: Env) {
  const db = drizzle(env.DB);
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL || "http://127.0.0.1:43173",
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: authSchema,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
    },
    user: {
      additionalFields: {
        mustChangePassword: { type: "boolean", defaultValue: false, input: false },
        isActive: { type: "boolean", defaultValue: true, input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 60,
    },
    trustedOrigins: [env.BETTER_AUTH_URL || "http://127.0.0.1:43173"],
    disabledPaths: ["/sign-up/email", "/sign-up/social"],
    advanced: {
      ipAddress: {
        ipAddressHeaders: env.TRUST_CF_CONNECTING_IP === "1" ? ["cf-connecting-ip"] : [],
      },
      useSecureCookies: env.BETTER_AUTH_URL?.startsWith("https://") ?? false,
      defaultCookieAttributes: {
        sameSite: "lax",
        httpOnly: true,
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 300,
      customRules: {
        "/sign-in/email": { window: 60, max: 30 },
      },
    },
  });
}

export type AuthInstance = ReturnType<typeof createAuth>;
