import { createApp, type AppDependencies } from "../../../server/http/app";
import type { AuditDatabase } from "./db";
import { createFakeAuth, type AuthControl } from "./fake-auth";

export type TestHarness = ReturnType<typeof createTestHarness>;

const fakeDocuments = {
  async createMultipartUpload() {
    return { uploadId: "test-upload" };
  },
  resumeMultipartUpload() {
    return {
      async uploadPart() {
        return { etag: "test-etag" };
      },
      async complete() {
        return { etag: "test-etag" };
      },
      async abort() {
        return undefined;
      },
    };
  },
  async head() {
    return null;
  },
  async get() {
    return null;
  },
  async delete() {
    return undefined;
  },
};

export function createTestHarness(
  audit: AuditDatabase,
  control: AuthControl = {},
  dependencies: Omit<AppDependencies, "createAuth"> = {},
) {
  const app = createApp({
    createAuth: createFakeAuth(control) as unknown as AppDependencies["createAuth"],
    ...dependencies,
  });
  const base = "http://127.0.0.1:43199";
  const storedObjects = new Map<string, Uint8Array>();
  const documents = {
    ...fakeDocuments,
    async put(key: string, value: Uint8Array | ArrayBuffer) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      storedObjects.set(key, bytes);
      return { key };
    },
    async get(key: string) {
      const body = storedObjects.get(key);
      if (!body) return null;
      return {
        arrayBuffer: async () => {
          const copy = new Uint8Array(body.byteLength);
          copy.set(body);
          return copy.buffer;
        },
      };
    },
  };
  const env = {
    DB: audit.db,
    BETTER_AUTH_SECRET: "test-only-better-auth-secret-value",
    BETTER_AUTH_URL: base,
    BOOTSTRAP_SECRET: "test-only-bootstrap-secret",
    COMPANY_TIMEZONE: "Africa/Cairo",
    MAX_UPLOAD_BYTES: "419430400",
    UPLOAD_PART_SIZE_BYTES: "10485760",
    EXPORTFLOW_TEST_FAULTS: "1",
    DOCUMENTS: documents,
  } as unknown as Env;
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

  async function request(input: {
    method?: string;
    path: string;
    actor?: string | null;
    body?: unknown;
    headers?: Record<string, string>;
    /** Set when a test must prove a mutation is rejected without Origin. */
    omitOrigin?: boolean;
  }) {
    const headers = new Headers(input.headers ?? {});
    if (!input.omitOrigin && !headers.has("origin")) headers.set("origin", base);
    if (input.actor !== null) headers.set("x-test-actor", input.actor ?? "user-admin");
    if (input.body !== undefined) headers.set("content-type", "application/json");
    const response = await app.fetch(
      new Request(`${base}${input.path}`, {
        method: input.method ?? "GET",
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
      }),
      env,
      ctx,
    );
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    const decoded = new TextDecoder().decode(bytes);
    const text = hasBom && !decoded.startsWith("\uFEFF") ? `\uFEFF${decoded}` : decoded;
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, headers: response.headers, text, json };
  }

  return { app, env, request };
}
