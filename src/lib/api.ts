export type ApiSuccess<T> = { data: T; meta: { requestId: string; page?: number; pageSize?: number; total?: number } };
export type ApiError = { error: { code: string; message: string; fieldErrors?: Record<string, string>; requestId: string } };

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

export async function api<T>(path: string, init: RequestInit = {}): Promise<ApiSuccess<T>> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !(init.body instanceof ArrayBuffer)) {
    headers.set("content-type", "application/json");
  }
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: "include" });
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
  if (!res.ok) throw new ApiRequestError(res.status, json as ApiError);
  return json as ApiSuccess<T>;
}

export async function uploadFile(file: File, parentType: string, parentId: string, onProgress?: (pct: number) => void) {
  const session = await api<{
    id: string;
    partSize: number;
    mode: string;
  }>("/api/v1/files/uploads", {
    method: "POST",
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
    const put = await fetch(signed.data.url, { method: signed.data.method, body: blob, credentials: "include" });
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
    { method: "POST", body: JSON.stringify({ parts }) },
  );
  return done.data;
}
