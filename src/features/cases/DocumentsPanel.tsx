import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormDisclosure } from "@/components/ui/form-disclosure";
import { AlertText, EmptyState, Ltr } from "@/components/ui/chrome";
import { Field, Select } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status";
import { Skeleton } from "@/components/ui/skeleton";
import { api, createIdempotencyKey, uploadFile } from "@/lib/api";
import { fieldErrorsOf } from "@/lib/fail";
import { isDefinitiveFailure, useIdempotencyKey, useSubmitLock } from "@/lib/idempotency";
import { notifyError, notifySuccess } from "@/lib/notify";
import { can, useSession } from "@/app/access";
import { bothPartiesApproved } from "@shared/customer-file-share";
import { useCopy } from "@/lib/copy";

import { formatWhen } from "./case-format";

function formatBytes(value: number | string | null, language: string) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = language.startsWith("ar")
    ? ["بايت", "ك.ب", "م.ب", "ج.ب"]
    : ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const size = bytes / 1024 ** index;
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function DocumentsPanel({
  caseId,
  requirements,
  versions,
  customerShareReady = false,
  onDone,
}: {
  caseId: string;
  requirements: Array<Record<string, string | number>>;
  versions: Array<Record<string, string | number | null>>;
  customerShareReady?: boolean;
  onDone: () => void;
}) {
  const { tx, fail, ar, i18n } = useCopy();
  const client = useQueryClient();
  const restore = useMutation({
    mutationFn: async (documentId: string) => {
      await api(`/api/v1/export-cases/${caseId}/document-requirements/${documentId}/restore`, {
        method: "POST",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({}),
      });
    },
    onSuccess: async () => {
      notifySuccess(tx("previousVersionRestored", "Previous version restored"));
      await client.invalidateQueries({ queryKey: ["case", caseId] });
    },
    onError: (error) => notifyError(error),
  });
  const user = useSession();
  const canReview = can(user, "documents.review");
  const canUpload = can(user, "documents.upload");
  const canSend = customerShareReady && (canReview || can(user, "tracking_links.manage"));
  const [adding, setAdding] = useState(false);
  const [typeError, setTypeError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const uploadLocks = useRef(new Set<string>());
  const { key: addKey, reset: resetAddKey } = useIdempotencyKey();
  const addLock = useSubmitLock();
  const types = useQuery({
    queryKey: ["doctypes"],
    queryFn: async () => (await api<Array<Record<string, string>>>("/api/v1/document-types")).data,
    refetchInterval: false,
  });
  return (
    <div className="space-y-4">
      {uploadError ? <AlertText>{uploadError}</AlertText> : null}
      {types.isError ? <AlertText>{tx("documentsError", "Could not load document types.")}</AlertText> : null}
      {requirements.length === 0 ? <EmptyState>{tx("noDocuments", "No document requirements on this case yet.")}</EmptyState> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {[...requirements].sort(byAddedOrder).map((req) => {
        const reqId = String(req.id);
        const uploading = progress[reqId] != null;
        const rows = versions.filter((v) => String(v.requirement_id) === reqId);
        const latestVersion = rows.reduce((max, row) => Math.max(max, Number(row.version) || 0), 0);
        const latestRow = rows.find((row) => Number(row.version) === latestVersion);
        const customerAccepted = latestRow?.customer_decision === "ACCEPTED";
        return (
        <div key={reqId} className="rounded-card border border-line bg-card p-4 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-medium">{(ar && String(req.name_ar || "").trim()) ? String(req.name_ar) : String(req.name_en)} {Number(req.required) ? `(${tx("required", "required")})` : `(${tx("optional", "optional")})`}</div>
              <StatusBadge value={String(req.status)} />
            </div>
            <label className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-control border border-line bg-card px-2.5 text-xs font-medium shadow-sm transition duration-[180ms] ease-out hover:bg-paper has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${uploading ? "text-ink-muted" : "text-ink"}`}>
              {uploading ? (
                <>
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent" aria-hidden="true" />
                  {tx("uploading", "Uploading…")} {progress[reqId]}%
                </>
              ) : (
                tx("chooseFile", "Choose file")
              )}
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="sr-only"
                disabled={uploading}
                onChange={async (event) => {
                  const input = event.currentTarget;
                  const file = input.files?.[0];
                  if (!file) return;
                  if (uploadLocks.current.has(reqId)) {
                    input.value = "";
                    return;
                  }
                  uploadLocks.current.add(reqId);
                  const attachKey = createIdempotencyKey();
                  setUploadError(null);
                  setProgress((current) => ({ ...current, [reqId]: 0 }));
                  try {
                    const uploaded = await uploadFile(file, "document_requirement", reqId, (pct) =>
                      setProgress((current) => ({ ...current, [reqId]: pct })),
                    );
                    await api(`/api/v1/document-requirements/${reqId}/versions`, {
                      method: "POST",
                      idempotencyKey: attachKey,
                      body: JSON.stringify({
                        r2Key: uploaded.objectKey,
                        originalName: uploaded.filename,
                        contentType: uploaded.mime,
                        byteSize: uploaded.byteSize,
                      }),
                    });
                    notifySuccess(tx("documentUploaded", "File uploaded"), file.name);
                    onDone();
                  } catch (error) {
                    setUploadError(fail(error));
                    notifyError(error);
                  } finally {
                    uploadLocks.current.delete(reqId);
                    setProgress((current) => {
                      const next = { ...current };
                      delete next[reqId];
                      return next;
                    });
                    input.value = "";
                  }
                }}
              />
            </label>
          </div>
          {customerShareReady && bothPartiesApproved(String(req.status), String(latestRow?.customer_decision ?? "")) ? (
            <p className="mt-2 text-sm font-medium text-ok">{tx("bothApproved", "Approved by the customer and the company")}</p>
          ) : null}
          {customerShareReady && customerAccepted && String(req.status) !== "APPROVED" ? (
            <p className="mt-2 text-sm text-ok">{tx("customerFileAcceptedStaff", "Customer accepted this version")} {tx("customerFileStaffStill", "Your own approval is still required.")}</p>
          ) : null}
          {uploading ? (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={progress[reqId]} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress[reqId]}%` }} />
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {["UNDER_REVIEW", "APPROVED", "NEEDS_CORRECTION", "WAIVED"].map((decision) => (
              <Button
                key={decision}
                data-decision={decision}
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await api(`/api/v1/document-requirements/${reqId}/review`, {
                      method: "POST",
                      body: JSON.stringify({ decision, reason: decision === "WAIVED" ? "Authorized waiver" : undefined }),
                    });
                    notifySuccess(tx("reviewUpdated", "Review status updated"));
                    onDone();
                  } catch (error) {
                    notifyError(error);
                  }
                }}
              >
                {tx(`status.${decision}`, decision)}
              </Button>
            ))}
          </div>
          {latestRow ? (
            <div className="mt-3 rounded-lg border border-line bg-paper/40 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{String(latestRow.original_name)}</p>
                    <p className="text-xs text-ink-muted">
                      {tx("version", "Version")} <Ltr>{String(latestRow.version)}</Ltr>
                      {" · "}<Ltr>{formatBytes(latestRow.byte_size, i18n.language)}</Ltr>
                      {" · "}<Ltr>{formatWhen(String(latestRow.created_at))}</Ltr>
                      {" · "}<StatusBadge value={String(latestRow.review_state)} />
                    </p>
                    {customerShareReady ? <CustomerShareStatus version={latestRow} tx={tx} /> : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {canSend && latestRow.customer_decision === "ACCEPTED" && Number(latestRow.customer_revision_open) !== 1 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await api(`/api/v1/document-versions/${latestRow.id}/customer-revision`, {
                              method: "POST",
                              idempotencyKey: createIdempotencyKey(),
                              body: JSON.stringify({}),
                            });
                            notifySuccess(tx("customerReviewReopened", "The customer can review and approve again"));
                            onDone();
                          } catch (error) {
                            notifyError(error);
                          }
                        }}
                      >
                        {tx("reopenCustomerReview", "Allow the customer to review again")}
                      </Button>
                    ) : null}
                    {Number(req.has_previous_version) === 1 && (canUpload || canReview) ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="rounded-full"
                        disabled={restore.isPending && restore.variables === reqId}
                        aria-label={tx("restorePreviousVersion", "Restore previous version")}
                        title={tx("restorePreviousVersion", "Restore previous version")}
                        onClick={() => restore.mutate(reqId)}
                      >
                        <RotateCcw className={`h-3.5 w-3.5 ${restore.isPending && restore.variables === reqId ? "animate-spin" : ""}`} />
                      </Button>
                    ) : null}
                    {canSend ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          const published = Number(latestRow.customer_published) === 1;
                          try {
                            await api(`/api/v1/document-versions/${latestRow.id}/customer-share`, {
                              method: "POST",
                              idempotencyKey: createIdempotencyKey(),
                              body: JSON.stringify({ publish: !published }),
                            });
                            notifySuccess(tx(published ? "withdrawFromCustomer" : "sentForCustomerReview", published ? "Withdraw from customer" : "Waiting for the customer's review"));
                            onDone();
                          } catch (error) {
                            notifyError(error);
                          }
                        }}
                      >
                        {Number(latestRow.customer_published) === 1 ? tx("withdrawFromCustomer", "Withdraw from customer") : tx("awaitingCustomerReview", "Waiting for customer review")}
                      </Button>
                    ) : null}
                    {canUpload && String(latestRow.review_state) === "UPLOADED" && !latestRow.customer_decision ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await api(`/api/v1/document-versions/${latestRow.id}`, {
                              method: "DELETE",
                              idempotencyKey: createIdempotencyKey(),
                            });
                            notifySuccess(tx("fileDeleted", "Unreviewed file deleted"));
                            onDone();
                          } catch (error) {
                            notifyError(error);
                          }
                        }}
                      >
                        {tx("deleteFile", "Delete file")}
                      </Button>
                    ) : null}
                    <Button asChild size="sm" variant="outline">
                      <a
                        href={`/api/v1/files/download?key=${encodeURIComponent(String(latestRow.r2_key))}&inline=1`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {tx("openFile", "Open file")}
                      </a>
                    </Button>
                  </div>
            </div>
          ) : (
            <div className="mt-3"><EmptyState compact>{tx("noFileYet", "No file uploaded for this requirement yet.")}</EmptyState></div>
          )}
        </div>
        );
      })}
      </div>
      <FormDisclosure
        open={adding}
        onToggle={() => setAdding((open) => !open)}
        title={tx("addToCase", "Add to this case")}
        openLabel={tx("addToCase", "Add to this case")}
        closeLabel={tx("cancel", "Cancel")}
      >
      <form
        className="grid gap-3 md:grid-cols-[1fr_8rem_auto]"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const typeId = String(data.get("documentTypeId") ?? "").trim();
          setAddError(null);
          if (!typeId) {
            setTypeError(tx("errors.DOCUMENT_TYPE_REQUIRED", "Choose a document type before adding it."));
            form.querySelector<HTMLSelectElement>("select[name=documentTypeId]")?.focus();
            return;
          }
          if (!addLock.acquire()) return;
          setTypeError(null);
          try {
            await api(`/api/v1/export-cases/${caseId}/document-requirements`, {
              method: "POST",
              idempotencyKey: addKey.current,
              body: JSON.stringify({ documentTypeId: typeId, required: data.get("required") === "1" }),
            });
            resetAddKey();
            notifySuccess(tx("requirementAdded", "Document added to this case"));
            form.reset();
            onDone();
          } catch (error) {
            if (isDefinitiveFailure(error)) resetAddKey();
            const fields = fieldErrorsOf(error);
            setTypeError(fields.documentTypeId ? tx("errors.DOCUMENT_TYPE_REQUIRED", fields.documentTypeId) : null);
            setAddError(fail(error));
            notifyError(error);
          } finally {
            addLock.release();
          }
        }}
      >
        <Field label={tx("documentTemplate", "Document template")} error={typeError ?? undefined} errorId="documentTypeId-error">
          {types.isLoading ? (
            <Skeleton className="h-10 w-full rounded-lg" />
          ) : (
            <Select
              name="documentTypeId"
              aria-invalid={Boolean(typeError)}
              aria-describedby={typeError ? "documentTypeId-error" : undefined}
              onChange={() => setTypeError(null)}
            >
              <option value="">{tx("select", "Select")}</option>
              {types.data?.map((t) => <option key={t.id} value={t.id}>{(ar && t.name_ar?.trim()) ? t.name_ar : t.name_en}</option>)}
            </Select>
          )}
        </Field>
        <Field label={tx("required", "Required")}>
          <Select name="required" defaultValue="1">
            <option value="1">{tx("required", "Required")}</option>
            <option value="0">{tx("optional", "Optional")}</option>
          </Select>
        </Field>
        <div className="flex items-end">
          <Button size="sm" type="submit" disabled={addLock.busy}>{tx("addToCase", "Add to this case")}</Button>
        </div>
        {addError ? <div className="md:col-span-3"><AlertText>{addError}</AlertText></div> : null}
      </form>
      </FormDisclosure>
    </div>
  );
}

function byAddedOrder(a: Record<string, string | number>, b: Record<string, string | number>) {
  const created = String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  if (created !== 0) return created;
  return String(a.id).localeCompare(String(b.id));
}

function CustomerShareStatus({ version, tx }: { version: Record<string, string | number | null>; tx: (key: string, fallback: string) => string }) {
  const published = Number(version.customer_published) === 1;
  const decision = String(version.customer_decision ?? "");
  if (!published && !decision && !version.customer_first_viewed_at) return null;
  return (
    <div className="mt-1 text-xs">
      {decision === "CHANGES_REQUESTED" ? (
        <p className="whitespace-pre-wrap text-warn">{tx("customerFileNeedsChange", "Customer asked for a change")}{version.customer_comment ? `: ${version.customer_comment}` : ""}</p>
      ) : null}
      {decision === "ACCEPTED" ? <p className="text-ok">{tx("customerFileAcceptedStaff", "Customer accepted this version")}</p> : null}
      {decision === "ACCEPTED" && Number(version.customer_revision_open) === 1 ? <p className="text-ink-muted">{tx("customerReviewReopened", "The customer can review and approve again")}</p> : null}
      {published && !decision && version.customer_first_viewed_at ? <p className="text-ink-muted">{tx("customerFileViewed", "Customer opened the file")}</p> : null}
      {published && !decision && !version.customer_first_viewed_at ? <p className="text-ink-muted">{tx("customerFileWaiting", "Waiting for the customer")}</p> : null}
    </div>
  );
}
