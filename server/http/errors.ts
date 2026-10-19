export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const errors = {
  badRequest: (message: string, fieldErrors?: Record<string, string>) => new HttpError(400, "BAD_REQUEST", message, fieldErrors),
  validation: (message: string, fieldErrors?: Record<string, string>, code = "VALIDATION_ERROR") =>
    new HttpError(422, code, message, fieldErrors),
  coded: (status: number, code: string, message: string, fieldErrors?: Record<string, string>) =>
    new HttpError(status, code, message, fieldErrors),
  unauthorized: (message = "Your session has ended. Sign in again to continue.") => new HttpError(401, "SESSION_EXPIRED", message),
  forbidden: (message = "You do not have permission to do this.") => new HttpError(403, "USER_NOT_AUTHORIZED", message),
  notFound: (message = "This record is not available.") => new HttpError(404, "OPERATION_NOT_ACCESSIBLE", message),
  conflict: (message: string, code = "CONFLICT", fieldErrors?: Record<string, string>) => new HttpError(409, code, message, fieldErrors),
  gone: (message = "This tracking link is unavailable or has expired.") => new HttpError(410, "CUSTOMER_TRACKING_UNAVAILABLE", message),
  rateLimited: (message = "Too many attempts in a short time. Try again later.") => new HttpError(429, "TOO_MANY_REQUESTS", message),
  payload: (message: string) => new HttpError(413, "PAYLOAD_TOO_LARGE", message),
};

function isUnsafe(text: string) {
  return /D1_|SQLITE_|CONSTRAINT|TypeError|fetch failed|stack|wrangler|cloudflare-internal|at Object\./i.test(text);
}

export function publicMessage(error: HttpError | Error): { status: number; code: string; message: string; fieldErrors?: Record<string, string> } {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      code: error.code,
      message: isUnsafe(error.message) ? "The request could not be completed. Check the latest saved data before trying again." : error.message,
      fieldErrors: error.fieldErrors,
    };
  }
  if (error.name === "TransitionError") {
    return {
      status: 409,
      code: "BANK_TRANSITION_NOT_ALLOWED",
      message: "This step is not available until the previous stage is finished.",
    };
  }
  return {
    status: 500,
    code: "SERVER_TEMPORARILY_UNAVAILABLE",
    message: "The request could not be completed. Check the latest saved data before trying again.",
  };
}

export function jsonSuccess<T>(data: T, requestId: string, extraMeta: Record<string, unknown> = {}, status = 200): Response {
  return Response.json(
    { data, meta: { requestId, ...extraMeta } },
    { status, headers: securityHeaders() },
  );
}

export function jsonError(error: HttpError | Error, requestId: string): Response {
  const safe = publicMessage(error);
  return Response.json(
    {
      error: {
        code: safe.code,
        message: safe.message,
        fieldErrors: safe.fieldErrors,
        requestId,
      },
    },
    { status: safe.status, headers: securityHeaders() },
  );
}

export function securityHeaders(): HeadersInit {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  };
}
