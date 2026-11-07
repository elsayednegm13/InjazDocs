import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Ltr } from "@/components/ui/chrome";
import { Textarea } from "@/components/ui/input";
import { Reveal } from "@/components/ui/reveal";
import { StatusBadge } from "@/components/ui/status";
import { api } from "@/lib/api";
import { useCopy } from "@/lib/copy";
import { notifyError, notifySuccess } from "@/lib/notify";
import { customerReviewLocked, type CustomerFileCard } from "@shared/customer-file-share";

export type TrackDocument = {
  requirementId?: string;
  nameEn: string;
  nameAr: string;
  status: string;
};

export function CustomerDocuments({
  token,
  documents,
  files,
}: {
  token: string;
  documents: TrackDocument[];
  files: CustomerFileCard[];
}) {
  const { tx, ar } = useCopy();
  const client = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!documents.length) return null;

  async function decide(versionId: string, decision: "ACCEPTED" | "CHANGES_REQUESTED") {
    if (busy) return;
    setBusy(versionId);
    try {
      await api(`/api/v1/public/track/${token}/files/${versionId}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision, comment: notes[versionId] ?? "" }),
      });
      notifySuccess(tx(decision === "ACCEPTED" ? "customerFileAccepted" : "customerFileChangesSent", decision === "ACCEPTED" ? "You accepted this file. The company still confirms it." : "Your note was sent. A new file will appear here when it is ready."));
      await client.invalidateQueries({ queryKey: ["track", token] });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-card)]">
      <h2 className="text-[15px] font-semibold text-ink">{tx("documentChecklist", "Documents")}</h2>
      <ul className="mt-3 space-y-2">
        {documents.map((document, index) => {
          const file = files.find((item) => item.requirementId === document.requirementId);
          const key = document.requirementId || `${document.nameEn}-${index}`;
          const expanded = open === key;
          return (
            <li key={key} className="rounded-xl border border-line/70 bg-paper/40">
              <button
                type="button"
                className="flex w-full items-center gap-3 px-3 py-2 text-start"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : key)}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{ar ? document.nameAr || document.nameEn : document.nameEn}</span>
                <StatusBadge value={document.status} />
                {file?.decision === "ACCEPTED" ? <span className="text-xs font-medium text-ok">{tx("customerFileAccept", "Accept file")}</span> : null}
                {file?.decision === "CHANGES_REQUESTED" ? <span className="text-xs font-medium text-warn">{tx("customerFileChanges", "Request another review")}</span> : null}
                <ChevronDown className={`h-4 w-4 shrink-0 text-ink-muted transition duration-[180ms] ease-out ${expanded ? "rotate-180" : ""}`} aria-hidden />
              </button>
              <Reveal open={expanded}>
                <div className="space-y-3 border-t border-line/70 px-3 py-3">
                  {file ? (
                    <>
                      <p className="truncate text-xs text-ink-muted"><Ltr>{file.fileName}</Ltr> · {tx("version", "Version")} <Ltr>{file.version}</Ltr></p>
                      <div className="flex flex-wrap gap-2">
                        <Button asChild size="sm" variant="outline">
                          <a href={`/api/v1/public/track/${token}/files/${file.versionId}?inline=1`} target="_blank" rel="noreferrer">{tx("openFile", "Open file")}</a>
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <a href={`/api/v1/public/track/${token}/files/${file.versionId}`}>{tx("downloadFile", "Download")}</a>
                        </Button>
                      </div>
                      {file.decision === "ACCEPTED" ? <p className="text-sm font-medium text-ok">{tx("customerApprovedLabel", "Approved by the customer")}</p> : null}
                      {document.status === "APPROVED" ? <p className="text-sm font-medium text-ok">{tx("companyApprovedLabel", "Approved by the company")}</p> : <p className="text-sm text-ink-muted">{tx("companyPendingLabel", "Company approval is still pending")}</p>}
                      {file.decision === "CHANGES_REQUESTED" && file.comment ? <p className="whitespace-pre-wrap text-sm text-warn">{file.comment}</p> : null}
                      {customerReviewLocked(file.decision, file.revisionOpen) ? (
                        <p className="text-sm text-ink-muted">{tx("customerReviewClosed", "The file stays available to view and download. Review and approval are closed.")}</p>
                      ) : (
                        <>
                          <Textarea
                            dir="auto"
                            rows={3}
                            value={notes[file.versionId] ?? file.comment ?? ""}
                            placeholder={tx("customerFileNote", "What should change")}
                            aria-label={tx("customerFileNote", "What should change")}
                            onChange={(event) => setNotes((current) => ({ ...current, [file.versionId]: event.target.value }))}
                          />
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" size="sm" disabled={busy === file.versionId} onClick={() => void decide(file.versionId, "ACCEPTED")}>
                              {tx("customerFileAccept", "Accept file")}
                            </Button>
                            <Button type="button" size="sm" variant="outline" disabled={busy === file.versionId} onClick={() => void decide(file.versionId, "CHANGES_REQUESTED")}>
                              {tx("customerFileChanges", "Request another review")}
                            </Button>
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-ink-muted">{tx("customerFileNotReleased", "The company has not approved a file for you yet.")}</p>
                  )}
                </div>
              </Reveal>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
