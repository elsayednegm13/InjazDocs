import { Bell, Boxes, FileStack, Package, Ship } from "lucide-react";
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
  recent: { id: string; event_type: string; summary: string; created_at: string; case_id: string }[];
  due: DueItem[];
};

function bandOf(item: DueItem) {
  const due = new Date(item.due_at);
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  if (item.status === "ACTIVE" && due < start) return "urgent";
  if (due >= start && due < end) return "today";
  return "upcoming";
}

function ReminderRow({ item, stored, i18n }: { item: DueItem; stored: (value: string) => string; i18n: { language: string } }) {
  return (
    <li className="grid gap-1 border-b border-line py-3 text-sm last:border-0 last:pb-0 first:pt-0 md:grid-cols-[7rem_1fr_auto] md:items-start md:gap-3">
      <Link className="font-semibold text-accent" to={`/export-cases/${item.case_id}`}>
        <Ltr>{item.case_reference}</Ltr>
      </Link>
      <div className="min-w-0">
        <div>{stored(item.next_action)}</div>
        <div className="text-ink-muted">{stored(item.reason)}</div>
      </div>
      <div className="text-xs text-ink-muted">
        <Ltr>{formatWhen(item.due_at, i18n.language)}</Ltr>
        {item.owner_name ? <div>{item.owner_name}</div> : null}
        <StatusBadge value={item.status} />
      </div>
    </li>
  );
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
  const queues = {
    urgent: data.due.filter((item) => bandOf(item) === "urgent"),
    today: data.due.filter((item) => bandOf(item) === "today"),
    upcoming: data.due.filter((item) => bandOf(item) === "upcoming"),
  };
  const todayActions = [...queues.urgent, ...queues.today].slice(0, 8);
  return (
    <div className="space-y-5" data-dashboard="ready">
      <section className="relative overflow-hidden rounded-[16px] bg-accent-2 px-5 py-6 text-white">
        <div className="pointer-events-none absolute inset-y-0 end-0 w-2/5 bg-[radial-gradient(circle_at_80%_20%,rgb(13_148_136/0.35),transparent_55%)]" aria-hidden />
        <p className="text-xs font-medium text-white/70">{tx("welcomeNamed", "Welcome, {{name}}").replace("{{name}}", user?.name ?? "")}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{tx("opsHeading", "Operations desk")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-white/80">{tx("opsHint", "Counts come from live operations. Overdue uses reminder due times, not invented percentages.")}</p>
      </section>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={tx("openCases", "Open cases")} value={data.counts.total_cases} href="/export-cases" icon={<Boxes className="h-4 w-4" />} hint={tx("scopedCounts", "Scoped to cases this account may see.")} />
        <StatCard label={tx("docsPending", "Documents pending")} value={data.counts.docs_pending} href="/export-cases" icon={<FileStack className="h-4 w-4" />} />
        <StatCard label={tx("courierOpen", "Courier in transit")} value={data.counts.courier_open} href="/export-cases" icon={<Package className="h-4 w-4" />} hint={tx("courierNotCargo", "Courier status is not customer delivery.")} />
        <StatCard label={tx("overdueReminders", "Overdue reminders")} value={data.counts.overdue} href="/reminders" icon={<Bell className="h-4 w-4" />} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <SectionCard title={tx("todayActions", "Today's actions")}>
          {todayActions.length === 0 ? <EmptyState>{tx("noOpenReminders", "No open reminders.")}</EmptyState> : (
            <ul>
              {todayActions.map((item) => <ReminderRow key={item.id} item={item} stored={stored} i18n={i18n} />)}
            </ul>
          )}
          <Link className="mt-3 inline-block text-sm font-semibold text-accent" to="/reminders">{tx("openReminders", "Open reminders")}</Link>
        </SectionCard>
        <SectionCard title={tx("importantAlerts", "Important alerts")}>
          <ul className="space-y-2 text-sm">
            {([
              ["urgent", tx("queueUrgent", "Urgent"), queues.urgent],
              ["today", tx("queueToday", "Today"), queues.today],
              ["upcoming", tx("queueUpcoming", "Upcoming"), queues.upcoming],
            ] as const).map(([key, label, rows]) => (
              <li key={key}>
                <details>
                  <summary className="cursor-pointer font-medium">
                    {label} <Ltr>{rows.length}</Ltr>
                  </summary>
                  {rows.length === 0 ? <p className="mt-2 text-ink-muted">{tx("noOpenReminders", "No open reminders.")}</p> : (
                    <ul className="mt-2">
                      {rows.map((item) => <ReminderRow key={item.id} item={item} stored={stored} i18n={i18n} />)}
                    </ul>
                  )}
                </details>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title={tx("upcomingDates", "Upcoming dates")}>
          {queues.upcoming.length === 0 ? <EmptyState>{tx("noOpenReminders", "No open reminders.")}</EmptyState> : (
            <ul>
              {queues.upcoming.slice(0, 8).map((item) => <ReminderRow key={item.id} item={item} stored={stored} i18n={i18n} />)}
            </ul>
          )}
        </SectionCard>
        <SectionCard title={tx("documentTrack", "Document track")}>
          <p className="text-sm">{tx("docsPending", "Documents pending")} <Ltr>{data.counts.docs_pending}</Ltr></p>
          <p className="mt-2 text-sm">{tx("bankPending", "Bank review pending")} <Ltr>{data.counts.bank_pending}</Ltr></p>
          <p className="mt-3 text-xs text-ink-muted">{tx("noFakePercent", "No completion percentage is shown because the API does not provide a numerator and denominator.")}</p>
        </SectionCard>
        <SectionCard title={tx("goodsTrack", "Goods track")}>
          <p className="flex items-center gap-2 text-sm"><Ship className="h-4 w-4 text-accent" />{tx("noCargoKpi", "This board has no cargo-delivery total. Port arrival is not customer delivery.")}</p>
          <p className="mt-2 text-sm">{tx("courierOpen", "Courier in transit")} <Ltr>{data.counts.courier_open}</Ltr></p>
          <p className="mt-2 text-xs text-ink-muted">{tx("courierNotCargo", "Courier status is not customer delivery.")}</p>
        </SectionCard>
      </div>
      <SectionCard title={tx("latestActivity", "Latest activity")}>
        {data.recent.length === 0 ? <EmptyState>{tx("noEvents", "No recorded events yet.")}</EmptyState> : (
          <ul className="space-y-3 text-sm">
            {data.recent.map((item) => (
              <li key={item.id} className="border-b border-line pb-3 last:border-0">
                <Link className="font-medium text-ink" to={`/export-cases/${item.case_id}`}>
                  {activity(item.event_type) !== item.event_type.replaceAll(".", " ") ? activity(item.event_type) : item.summary}
                </Link>
                <div className="text-ink-muted"><Ltr>{formatWhen(item.created_at, i18n.language)}</Ltr></div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
