export type ApiSuccess<T> = { data: T; meta: { requestId: string; page?: number; pageSize?: number; total?: number } };
export type ApiError = { error: { code: string; message: string; fieldErrors?: Record<string, string>; requestId: string } };

export type ApiInit = RequestInit & {
  /**
   * Stable per logical operation. The server replays the original response when
   * the same key is retried, so a timeout never creates a second record.
   */
  idempotencyKey?: string;
};

export class ApiRequestError extends Error {
  readonly code: string;
  readonly fieldErrors: Record<string, string>;
  readonly requestId: string;
  constructor(
    public readonly status: number,
    public readonly body: ApiError,
  ) {
    super(body.error.message);
    this.code = body.error.code || "SERVER_TEMPORARILY_UNAVAILABLE";
    this.fieldErrors = body.error.fieldErrors ?? {};
    this.requestId = body.error.requestId ?? "";
  }
}

function looksLikeHtml(text: string) {
  return text.trimStart().startsWith("<") || text.includes("fetch failed");
}

function newKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createIdempotencyKey() {
  return newKey();
}

function isMutation(method: string) {
  return method !== "GET" && method !== "HEAD";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Two components (or a double click before React re-renders) sending the exact
 * same mutation at the same time share one request. The entry only exists while
 * the request is in flight; sequential intentional duplicates are still allowed.
 */
const inFlightMutations = new Map<string, Promise<ApiSuccess<unknown>>>();

/**
 * The in-flight map is scoped to the signed-in user. When the session changes
 * the map is dropped, so a new user can never receive a previous user's
 * in-flight response.
 */
let sessionScope = "anonymous";

export function setApiSessionScope(scope: string) {
  if (sessionScope === scope) return;
  sessionScope = scope;
  inFlightMutations.clear();
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<ApiSuccess<T>> {
  const method = (init.method ?? "GET").toUpperCase();
  if (!isMutation(method) || typeof init.body !== "string") {
    return request<T>(path, init);
  }

  const fingerprint = `${sessionScope}\n${method} ${path}\n${init.idempotencyKey ?? ""}\n${init.body}`;
  const existing = inFlightMutations.get(fingerprint);
  if (existing) return existing as Promise<ApiSuccess<T>>;

  const pending = request<T>(path, init).finally(() => {
    inFlightMutations.delete(fingerprint);
  });
  inFlightMutations.set(fingerprint, pending as Promise<ApiSuccess<unknown>>);
  return pending;
}

async function request<T>(path: string, init: ApiInit, attempt = 0): Promise<ApiSuccess<T>> {
  const headers = new Headers(init.headers);
  const { idempotencyKey, ...fetchInit } = init;
  if (fetchInit.body && !(fetchInit.body instanceof FormData) && !(fetchInit.body instanceof ArrayBuffer)) {
    headers.set("content-type", "application/json");
  }
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);

  let res: Response;
  try {
    res = await fetch(path, { ...fetchInit, headers, credentials: "include" });
  } catch {
    throw new ApiRequestError(0, {
      error: { code: "NETWORK_UNAVAILABLE", message: "Could not reach the server.", requestId: "" },
    });
  }
  if (res.status === 204) return { data: undefined as T, meta: { requestId: res.headers.get("x-request-id") ?? "" } };
  const text = await res.text();
  if (looksLikeHtml(text)) {
    throw new ApiRequestError(res.status || 503, {
      error: { code: "SERVER_TEMPORARILY_UNAVAILABLE", message: "The request could not be completed.", requestId: res.headers.get("x-request-id") ?? "" },
    });
  }
  let json: ApiSuccess<T> | ApiError;
  try {
    json = JSON.parse(text) as ApiSuccess<T> | ApiError;
  } catch {
    throw new ApiRequestError(res.status || 503, {
      error: { code: "SERVER_TEMPORARILY_UNAVAILABLE", message: "The request could not be completed.", requestId: "" },
    });
  }
  if (!res.ok) {
    const error = new ApiRequestError(res.status, json as ApiError);
    // Another tab or a duplicate request owns the same key. Wait for it to
    // finish, then retry with the same key so the backend can replay its result.
    if (error.code === "IDEMPOTENCY_IN_PROGRESS" && idempotencyKey && attempt < 30) {
      await sleep(500);
      return request<T>(path, init, attempt + 1);
    }
    throw error;
  }
  return json as ApiSuccess<T>;
}

export async function uploadFile(file: File, parentType: string, parentId: string, onProgress?: (pct: number) => void) {
  // One key per logical request. The session and the completion are different
  // operations, so they must not share a key.
  const sessionKey = newKey();
  const completeKey = newKey();
  const session = await api<{
    id: string;
    partSize: number;
    mode: string;
  }>("/api/v1/files/uploads", {
    method: "POST",
    idempotencyKey: sessionKey,
    body: JSON.stringify({
      parentType,
      parentId,
      filename: file.name,
      mime: file.type || "application/pdf",
      expectedBytes: file.size,
    }),
  });
  const partSize = session.data.partSize;
  const parts: { partNumber: number; etag: string }[] = [];
  const totalParts = Math.max(1, Math.ceil(file.size / partSize));
  for (let i = 0; i < totalParts; i += 1) {
    const blob = file.slice(i * partSize, Math.min(file.size, (i + 1) * partSize));
    const signed = await api<{ url: string; method: string }>(`/api/v1/files/uploads/${session.data.id}/sign`, {
      method: "POST",
      body: JSON.stringify({ partNumber: i + 1 }),
    });
    // A presigned R2 part URL carries its own authorization, so the app session
    // cookie must not be sent to the storage host.
    const partUrl = new URL(signed.data.url, window.location.origin);
    const sameOrigin = partUrl.origin === window.location.origin;
    const put = await fetch(partUrl.toString(), {
      method: signed.data.method,
      body: blob,
      credentials: sameOrigin ? "include" : "omit",
    });
    if (!put.ok) {
      throw new ApiRequestError(put.status, {
        error: { code: "DOCUMENT_UPLOAD_INCOMPLETE", message: "The upload did not finish.", requestId: "" },
      });
    }
    const etag = put.headers.get("etag") || (await put.json().then((j) => j.data?.etag).catch(() => `part-${i + 1}`));
    parts.push({ partNumber: i + 1, etag: String(etag).replaceAll('"', "") });
    onProgress?.(Math.round(((i + 1) / totalParts) * 100));
  }
  const done = await api<{ objectKey: string; byteSize: number; mime: string; filename: string }>(
    `/api/v1/files/uploads/${session.data.id}/complete`,
    { method: "POST", idempotencyKey: completeKey, body: JSON.stringify({ parts }) },
  );
  return done.data;
}
