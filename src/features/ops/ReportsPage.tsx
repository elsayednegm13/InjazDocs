import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2, Download, FileWarning, Ship, Timer, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertText, Ltr, PageHeader, StatCard } from "@/components/ui/chrome";
import { SkeletonStats } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useCopy } from "@/lib/copy";
import { csvToRecords } from "@shared/csv";

export function ReportsPage() {
  const { tx } = useCopy();
  const query = useQuery({
    queryKey: ["delays"],
    queryFn: async () => (await api<Record<string, unknown>>("/api/v1/reports/delays")).data,
  });
  const data = query.data;
  const average = data?.averageBankReviewDays == null ? "—" : Number(data.averageBankReviewDays);
  return (
    <div className="space-y-4" data-reports={query.isLoading ? "loading" : "ready"}>
      <PageHeader
        title={tx("reports", "Reports")}
        subtitle={tx("reportsHint", "Operational totals computed from recorded events only — no estimates.")}
        actions={
          <Button asChild size="sm" variant="outline">
            <a href="/api/v1/exports/csv" download>
              <Download className="me-1.5 h-4 w-4" aria-hidden />
              {tx("downloadCsv", "Download cases CSV")}
            </a>
          </Button>
        }
      />
      {query.isLoading ? (
        <SkeletonStats count={4} label="Loading report totals" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={tx("bankReviewAvg", "Average bank review days")}
            value={average}
            icon={<Timer className="h-5 w-5" />}
            tone="blue"
            hint={tx("bankReviewHint", "Only completed handover → decision pairs are counted.")}
          />
          <StatCard label={tx("docsPending", "Documents pending")} value={Number(data?.incompleteRequiredDocuments ?? 0)} icon={<FileWarning className="h-5 w-5" />} tone="amber" />
          <StatCard label={tx("bookings", "Bookings")} value={Number(data?.bookingVolume ?? 0)} icon={<Ship className="h-5 w-5" />} tone="teal" />
          <StatCard
            label={tx("status.DELIVERED_TO_CUSTOMER", "Delivered to customer")}
            value={Number(data?.containersDelivered ?? 0)}
            icon={<CheckCircle2 className="h-5 w-5" />}
            tone="green"
            hint={`${tx("inTransit", "In transit")}: ${Number(data?.containersInTransit ?? 0)}`}
          />
        </div>
      )}
      {data?.note ? <p className="rounded-2xl border border-line bg-paper/60 px-4 py-3 text-xs leading-relaxed text-ink-muted">{String(data.note)}</p> : null}
      <ImportCustomers />
    </div>
  );
}

type ImportPreview = {
  valid: { legalName: string; countryCode?: string; phone?: string }[];
  errors: { row: number; code?: string; message: string }[];
  canCommit: boolean;
};

function ImportCustomers() {
  const { tx, fail } = useCopy();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-card)]" data-testid="import-preview">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
          <Upload className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">{tx("customerImport", "Customer CSV import")}</h2>
          <p className="mt-1 text-sm text-ink-muted">{tx("importHint", "Preview never writes. Commit is refused when any row is invalid.")}</p>
          <p className="mt-0.5 text-xs text-ink-muted">{tx("importNothingSaved", "Nothing is saved. This screen only previews the file.")}</p>
        </div>
      </div>
      <label className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-card border border-dashed border-line bg-paper/40 px-4 py-6 text-center text-sm text-ink-muted transition duration-[180ms] ease-out hover:border-accent/50 hover:text-accent has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
        <Upload className="h-5 w-5" aria-hidden />
        <span className="font-medium">{tx("chooseCsv", "Choose a CSV file")}</span>
        <span className="text-xs">{tx("csvOnly", "CSV only — nothing is written.")}</span>
        <input
          type="file"
          accept=".csv"
          className="sr-only"
          aria-label={tx("customerImport", "Customer CSV import")}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setError(null);
            try {
              const text = await file.text();
              const rows = csvToRecords(text);
              const res = await api<ImportPreview>("/api/v1/imports/customers/preview", { method: "POST", body: JSON.stringify({ rows }) });
              setPreview(res.data);
            } catch (err) {
              setPreview(null);
              setError(fail(err));
            }
          }}
        />
      </label>
      {error ? <AlertText>{error}</AlertText> : null}
      {preview ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-ok/10 px-2.5 py-1 font-semibold text-ok">
              {tx("importReady", "Rows that can be reviewed")}: <Ltr>{preview.valid.length}</Ltr>
            </span>
            <span className="rounded-full bg-danger/10 px-2.5 py-1 font-semibold text-danger">
              {tx("importBlocked", "Rows that need a correction")}: <Ltr>{preview.errors.length}</Ltr>
            </span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-0 text-sm">
              <thead className="bg-paper/80 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                <tr>
                  {[tx("importColRow", "Row"), tx("legalName", "Legal name"), tx("country", "Country"), tx("phone", "Phone"), tx("status", "Status")].map((heading) => (
                    <th key={heading} className="p-2.5 text-start">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.valid.map((row, index) => (
                  <tr key={`ok-${index}`} className="border-t border-line/70">
                    <td className="p-2.5 tabular-nums text-ink-muted"><Ltr>{index + 2}</Ltr></td>
                    <td className="p-2.5 text-ink">{row.legalName}</td>
                    <td className="p-2.5"><Ltr>{row.countryCode || "—"}</Ltr></td>
                    <td className="p-2.5"><Ltr>{row.phone || "—"}</Ltr></td>
                    <td className="p-2.5 text-ok">{tx("importRowReady", "Ready to review")}</td>
                  </tr>
                ))}
                {preview.errors.map((row) => (
                  <tr key={`bad-${row.row}`} className="border-t border-line/70 bg-danger/5">
                    <td className="p-2.5 tabular-nums"><Ltr>{row.row}</Ltr></td>
                    <td className="p-2.5 text-danger" colSpan={3}>{tx(`import.err.${row.code ?? "UNKNOWN"}`, tx("importRowNeedsFix", "This row needs a correction."))}</td>
                    <td className="p-2.5 font-medium text-danger">{tx("importRowNeedsFix", "This row needs a correction.")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
