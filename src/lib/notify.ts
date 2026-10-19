import { toast } from "sonner";
import i18n from "@/app/i18n";
import { errorCode, fallbackFor } from "@/lib/fail";

export function describeError(error: unknown): string {
  const code = errorCode(error);
  const key = `errors.${code}`;
  const translated = i18n.t(key);
  return translated === key ? fallbackFor(code) : translated;
}

export function notifyError(error: unknown) {
  toast.error(describeError(error));
}

export function notifySuccess(message: string, description?: string) {
  toast.success(message, description ? { description } : undefined);
}
