import { useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FormDisclosure } from "@/components/ui/form-disclosure";
import { EmptyState, Ltr } from "@/components/ui/chrome";
import { Field, Input, Textarea } from "@/components/ui/input";
import { PageSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status";
import { api, createIdempotencyKey } from "@/lib/api";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useCopy } from "@/lib/copy";
import { QUOTATION_PATHS } from "@shared/api";

import { formatUsd, useCan } from "./quotation-model";
import type { ItemDraft, QuotationDetail, QuotationItemRow } from "./quotation-model";

export function QuotationDetailPage() {
  const { id = "" } = useParams();
  const { tx } = useCopy();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ["quotation", id],
    queryFn: async () => (await api<QuotationDetail>(QUOTATION_PATHS.detail(id))).data,
  });
  const canEdit = useCan("quotations.edit");
  const canIssue = useCan("quotations.issue");
  const canRespond = useCan("quotations.record_response");
  const canExportPdf = useCan("quotations.export");
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["quotation", id] });
    void queryClient.invalidateQueries({ queryKey: ["quotations"] });
  };

  if (detail.isLoading) return <PageSkeleton cards={2} rows={4} />;
  if (detail.isError || !detail.data) return <p className="text-sm text-danger">{tx("errorState", "Could not load the quotation.")}</p>;

  const { quote, customer, items, revisions, effectiveStatus } = detail.data;
  const isDraft = effectiveStatus === "DRAFT";

  return (
    <div className="space-y-4" data-testid="quotation-detail">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            <Ltr>{quote.quote_number_display}</Ltr>
          </h1>
          <p className="mt-0.5 text-sm text-ink-muted">{quote.title ?? tx("quotationDetail", "Quotation details")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canExportPdf ? (
            <Button asChild variant="outline" size="sm">
              <a href={QUOTATION_PATHS.pdf(id)}>{tx("quotationDownloadPdf", "Download PDF")}</a>
            </Button>
          ) : null}
          {isDraft && canEdit ? (
            <Button asChild variant="outline" size="sm">
              <Link to={`/quotations/${id}/edit`}>{tx("quotationEdit", "Edit draft")}</Link>
            </Button>
          ) : null}
          {isDraft && canIssue ? <IssuePanel quoteId={id} onDone={refresh} /> : null}
          {!isDraft && canIssue && canEdit && effectiveStatus !== "REJECTED" ? <RevisePanel quoteId={id} version={quote.version} onDone={refresh} /> : null}
          {effectiveStatus === "ISSUED" && canRespond ? <ResponsePanel quoteId={id} onDone={refresh} /> : null}
          {canEdit && !quote.archived_at ? <ArchivePanel quoteId={id} onDone={refresh} /> : null}
        </div>
      </div>

      <dl className="grid gap-3 rounded-xl border border-line bg-card p-4 sm:grid-cols-2 md:grid-cols-3">
        <Info label={tx("quotationStatus", "Status")} value={<StatusBadge value={effectiveStatus} />} />
        <Info label={tx("quotationRevision", "Revision")} value={<Ltr>{quote.active_revision > 0 ? String(quote.active_revision) : "—"}</Ltr>} />
        <Info label={tx("quotationIssuedAt", "Issued at")} value={quote.issued_at ? <Ltr>{quote.issued_at.slice(0, 16).replace("T", " ")} UTC</Ltr> : "—"} />
        <Info label={tx("quotationValidUntil", "Valid until")} value={quote.valid_until ? <Ltr>{quote.valid_until.slice(0, 16).replace("T", " ")} UTC</Ltr> : "—"} />
        <Info label={tx("quotationValidityDays", "Validity (days)")} value={<Ltr>{String(quote.validity_days)}</Ltr>} />
        <Info label={tx("quotationIncoterm", "Incoterm")} value={quote.incoterm ? <Ltr>{quote.incoterm}</Ltr> : "—"} />
        <Info
          label={tx("quotationCustomer", "Customer")}
          value={customer.trade_name ? `${customer.trade_name} (${customer.legal_name})` : customer.legal_name}
        />
        <Info
          label={tx("quotationCaseRef", "Case ref")}
          value={
            quote.case_id ? (
              <Link to={`/export-cases/${quote.case_id}`} className="text-accent hover:underline">
                {quote.case_reference ?? quote.case_id}
              </Link>
            ) : (
              "—"
            )
          }
        />
        <Info label={tx("quotationClientResponse", "Client response")} value={quote.client_response ? <StatusBadge value={quote.client_response} /> : "—"} />
      </dl>

      <QuotationItemsPanel quoteId={id} isDraft={isDraft} items={items} subtotal={quote.subtotal_minor} onDone={refresh} />

      {revisions.length > 0 ? (
        <div className="rounded-xl border border-line bg-card p-4" data-testid="quotation-revisions">
          <h2 className="font-medium">{tx("quotationRevisions", "Issued revisions")}</h2>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {revisions.map((revision) => (
                <tr key={revision.id} className="border-b border-line/60 last:border-0">
                  <td className="py-2 pe-3 font-semibold"><Ltr>{String(revision.revision)}</Ltr></td>
                  <td className="py-2 pe-3">{revision.reason}</td>
                  <td className="py-2 pe-3"><Ltr>{revision.issued_at.slice(0, 10)}</Ltr></td>
                  <td className="py-2 pe-3"><Ltr>{formatUsd(revision.subtotal_minor)}</Ltr></td>
                  <td className="py-2">
                    {canExportPdf ? (
                      <a href={QUOTATION_PATHS.pdf(id, revision.revision)} className="text-accent hover:underline">
                        {tx("quotationDownloadPdf", "PDF")}
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {quote.archived_at ? (
        <p className="rounded-xl border border-line bg-paper p-4 text-sm text-ink-muted">
          {tx("quotationArchivedAt", "Archived")}: <Ltr>{quote.archived_at.slice(0, 10)}</Ltr> — {quote.archived_reason}
        </p>
      ) : null}
    </div>
  );
}

function QuotationItemsPanel({
  quoteId,
  isDraft,
  items,
  subtotal,
  onDone,
}: {
  quoteId: string;
  isDraft: boolean;
  items: QuotationItemRow[];
  subtotal: number;
  onDone: () => void;
}) {
  const { tx } = useCopy();
  const canEdit = useCan("quotations.edit");
  const [draft, setDraft] = useState<ItemDraft>({ description: "", quantity: "", unitLabel: "", unitPrice: "" });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: async (body: ItemDraft) => {
      await api(QUOTATION_PATHS.items(quoteId), { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      setDraft({ description: "", quantity: "", unitLabel: "", unitPrice: "" });
      onDone();
    },
    onError: notifyError,
  });
  const update = useMutation({
    mutationFn: async (input: { itemId: string; body: ItemDraft }) => {
      await api(QUOTATION_PATHS.item(quoteId, input.itemId), { method: "PUT", body: JSON.stringify(input.body) });
    },
    onSuccess: () => {
      setEditing(null);
      onDone();
    },
    onError: notifyError,
  });
  const remove = useMutation({
    mutationFn: async (itemId: string) => {
      await api(QUOTATION_PATHS.item(quoteId, itemId), { method: "DELETE" });
    },
    onSuccess: onDone,
    onError: notifyError,
  });

  return (
    <div className="rounded-card border border-line bg-card p-4 shadow-card" data-testid="quotation-items">
      <h2 className="font-medium">{tx("quotationItems", "Items")}</h2>
      {items.length === 0 ? (
        <div className="mt-3"><EmptyState compact>{tx("quotationItemsEmpty", "No items yet — add at least one before issuing.")}</EmptyState></div>
      ) : (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-muted">
              <th className="p-2 text-start">#</th>
              <th className="p-2 text-start">{tx("quotationItemDescription", "Description")}</th>
              <th className="p-2 text-start">{tx("quotationItemQuantity", "Quantity")}</th>
              <th className="p-2 text-start">{tx("quotationItemUnit", "Unit")}</th>
              <th className="p-2 text-start">{tx("quotationItemPrice", "Unit price")}</th>
              <th className="p-2 text-start">{tx("quotationItemTotal", "Line total")}</th>
              {isDraft && canEdit ? <th className="p-2" aria-label={tx("quotationItemActions", "Actions")} /> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-line/60 last:border-0">
                <td className="p-2"><Ltr>{String(item.position)}</Ltr></td>
                <td className="p-2">{item.description}</td>
                <td className="p-2"><Ltr>{item.quantity_text}</Ltr></td>
                <td className="p-2">{item.unit_label ?? "—"}</td>
                <td className="p-2"><Ltr>{item.unit_price_text}</Ltr></td>
                <td className="p-2"><Ltr>{formatUsd(item.line_total_minor)}</Ltr></td>
                {isDraft && canEdit ? (
                  <td className="p-2">
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-ink-muted hover:text-accent"
                        onClick={() => setEditing(editing === item.id ? null : item.id)}
                        aria-label={tx("quotationItemEdit", "Edit item")}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-ink-muted hover:text-danger"
                        onClick={() => remove.mutate(item.id)}
                        aria-label={tx("quotationItemDelete", "Delete item")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-sm font-semibold">
        {tx("quotationSubtotal", "Subtotal")}: <Ltr>{formatUsd(subtotal)}</Ltr>
      </p>

      {isDraft && canEdit ? (
        <div className="mt-4">
          <FormDisclosure
            open={adding}
            onToggle={() => setAdding((open) => !open)}
            title={tx("quotationAddItem", "Add item")}
            openLabel={tx("quotationAddItem", "Add item")}
            closeLabel={tx("cancel", "Cancel")}
          >
            <div className="grid gap-3 md:grid-cols-5">
              <Field label={tx("quotationItemDescription", "Description")}>
                <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </Field>
              <Field label={tx("quotationItemQuantity", "Quantity")}>
                <Input value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} inputMode="decimal" />
              </Field>
              <Field label={tx("quotationItemUnit", "Unit")}>
                <Input value={draft.unitLabel} onChange={(e) => setDraft({ ...draft, unitLabel: e.target.value })} />
              </Field>
              <Field label={tx("quotationItemPrice", "Unit price")}>
                <Input value={draft.unitPrice} onChange={(e) => setDraft({ ...draft, unitPrice: e.target.value })} inputMode="decimal" />
              </Field>
              <div className="flex items-end">
                <Button
                  size="sm"
                  disabled={add.isPending || !draft.description.trim() || !draft.quantity.trim() || !draft.unitPrice.trim()}
                  onClick={() =>
                    add.mutate({
                      description: draft.description.trim(),
                      quantity: draft.quantity.trim(),
                      unitLabel: draft.unitLabel.trim(),
                      unitPrice: draft.unitPrice.trim(),
                    })
                  }
                >
                  {tx("quotationAddItem", "Add item")}
                </Button>
              </div>
            </div>
          </FormDisclosure>
        </div>
      ) : null}
      {editing ? (
        <div className="mt-4 rounded-card border border-line bg-paper/40 p-4">
          <ItemEditorRow
            item={items.find((row) => row.id === editing)}
            pending={update.isPending}
            onSave={(body) => update.mutate({ itemId: editing, body })}
          />
        </div>
      ) : null}
    </div>
  );
}

function ItemEditorRow({
  item,
  pending,
  onSave,
}: {
  item?: QuotationItemRow;
  pending: boolean;
  onSave: (body: ItemDraft) => void;
}) {
  const { tx } = useCopy();
  const [draft, setDraft] = useState<ItemDraft>({
    description: item?.description ?? "",
    quantity: item?.quantity_text ?? "",
    unitLabel: item?.unit_label ?? "",
    unitPrice: item?.unit_price_text ?? "",
  });
  if (!item) return null;
  return (
    <div className="grid gap-2 md:col-span-5 md:grid-cols-4">
      <Field label={tx("quotationItemDescription", "Description")}>
        <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      </Field>
      <Field label={tx("quotationItemQuantity", "Quantity")}>
        <Input value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} inputMode="decimal" />
      </Field>
      <Field label={tx("quotationItemUnit", "Unit")}>
        <Input value={draft.unitLabel} onChange={(e) => setDraft({ ...draft, unitLabel: e.target.value })} />
      </Field>
      <div className="flex items-end gap-2">
        <Field label={tx("quotationItemPrice", "Unit price")}>
          <Input value={draft.unitPrice} onChange={(e) => setDraft({ ...draft, unitPrice: e.target.value })} inputMode="decimal" />
        </Field>
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            onSave({
              description: draft.description.trim(),
              quantity: draft.quantity.trim(),
              unitLabel: draft.unitLabel.trim(),
              unitPrice: draft.unitPrice.trim(),
            })
          }
        >
          {tx("quotationItemSave", "Save")}
        </Button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- action panels -- */

function IssuePanel({ quoteId, onDone }: { quoteId: string; onDone: () => void }) {
  const { tx } = useCopy();
  const [reason, setReason] = useState("");
  const [validityDays, setValidityDays] = useState("");
  const issue = useMutation({
    mutationFn: async () => {
      await api(QUOTATION_PATHS.issue(quoteId), {
        method: "POST",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({
          reason: reason.trim() || undefined,
          validityDays: validityDays.trim() ? Number(validityDays.trim()) : undefined,
        }),
      });
    },
    onSuccess: () => {
      notifySuccess(tx("quotationIssued", "Quotation issued."));
      onDone();
    },
    onError: notifyError,
  });
  return (
    <InlinePanel label={tx("quotationIssue", "Issue")}>
      <Field label={tx("quotationReasonOptional", "Reason (optional)")}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Field label={tx("quotationValidityDays", "Validity (days)")}>
        <Input value={validityDays} onChange={(e) => setValidityDays(e.target.value)} inputMode="numeric" placeholder="30" />
      </Field>
      <Button size="sm" disabled={issue.isPending} onClick={() => issue.mutate()}>
        {tx("quotationIssue", "Issue")}
      </Button>
    </InlinePanel>
  );
}

function RevisePanel({ quoteId, version, onDone }: { quoteId: string; version: number; onDone: () => void }) {
  const { tx } = useCopy();
  const [reason, setReason] = useState("");
  const revise = useMutation({
    mutationFn: async () => {
      await api(QUOTATION_PATHS.revise(quoteId), {
        method: "POST",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({ version, reason: reason.trim() }),
      });
    },
    onSuccess: () => {
      notifySuccess(tx("quotationRevised", "New revision issued."));
      onDone();
    },
    onError: notifyError,
  });
  return (
    <InlinePanel label={tx("quotationRevise", "Revise")}>
      <Field label={tx("quotationReasonRequired", "Reason (required)")} hint={tx("quotationReviseHint", "Items are copied exactly from the current revision.")}>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
      </Field>
      <Button size="sm" disabled={revise.isPending || reason.trim().length < 3} onClick={() => revise.mutate()}>
        {tx("quotationRevise", "Revise")}
      </Button>
    </InlinePanel>
  );
}

function ResponsePanel({ quoteId, onDone }: { quoteId: string; onDone: () => void }) {
  const { tx } = useCopy();
  const record = useMutation({
    mutationFn: async (response: "ACCEPTED" | "REJECTED") => {
      await api(QUOTATION_PATHS.response(quoteId), {
        method: "POST",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({ response }),
      });
    },
    onSuccess: () => {
      notifySuccess(tx("quotationResponseRecorded", "Client response recorded."));
      onDone();
    },
    onError: notifyError,
  });
  return (
    <InlinePanel label={tx("quotationRecordResponse", "Record client response")}>
      <Button size="sm" variant="outline" disabled={record.isPending} onClick={() => record.mutate("ACCEPTED")}>
        {tx("quotationAccept", "Accepted")}
      </Button>
      <Button size="sm" variant="outline" disabled={record.isPending} onClick={() => record.mutate("REJECTED")}>
        {tx("quotationReject", "Rejected")}
      </Button>
    </InlinePanel>
  );
}

function ArchivePanel({ quoteId, onDone }: { quoteId: string; onDone: () => void }) {
  const { tx } = useCopy();
  const [reason, setReason] = useState("");
  const archive = useMutation({
    mutationFn: async () => {
      await api(QUOTATION_PATHS.archive(quoteId), {
        method: "POST",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({ reason: reason.trim() }),
      });
    },
    onSuccess: () => {
      notifySuccess(tx("quotationArchived", "Quotation archived."));
      onDone();
    },
    onError: notifyError,
  });
  return (
    <InlinePanel label={tx("quotationArchive", "Archive")}>
      <Field label={tx("quotationReasonRequired", "Reason (required)")}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Button size="sm" variant="outline" disabled={archive.isPending || reason.trim().length < 3} onClick={() => archive.mutate()}>
        {tx("quotationArchive", "Archive")}
      </Button>
    </InlinePanel>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-1 text-sm font-medium" dir="auto">{value}</dd>
    </div>
  );
}

function InlinePanel({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="inline-flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>
        {label}
      </Button>
      {open ? (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-card p-3 shadow-sm">
          {children}
        </div>
      ) : null}
    </div>
  );
}
