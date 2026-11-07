import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Ltr } from "@/components/ui/chrome";
import { Textarea } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useCopy } from "@/lib/copy";
import { notifyError, notifySuccess } from "@/lib/notify";
import type { CustomerFileCard } from "@shared/customer-file-share";

export function CustomerFiles({ token, files }: { token: string; files: CustomerFileCard[] }) {
  const { tx, ar } = useCopy();
  const client = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!files.length) return null;

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
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/10 text-accent">
          <FileText className="h-4 w-4" aria-hidden />
        </span>
        <h2 className="text-[15px] font-semibold text-ink">{tx("customerFiles", "Files for your review")}</h2>
      </div>
      <p className="mt-2 text-sm text-ink-muted">{tx("customerFilesHint", "Open the file, then accept it or write what should change. Accepting it does not replace the company's own check.")}</p>
      <ul className="mt-3 space-y-3">
        {files.map((file) => (
          <li key={file.versionId} className="rounded-xl border border-line/70 bg-paper/40 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{ar ? file.nameAr || file.nameEn : file.nameEn}</p>
                <p className="mt-0.5 truncate text-xs text-ink-muted"><Ltr>{file.fileName}</Ltr> · {tx("version", "Version")} <Ltr>{file.version}</Ltr></p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button asChild size="sm" variant="outline">
                  <a href={`/api/v1/public/track/${token}/files/${file.versionId}?inline=1`} target="_blank" rel="noreferrer">{tx("openFile", "Open file")}</a>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href={`/api/v1/public/track/${token}/files/${file.versionId}`}>{tx("downloadFile", "Download")}</a>
                </Button>
              </div>
            </div>
            {file.decision === "ACCEPTED" ? <p className="mt-2 text-sm text-ok">{tx("customerFileAccepted", "You accepted this file. The company still confirms it.")}</p> : null}
            {file.decision === "CHANGES_REQUESTED" ? (
              <p className="mt-2 whitespace-pre-wrap text-sm text-warn">{tx("customerFileChangesSent", "Your note was sent. A new file will appear here when it is ready.")}{file.comment ? ` ${file.comment}` : ""}</p>
            ) : null}
            <div className="mt-3 grid gap-2">
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
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
