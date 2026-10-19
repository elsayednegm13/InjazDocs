import { Bell, Boxes, CalendarRange, CheckCircle2, ChevronDown, ClipboardList, FileStack, History, Package, Ship } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useSession } from "@/app/access";
import { EmptyState, Ltr, SectionCard, StatCard } from "@/components/ui/chrome";
import { StatusBadge } from "@/components/ui/status";
import { api } from "@/lib/api";
import { formatWhen, useCopy } from "@/lib/copy";

type DueItem = {
  id: string;
  reason: string;
  next_action: string;
  due_at: string;
  case_reference: string;
  case_id: string;
  status: string;
  owner_user_id?: string;
  owner_name?: string;
};

type Overview = {
  counts: {
    total_cases: number;
    completed: number;
    docs_pending: number;
    bank_pending: number;
    courier_open: number;
    overdue: number;
  };
  recent: { id: string; event_type: string; summary: string; created_at: string; case_id: string; case_reference?: string }[];
  due: DueItem[];
};

type Band = "urgent" | "today" | "upcoming";

function bandOf(item: DueItem): Band {
  const due = new Date(item.due_at);
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  if (item.status === "ACTIVE" && due < start) return "urgent";
  if (due >= start && due < end) return "today";
  return "upcoming";
}

const BAND_TONE: Record<Band, { dot: string; pill: string; count: string }> = {
  urgent: { dot: "bg-danger", pill: "bg-danger/10 text-danger", count: "bg-danger/10 text-danger" },
  today: { dot: "bg-warn", pill: "bg-warn/10 text-warn", count: "bg-warn/10 text-warn" },
  upcoming: { dot: "bg-accent", pill: "bg-accent/10 text-accent", count: "bg-accent/10 text-accent" },
};

function PriorityPill({ band }: { band: Band }) {
  const { tx } = useCopy();
  const label = band === "urgent" ? tx("queueUrgent", "Urgent") : band === "today" ? tx("queueToday", "Today") : tx("queueUpcoming", "Upcoming");
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${BAND_TONE[band].pill}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${BAND_TONE[band].dot}`} />
      {label}
    </span>
  );
}

function ActionRow({ item, stored, language }: { item: DueItem; stored: (value: string) => string; language: string }) {
  return (
    <li className="grid gap-1.5 border-b border-line/70 px-1 py-3 last:border-0 md:grid-cols-[7.5rem_minmax(0,1fr)_10.5rem_5.5rem] md:items-center md:gap-3">
      <Link className="text-sm font-semibold text-accent" to={`/export-cases/${item.case_id}`}>
        <Ltr>{item.case_reference}</Ltr>
      </Link>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-ink">{stored(item.next_action)}</div>
        <div className="truncate text-xs text-ink-muted">{stored(item.reason)}</div>
      </div>
      <div className="text-xs text-ink-muted">
        <div className="truncate">
          <Ltr>{formatWhen(item.due_at, language)}</Ltr>
        </div>
        {item.owner_name ? <div className="mt-0.5 truncate">{item.owner_name}</div> : null}
      </div>
      <div className="justify-self-start md:justify-self-end">
        <PriorityPill band={bandOf(item)} />
      </div>
    </li>
  );
}

function MiniReminder({ item, stored, language }: { item: DueItem; stored: (value: string) => string; language: string }) {
  return (
    <li className="flex items-start justify-between gap-2 border-b border-line/60 py-2 text-xs last:border-0 last:pb-0">
      <Link className="min-w-0 flex-1" to={`/export-cases/${item.case_id}`}>
        <span className="block truncate font-medium text-ink">{stored(item.next_action)}</span>
        <span className="mt-0.5 block truncate text-ink-muted">
          <Ltr>{item.case_reference}</Ltr> · <Ltr>{formatWhen(item.due_at, language)}</Ltr>
        </span>
      </Link>
      <StatusBadge value={item.status} />
    </li>
  );
}

function dateTile(value: string, language: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { day: "—", month: "" };
  const locale = language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB";
  return {
    day: new Intl.DateTimeFormat(locale, { day: "2-digit" }).format(date),
    month: new Intl.DateTimeFormat(locale, { month: "short" }).format(date),
  };
}

export function DashboardPage() {
  const user = useSession();
  const { tx, i18n, stored, activity } = useCopy();
  const query = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await api<Overview>("/api/v1/dashboard")).data,
  });
  if (query.isLoading) return <p className="text-ink-muted">{tx("loadingDashboard", "Loading dashboard…")}</p>;
  if (query.isError) {
    return (
      <div role="alert" className="rounded-[14px] border border-danger/30 bg-card p-4 text-danger">
        {tx("dashboardLoadError", "Could not load dashboard counts from the API.")}
        <button type="button" className="ms-3 text-sm font-semibold text-accent" onClick={() => void query.refetch()}>
          {tx("retrySafeGet", "Retry")}
        </button>
      </div>
    );
  }
  const data = query.data!;
  const queues: Record<Band, DueItem[]> = {
    urgent: data.due.filter((item) => bandOf(item) === "urgent"),
    today: data.due.filter((item) => bandOf(item) === "today"),
    upcoming: data.due.filter((item) => bandOf(item) === "upcoming"),
  };
  const todayActions = [...queues.urgent, ...queues.today].slice(0, 8);
  const nextUrgent = queues.urgent[0];
  return (
    <div className="space-y-5" data-dashboard="ready">
      <section className="relative overflow-hidden rounded-2xl bg-accent-2 px-5 py-6 text-white shadow-[var(--shadow-tower)] md:px-7 md:py-7">
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="absolute inset-y-0 end-0 w-3/5 bg-[radial-gradient(circle_at_78%_38%,rgb(13_148_136/0.45),transparent_62%)]" />
          <div className="absolute -end-20 -top-28 h-80 w-80 rounded-full border border-white/10" />
          <div className="absolute -end-4 -top-12 h-56 w-56 rounded-full border border-white/10" />
          <div className="absolute end-36 -bottom-24 h-48 w-48 rounded-full border border-white/10" />
          <Ship className="absolute end-8 top-1/2 h-28 w-28 -translate-y-1/2 text-white/15 md:end-16 md:h-32 md:w-32" strokeWidth={1.1} />
        </div>
        <div className="relative max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/85">
            <span className="h-1.5 w-1.5 rounded-full bg-[#5eead4]" aria-hidden />
            {tx("opsKicker", "Operations workspace")}
          </span>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight md:text-[28px]">{tx("heroTitle", "Export operations")}</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/75">
            {tx("heroSubtitle", "Track every export file from booking through delivery.")}
          </p>
          <p className="mt-4 text-xs text-white/60">
            <span className="text-white/85">{tx("welcomeNamed", "Welcome, {{name}}").replace("{{name}}", user?.name ?? "")}</span>
            {" · "}
            {tx("opsHint", "Counts come from live operations. Overdue uses reminder due times, not invented percentages.")}
          </p>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={tx("openCases", "Open cases")}
          value={data.counts.total_cases}
          href="/export-cases"
          icon={<Boxes className="h-5 w-5" />}
          hint={tx("scopedCounts", "Scoped to cases this account may see.")}
          tone="blue"
        />
        <StatCard
          label={tx("docsPending", "Documents pending")}
          value={data.counts.docs_pending}
          href="/export-cases"
          icon={<FileStack className="h-5 w-5" />}
          hint={tx("docsPendingHint", "Awaiting upload or review.")}
          tone="amber"
        />
        <StatCard
          label={tx("courierOpen", "Courier in transit")}
          value={data.counts.courier_open}
          href="/export-cases"
          icon={<Package className="h-5 w-5" />}
          hint={tx("courierNotCargo", "Courier status is not customer delivery.")}
          tone="teal"
        />
        <StatCard
          label={tx("overdueReminders", "Overdue reminders")}
          value={data.counts.overdue}
          href="/reminders"
          icon={<Bell className="h-5 w-5" />}
          hint={tx("overdueHint", "Reminders past their due time.")}
          tone={data.counts.overdue > 0 ? "rose" : "green"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <SectionCard
          title={tx("todayActions", "Today's actions")}
          icon={<ClipboardList className="h-4 w-4" />}
          action={
            <Link className="text-accent" to="/reminders">
              {tx("openReminders", "Open reminders")}
            </Link>
          }
        >
          {todayActions.length === 0 ? (
            <EmptyState>{tx("noOpenReminders", "No open reminders.")}</EmptyState>
          ) : (
            <>
              <div className="hidden grid-cols-[7.5rem_minmax(0,1fr)_10.5rem_5.5rem] gap-3 border-b border-line px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted md:grid">
                <span>{tx("fileCol", "File")}</span>
                <span>{tx("actionCol", "Action")}</span>
                <span>{tx("dueCol", "Due")}</span>
                <span className="text-end">{tx("priorityCol", "Priority")}</span>
              </div>
              <ul>
                {todayActions.map((item) => (
                  <ActionRow key={item.id} item={item} stored={stored} language={i18n.language} />
                ))}
              </ul>
            </>
          )}
        </SectionCard>

        <SectionCard
          title={tx("importantAlerts", "Important alerts")}
          icon={<Bell className="h-4 w-4" />}
          action={
            <Link className="text-accent" to="/reminders">
              {tx("viewAll", "View all")}
            </Link>
          }
        >
          <ul className="space-y-2">
            {(["urgent", "today", "upcoming"] as const).map((band) => {
              const rows = queues[band];
              const label = band === "urgent" ? tx("queueUrgent", "Urgent") : band === "today" ? tx("queueToday", "Today") : tx("queueUpcoming", "Upcoming");
              return (
                <li key={band}>
                  <details className="group rounded-xl border border-line bg-paper/50 open:bg-paper/80">
                    <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                      <span className={`h-2 w-2 rounded-full ${BAND_TONE[band].dot}`} aria-hidden />
                      <span className="text-sm font-medium text-ink">{label}</span>
                      <span className="ms-auto flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${BAND_TONE[band].count}`}>
                          <Ltr>{rows.length}</Ltr>
                        </span>
                        <ChevronDown className="h-4 w-4 text-ink-muted transition group-open:rotate-180" aria-hidden />
                      </span>
                    </summary>
                    <div className="border-t border-line px-3 py-2">
                      {rows.length === 0 ? (
                        <p className="py-1 text-xs text-ink-muted">{tx("noOpenReminders", "No open reminders.")}</p>
                      ) : (
                        <ul>
                          {rows.slice(0, 5).map((item) => (
                            <MiniReminder key={item.id} item={item} stored={stored} language={i18n.language} />
                          ))}
                        </ul>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
          <div className={`mt-3 rounded-xl border p-3 ${nextUrgent ? "border-danger/20 bg-danger/5" : "border-ok/20 bg-ok/5"}`}>
            {nextUrgent ? (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-danger">{tx("mostUrgent", "Most urgent")}</p>
                <Link className="mt-1 block truncate text-sm font-medium text-ink" to={`/export-cases/${nextUrgent.case_id}`}>
                  {stored(nextUrgent.next_action)}
                </Link>
                <p className="mt-1 truncate text-xs text-ink-muted">
                  <Ltr>{nextUrgent.case_reference}</Ltr> · <Ltr>{formatWhen(nextUrgent.due_at, i18n.language)}</Ltr>
                </p>
              </>
            ) : (
              <p className="flex items-center gap-2 text-sm font-medium text-ok">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                {tx("noUrgentAlerts", "No urgent actions right now.")}
              </p>
            )}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard
          title={tx("upcomingDates", "Upcoming dates")}
          icon={<CalendarRange className="h-4 w-4" />}
          action={
            <Link className="text-accent" to="/reminders">
              {tx("viewAll", "View all")}
            </Link>
          }
        >
          {queues.upcoming.length === 0 ? (
            <EmptyState>{tx("noOpenReminders", "No open reminders.")}</EmptyState>
          ) : (
            <ul className="space-y-2">
              {queues.upcoming.slice(0, 4).map((item) => {
                const tile = dateTile(item.due_at, i18n.language);
                return (
                  <li key={item.id}>
                    <Link
                      className="flex items-center gap-3 rounded-xl border border-line/70 bg-paper/40 p-2.5 transition hover:border-accent/30 hover:bg-paper"
                      to={`/export-cases/${item.case_id}`}
                    >
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-card shadow-[var(--shadow-card)]">
                        <span className="text-sm font-semibold leading-none text-ink">
                          <Ltr>{tile.day}</Ltr>
                        </span>
                        <span className="mt-0.5 text-[10px] uppercase leading-none text-ink-muted">{tile.month}</span>
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink">{stored(item.next_action)}</span>
                        <span className="mt-0.5 block truncate text-xs text-ink-muted">
                          <Ltr>{item.case_reference}</Ltr>
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard title={tx("documentTrack", "Document track")} icon={<FileStack className="h-4 w-4" />}>
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold text-ink-muted">{tx("docsPending", "Documents pending")}</p>
              <p className="mt-1 text-3xl font-semibold leading-none tabular-nums tracking-tight text-ink">
                <Ltr>{data.counts.docs_pending}</Ltr>
              </p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#fbeccd] text-[#a16207]">
              <FileStack className="h-5 w-5" />
            </span>
          </div>
          <ul className="mt-3 space-y-1.5 text-sm">
            <li className="flex items-center justify-between rounded-lg bg-paper/70 px-2.5 py-1.5">
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden />
                {tx("docsPending", "Documents pending")}
              </span>
              <span className="font-semibold tabular-nums">
                <Ltr>{data.counts.docs_pending}</Ltr>
              </span>
            </li>
            <li className="flex items-center justify-between rounded-lg bg-paper/70 px-2.5 py-1.5">
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                {tx("bankPending", "Bank review pending")}
              </span>
              <span className="font-semibold tabular-nums">
                <Ltr>{data.counts.bank_pending}</Ltr>
              </span>
            </li>
          </ul>
          <p className="mt-2 text-xs leading-snug text-ink-muted">
            {tx("noFakePercent", "No completion percentage is shown because the API does not provide a numerator and denominator.")}
          </p>
          <Link className="mt-3 inline-flex text-xs font-semibold text-accent" to="/export-cases">
            {tx("browseCases", "Browse cases")}
          </Link>
        </SectionCard>

        <SectionCard title={tx("goodsTrack", "Goods track")} icon={<Ship className="h-4 w-4" />}>
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold text-ink-muted">{tx("courierOpen", "Courier in transit")}</p>
              <p className="mt-1 text-3xl font-semibold leading-none tabular-nums tracking-tight text-ink">
                <Ltr>{data.counts.courier_open}</Ltr>
              </p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#d3f3ee] text-accent">
              <Package className="h-5 w-5" />
            </span>
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-paper/70 px-2.5 py-2 text-sm">
            <Ship className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
            <span>{tx("noCargoKpi", "This board has no cargo-delivery total. Port arrival is not customer delivery.")}</span>
          </div>
          <p className="mt-2 text-xs leading-snug text-ink-muted">{tx("courierNotCargo", "Courier status is not customer delivery.")}</p>
          <Link className="mt-3 inline-flex text-xs font-semibold text-accent" to="/export-cases">
            {tx("browseCases", "Browse cases")}
          </Link>
        </SectionCard>
      </div>

      <SectionCard title={tx("latestActivity", "Latest activity")} icon={<History className="h-4 w-4" />}>
        {data.recent.length === 0 ? (
          <EmptyState>{tx("noEvents", "No recorded events yet.")}</EmptyState>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {data.recent.slice(0, 6).map((item) => (
              <li key={item.id} className="flex items-start gap-3 rounded-xl border border-line/70 bg-paper/40 px-3 py-2.5">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/10 text-accent" aria-hidden>
                  <History className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <Link className="block truncate text-sm font-medium text-ink hover:text-accent" to={`/export-cases/${item.case_id}`}>
                    {activity(item.event_type, item.summary)}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                    {item.case_reference ? (
                      <span className="font-medium text-accent">
                        <Ltr>{item.case_reference}</Ltr>
                      </span>
                    ) : null}
                    <span>
                      <Ltr>{formatWhen(item.created_at, i18n.language)}</Ltr>
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
