import { toast } from "sonner";
import i18n from "@/app/i18n";
import { errorCode, fallbackFor } from "@/lib/fail";

export function describeError(error: unknown): string {
  const code = errorCode(error);
  const key = `errors.${code}`;
  const translated = i18n.t(key);
  return translated === key ? fallbackFor(code) : translated;
}

function toastId(kind: string, message: string, description?: string) {
  return `${kind}:${message}:${description ?? ""}`;
}

export function notifyError(error: unknown) {
  const message = describeError(error);
  toast.error(message, { id: toastId("error", message) });
}

export function notifyFailure(message: string) {
  toast.error(message, { id: toastId("error", message) });
}

export function notifySuccess(message: string, description?: string) {
  toast.success(message, {
    id: toastId("success", message, description),
    ...(description ? { description } : {}),
  });
}
