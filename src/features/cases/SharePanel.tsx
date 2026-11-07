import { Copy } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Ltr } from "@/components/ui/chrome";
import { api } from "@/lib/api";
import { isDefinitiveFailure, useIdempotencyKey, useSubmitLock } from "@/lib/idempotency";
import { notifyError, notifyFailure, notifySuccess } from "@/lib/notify";
import { useCopy } from "@/lib/copy";
import { DEFAULT_WHATSAPP_TEMPLATE, renderWhatsAppTemplate } from "@shared/whatsapp-template";

export function SharePanel({
  caseId,
  customerName = "",
  customerCode = "",
  phone = "",
  invoiceNumber = "",
  country = "",
}: {
  caseId: string;
  customerName?: string;
  customerCode?: string;
  phone?: string;
  invoiceNumber?: string;
  country?: string;
}) {
  const { tx } = useCopy();
  const client = useQueryClient();
  const { key, reset: resetKey } = useIdempotencyKey();
  const submitLock = useSubmitLock();
  const query = useQuery({
    queryKey: ["links", caseId],
    queryFn: async () => (await api<Array<Record<string, string | null>>>(`/api/v1/export-cases/${caseId}/tracking-links`)).data,
  });
  const activeLinks = (query.data ?? []).filter((link) => !link.revoked_at);
  const template = useQuery({
    queryKey: ["whatsapp-template"],
    queryFn: async () => (await api<{ template: string }>("/api/v1/settings/whatsapp-template")).data,
    staleTime: 60_000,
    retry: false,
  });
  const messageTemplate = template.data?.template || DEFAULT_WHATSAPP_TEMPLATE;
  return (
    <section className="space-y-4 rounded-card border border-line bg-card p-4 shadow-card">
      <h2 className="text-[15px] font-semibold tracking-tight text-ink">{tx("tabs.share", "Share")}</h2>
      <p className="text-sm text-ink-muted">{tx("shareHint", "The share link stays here until you revoke it. Revoking stops the link immediately and removes it. Bank details and files are never included.")}</p>
      <Button disabled={submitLock.busy} onClick={async () => {
        if (!submitLock.acquire()) return;
        try {
          await api<{ token: string }>(`/api/v1/export-cases/${caseId}/tracking-links`, { method: "POST", idempotencyKey: key.current, body: JSON.stringify({}) });
          resetKey();
          notifySuccess(tx("trackingCreated", "Tracking link created"));
          await client.invalidateQueries({ queryKey: ["links", caseId] });
        } catch (error) {
          if (isDefinitiveFailure(error)) resetKey();
          notifyError(error);
        } finally {
          submitLock.release();
        }
      }}>{tx("createTrackingLink", "Create tracking link")}</Button>
      {activeLinks.map((link) => {
        const shareUrl = link.share_token ? `${window.location.origin}/track/${link.share_token}` : "";
        return (
        <div key={String(link.id)} className="space-y-2 rounded-control border border-line bg-paper/50 p-3 text-sm">
          {shareUrl ? (
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 break-all rounded bg-paper p-2"><Ltr>{shareUrl}</Ltr></p>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => void copyShareLink(shareUrl, tx)}>
                  <Copy className="me-1.5 h-3.5 w-3.5" aria-hidden />
                  {tx("copyLink", "Copy link")}
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href={whatsAppShareHref(shareUrl, { customerName, customerCode, phone, invoiceNumber, country }, messageTemplate)} target="_blank" rel="noreferrer">
                    {tx("shareWhatsApp", "WhatsApp")}
                  </a>
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-ink-muted">{tx("shareTokenUnavailable", "This link is active, but its address was not kept and cannot be shown again.")}</p>
          )}
          {shareUrl && !whatsAppDigits(phone, country) ? <p className="text-xs text-ink-muted">{tx("whatsAppPhoneMissing", "This customer file has no phone number, so WhatsApp opens without a direct chat.")}</p> : null}
          <div className="flex items-center justify-between gap-2">
            <span>{tx("active", "active")} · {tx("expires", "expires")} <Ltr>{link.expires_at || tx("none", "none")}</Ltr></span>
            <Button size="sm" variant="outline" onClick={async () => {
              try {
                await api(`/api/v1/tracking-links/${link.id}/revoke`, { method: "POST" });
                notifySuccess(tx("trackingRevoked", "Tracking link revoked"));
                await client.invalidateQueries({ queryKey: ["links", caseId] });
              } catch (error) {
                notifyError(error);
              }
            }}>{tx("revoke", "Revoke")}</Button>
          </div>
        </div>
        );
      })}
    </section>
  );
}

function whatsAppShareHref(
  url: string,
  fields: { customerName: string; customerCode: string; phone: string; invoiceNumber: string; country: string },
  template: string,
) {
  const text = renderWhatsAppTemplate(template, {
    customerName: fields.customerName,
    customerCode: fields.customerCode,
    phone: fields.phone,
    invoiceNumber: fields.invoiceNumber,
    country: fields.country,
    trackingUrl: url,
  });
  const digits = whatsAppDigits(fields.phone, fields.country);
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function whatsAppDigits(phone: string, country: string) {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  const egyptianLocal = /^01\d{9}$/.test(digits);
  if (digits.startsWith("0") && (country.trim().toUpperCase() === "EG" || egyptianLocal)) digits = `20${digits.slice(1)}`;
  if (digits.length < 8 || digits.length > 15) return "";
  return digits;
}

async function copyShareLink(url: string, tx: (key: string, fallback: string) => string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      const area = document.createElement("textarea");
      area.value = url;
      area.setAttribute("readonly", "");
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      if (!copied) throw new Error("copy");
    }
    notifySuccess(tx("linkCopied", "Link copied"));
  } catch {
    notifyFailure(tx("copyFailed", "Could not copy the link"));
  }
}
