import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { CalendarRange, CircleDashed, Ship } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, Ltr, PageHeader, StatCard } from "@/components/ui/chrome";
import { SkeletonCardList } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatDay, useCopy } from "@/lib/copy";

export function SchedulePage() {
  const { tx, i18n } = useCopy();
  const query = useQuery({
    queryKey: ["schedule"],
    queryFn: async () => (await api<Array<Record<string, string>>>("/api/v1/schedule")).data,
  });
  const rows = query.data ?? [];
  const departureDates = rows.map((row) => row.planned_etd || row.planned_loading_date).filter(Boolean).sort();
  const nextDeparture = departureDates[0];
  return (
    <div className="space-y-4" data-schedule={query.isLoading ? "loading" : "ready"}>
      <PageHeader title={tx("schedule", "Shipping schedule")} subtitle={tx("scheduleHint", "Planned dates are distinct from actuals. Empty dates mean not yet confirmed.")} />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={tx("scheduledSailings", "Scheduled sailings")} value={rows.length} icon={<CalendarRange className="h-5 w-5" />} tone="blue" />
        <StatCard
          label={tx("confirmedEtd", "Confirmed departure dates")}
          value={departureDates.length}
          icon={<Ship className="h-5 w-5" />}
          tone="teal"
          hint={nextDeparture ? `${tx("nextDeparture", "Next departure")}: ${formatDay(nextDeparture, i18n.language)}` : undefined}
        />
        <StatCard label={tx("awaitingDates", "Awaiting dates")} value={rows.length - departureDates.length} icon={<CircleDashed className="h-5 w-5" />} tone="amber" />
      </div>
      {query.isLoading ? <SkeletonCardList rows={4} /> : null}
      <div className="grid gap-3">
        {rows.map((row) => {
          const tile = calendarTile(row.actual_etd || row.planned_etd || row.planned_loading_date || row.actual_loading_date, i18n.language);
          return (
            <article key={row.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-card)] transition hover:border-accent/30 sm:flex-row sm:items-center">
              <div className="flex shrink-0 items-center gap-3 sm:w-24">
                {tile ? (
                  <div className="grid h-16 w-16 place-items-center rounded-xl border border-line bg-paper/70 text-center">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{tile.month} {tile.year}</span>
                    <span className="text-xl font-semibold leading-none tabular-nums text-ink">{tile.day}</span>
                    <span className="text-[10px] text-ink-muted">{tile.weekday}</span>
                  </div>
                ) : (
                  <div className="grid h-16 w-16 place-items-center rounded-xl border border-dashed border-line px-1 text-center text-[10px] leading-tight text-ink-muted">
                    {tx("notConfirmed", "Not yet confirmed")}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link className="font-semibold text-ink" to={`/bookings/${row.id}`}><Ltr>{row.booking_number}</Ltr></Link>
                  {row.case_id ? <Link className="text-xs font-medium text-accent" to={`/export-cases/${row.case_id}`}><Ltr>{row.case_reference}</Ltr></Link> : <span className="text-xs text-ink-muted">{tx("unlinkedBooking", "Not linked")}</span>}
                  {row.port_of_loading || row.port_of_discharge ? (
                    <span className="rounded-full bg-paper px-2 py-0.5 text-[11px] text-ink-muted">
                      <Ltr>{row.port_of_loading || "—"} → {row.port_of_discharge || "—"}</Ltr>
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 truncate text-sm text-ink-muted">{row.customer_name}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                  <span>{tx("load", "Load")}: <Ltr className="text-ink">{formatDay(row.actual_loading_date || row.planned_loading_date, i18n.language)}</Ltr></span>
                  <span>{tx("cutoff", "Cutoff")}: <Ltr className="text-ink">{formatDay(row.cutoff_date, i18n.language)}</Ltr></span>
                  <span>{tx("eta", "ETA")}: <Ltr className="text-ink">{formatDay(row.actual_eta || row.planned_eta, i18n.language)}</Ltr></span>
                </div>
              </div>
              <Button asChild size="sm" variant="outline" className="self-start sm:self-center">
                <Link to={`/bookings/${row.id}`}>{tx("openRecord", "Open")}</Link>
              </Button>
            </article>
          );
        })}
      </div>
      {!query.isLoading && !rows.length ? <EmptyState>{tx("noSchedule", "No scheduled bookings yet.")}</EmptyState> : null}
    </div>
  );
}

function calendarTile(value: string | null | undefined, language: string) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  const locale = language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB";
  return {
    day: new Intl.DateTimeFormat(locale, { day: "2-digit" }).format(date),
    month: new Intl.DateTimeFormat(locale, { month: "short" }).format(date),
    year: new Intl.DateTimeFormat(locale, { year: "numeric" }).format(date),
    weekday: new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date),
  };
}
