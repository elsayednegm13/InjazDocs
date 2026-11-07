import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/chrome";
import { Field, Textarea } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useCopy } from "@/lib/copy";
import { isDefinitiveFailure, useIdempotencyKey, useSubmitLock } from "@/lib/idempotency";
import { notifyError, notifySuccess } from "@/lib/notify";
import {
  DEFAULT_WHATSAPP_TEMPLATE,
  WHATSAPP_FIELDS,
  WHATSAPP_LINK_SOFT_LIMIT,
  WHATSAPP_TEMPLATE_MAX,
  insertWhatsAppToken,
  renderWhatsAppTemplate,
  whatsAppRuns,
  wrapWhatsAppSelection,
  type WhatsAppField,
  type WhatsAppRun,
} from "@shared/whatsapp-template";

const SAMPLE = {
  customerName: "Nile Trading",
  customerCode: "C-1008",
  phone: "01000000000",
  invoiceNumber: "INV-2041",
  country: "EG",
  trackingUrl: "https://exportflow.example/track/sample",
};

const MARKS = [
  { marker: "*", key: "whatsappBold", english: "Bold" },
  { marker: "_", key: "whatsappItalic", english: "Italic" },
  { marker: "~", key: "whatsappStrike", english: "Strikethrough" },
  { marker: "```", key: "whatsappMono", english: "Fixed width" },
] as const;

type TemplateStatus = { template: string; customized: boolean; storageReady: boolean };

export function WhatsAppTemplateCard() {
  const { tx } = useCopy();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["whatsapp-template"],
    queryFn: async () => (await api<TemplateStatus>("/api/v1/settings/whatsapp-template")).data,
    retry: false,
  });
  const [draft, setDraft] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const { key, reset } = useIdempotencyKey();
  const lock = useSubmitLock();
  const shown = draft ?? query.data?.template ?? DEFAULT_WHATSAPP_TEMPLATE;
  const storageReady = query.data?.storageReady === true;
  const preview = renderWhatsAppTemplate(shown, SAMPLE);
  const heavy = encodeURIComponent(preview).length > WHATSAPP_LINK_SOFT_LIMIT;

  function write(next: { value: string; start: number; end: number }) {
    setDraft(next.value);
    requestAnimationFrame(() => {
      const node = area.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(next.start, next.end);
    });
  }

  function selection() {
    const node = area.current;
    return { start: node?.selectionStart ?? shown.length, end: node?.selectionEnd ?? shown.length };
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!storageReady || !lock.acquire()) return;
    try {
      await api("/api/v1/settings/whatsapp-template", {
        method: "POST",
        idempotencyKey: key.current,
        body: JSON.stringify({ template: shown }),
      });
      reset();
      setDraft(null);
      notifySuccess(tx("whatsappSaved", "WhatsApp message saved"));
      await client.invalidateQueries({ queryKey: ["whatsapp-template"] });
    } catch (error) {
      if (isDefinitiveFailure(error)) reset();
      notifyError(error);
    } finally {
      lock.release();
    }
  }

  return (
    <SectionCard title={tx("whatsappMessages", "WhatsApp messages")} icon={<MessageCircle className="h-4 w-4" />}>
      <p className="mb-3 text-sm text-ink-muted">{tx("whatsappMessagesHint", "Write the message the customer receives. Bold, italic, strike and fixed width use WhatsApp marks. Colors, fonts and pictures are not included. Bank details and files stay out.")}</p>
      {query.data && !storageReady ? <p className="mb-3 text-sm text-warn">{tx("whatsappStoragePending", "This is the original message. Saving a custom message waits until the database upgrade is applied.")}</p> : null}
      <form className="grid gap-4" onSubmit={(event) => void save(event)}>
        <div className="flex flex-wrap gap-2">
          {MARKS.map((item) => (
            <Button
              key={item.marker}
              type="button"
              size="sm"
              variant="outline"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                const range = selection();
                write(wrapWhatsAppSelection(shown, range.start, range.end, item.marker));
              }}
            >
              {tx(item.key, item.english)}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const range = selection();
              write(insertWhatsAppToken(shown, range.start, range.end, "\n"));
            }}
          >
            {tx("whatsappBreak", "New line")}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2" aria-label={tx("whatsappInsertField", "Add to the message")}>
          {WHATSAPP_FIELDS.map((field) => (
            <Button
              key={field}
              type="button"
              size="sm"
              variant="outline"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                const range = selection();
                write(insertWhatsAppToken(shown, range.start, range.end, `{{${field}}}`));
              }}
            >
              {tx(`whatsappField.${field}`, fieldLabel(field))}
            </Button>
          ))}
        </div>
        <Field label={tx("whatsappMessages", "WhatsApp messages")}>
          <Textarea
            ref={area}
            dir="auto"
            rows={12}
            value={shown}
            maxLength={WHATSAPP_TEMPLATE_MAX + 40}
            onChange={(event) => setDraft(event.target.value)}
          />
        </Field>
        <p className={`text-xs ${shown.length > WHATSAPP_TEMPLATE_MAX ? "text-danger" : "text-ink-muted"}`}>
          {shown.length}/{WHATSAPP_TEMPLATE_MAX}
          {shown.length > WHATSAPP_TEMPLATE_MAX ? ` · ${tx("whatsappTooLong", "Keep the message within 800 characters so the WhatsApp link can open.")}` : ""}
        </p>
        <div className="rounded-control border border-line bg-paper/50 p-3">
          <p className="text-sm font-medium text-ink">{tx("whatsappPreview", "What the customer sees")}</p>
          <p className="mt-1 text-xs text-ink-muted">{tx("whatsappPreviewSample", "Sample data for the preview, not a real shipment.")}</p>
          <div dir="auto" className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">
            {preview.split("\n").map((line, index) => (
              <span key={`${index}-${line}`} className="block min-h-[1.25rem]">
                {whatsAppRuns(line).map((run, runIndex) => (
                  <PreviewRun key={`${index}-${runIndex}`} run={run} />
                ))}
              </span>
            ))}
          </div>
          {heavy ? <p className="mt-2 text-xs text-warn">{tx("whatsappLinkHeavy", "This sample is long enough that some phones may not open the WhatsApp link. Shorten the message.")}</p> : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setDraft(DEFAULT_WHATSAPP_TEMPLATE)}>
            {tx("whatsappRestore", "Restore the original message")}
          </Button>
          <Button type="submit" disabled={!storageReady || lock.busy || shown.length > WHATSAPP_TEMPLATE_MAX}>{tx("save", "Save")}</Button>
        </div>
      </form>
    </SectionCard>
  );
}

function PreviewRun({ run }: { run: WhatsAppRun }) {
  if (run.kind === "bold") return <strong>{run.text}</strong>;
  if (run.kind === "italic") return <em>{run.text}</em>;
  if (run.kind === "strike") return <s>{run.text}</s>;
  if (run.kind === "mono") return <code className="rounded bg-card px-1 font-mono text-[0.92em]">{run.text}</code>;
  return <>{run.text}</>;
}

function fieldLabel(field: WhatsAppField) {
  if (field === "customerName") return "Customer name";
  if (field === "customerCode") return "Customer code";
  if (field === "phone") return "Phone";
  if (field === "invoiceNumber") return "Invoice number";
  if (field === "country") return "Country";
  return "Tracking link";
}
