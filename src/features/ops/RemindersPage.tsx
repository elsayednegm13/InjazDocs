import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { EmptyState, Ltr, PageHeader } from "@/components/ui/chrome";
import { StatusBadge } from "@/components/ui/status";
import { SkeletonCardList } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatWhen, useCopy } from "@/lib/copy";
import { notifyError, notifySuccess } from "@/lib/notify";

import { FilterChip } from "./ops-parts";

function dueTile(value: string | null | undefined, language: string) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return { day: "—", month: "", time: "" };
  const locale = language.startsWith("ar") ? "ar-EG-u-nu-latn" : "en-GB";
  return {
    day: new Intl.DateTimeFormat(locale, { day: "2-digit" }).format(date),
    month: new Intl.DateTimeFormat(locale, { month: "short" }).format(date),
    time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date),
  };
}

const REMINDER_FILTERS = ["open", "overdue", "snoozed", "resolved"] as const;

export function RemindersPage() {
  const { tx, stored, i18n } = useCopy();
  const client = useQueryClient();
  const [filter, setFilter] = useState<string>("open");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const query = useQuery({
    queryKey: ["reminders", filter],
    queryFn: async () => (await api<Array<Record<string, string>>>(`/api/v1/reminders?filter=${filter}`)).data,
    placeholderData: keepPreviousData,
  });
  const snooze = useMutation({
    mutationFn: (input: { id: string; until: string }) =>
      api(`/api/v1/reminders/${input.id}/snooze`, { method: "POST", body: JSON.stringify({ until: input.until }) }),
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: ["reminders"] });
      const previous = client.getQueriesData<Array<Record<string, string>>>({ queryKey: ["reminders"] });
      client.setQueriesData<Array<Record<string, string>>>({ queryKey: ["reminders"] }, (rows) =>
        rows?.map((row) => (row.id === input.id ? { ...row, status: "SNOOZED", snoozed_until: input.until } : row)),
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      context?.previous.forEach(([key, data]) => client.setQueryData(key, data));
      notifyError(error);
    },
    onSuccess: () => notifySuccess(tx("reminderSnoozed", "Reminder snoozed")),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["reminders"] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  const rows = query.data ?? [];
  return (
    <div className="space-y-4" data-reminders={query.isLoading ? "loading" : "ready"}>
      <PageHeader title={tx("reminders", "Reminders")} subtitle={tx("remindersHint", "Snoozing applies immediately; the list stays live without a refresh.")} />
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-card p-3 shadow-[var(--shadow-card)]">
        {REMINDER_FILTERS.map((value) => (
          <FilterChip key={value} active={filter === value} onClick={() => setFilter(value)}>
            {tx(value, value)}
          </FilterChip>
        ))}
        <span className="ms-auto text-xs tabular-nums text-ink-muted"><Ltr>{rows.length}</Ltr></span>
      </div>
      {query.isLoading ? (
        <SkeletonCardList rows={4} />
      ) : null}
      <div className="grid gap-3">
        {rows.map((row) => {
          const overdue = row.status === "ACTIVE" && row.due_at ? new Date(row.due_at).getTime() < now : false;
          const busy = snooze.isPending && snooze.variables?.id === row.id;
          const tile = dueTile(row.due_at, i18n.language);
          return (
            <article key={row.id} className={`rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)] transition ${overdue ? "border-danger/40" : "border-line"} ${busy ? "opacity-70" : ""}`}>
              <div className="flex gap-3">
                <div className={`grid h-16 w-16 shrink-0 place-items-center rounded-xl border text-center ${overdue ? "border-danger/30 bg-danger/5" : "border-line bg-paper/70"}`}>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{tile.month}</span>
                  <span className="text-lg font-semibold leading-none tabular-nums text-ink">{tile.day}</span>
                  <span className="text-[11px] text-ink-muted"><Ltr>{tile.time}</Ltr></span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link className="text-sm font-semibold text-accent" to={`/export-cases/${row.case_id}`}><Ltr>{row.case_reference}</Ltr></Link>
                    <StatusBadge value={row.status} />
                    {overdue ? <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-semibold text-danger">{tx("overdue", "Overdue")}</span> : null}
                  </div>
                  <p className="mt-2 font-medium text-ink">{stored(row.reason)}</p>
                  <p className="mt-0.5 text-sm text-ink-muted">{stored(row.next_action)}</p>
                  {row.status === "SNOOZED" ? (
                    <p className="mt-2 text-xs text-ink-muted">{tx("snoozedUntil", "Snoozed until")} <Ltr>{formatWhen(row.snoozed_until, i18n.language)}</Ltr></p>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[1, 3].map((days) => (
                        <Button
                          key={days}
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => snooze.mutate({ id: row.id, until: new Date(Date.now() + days * 86400000).toISOString() })}
                        >
                          {i18n.language.startsWith("ar") ? `${tx("snooze", "Snooze")} ${days} ${tx("days", "days")}` : `Snooze ${days}d`}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {!query.isLoading && !rows.length ? <EmptyState>{tx("noRemindersView", "No reminders in this view.")}</EmptyState> : null}
    </div>
  );
}
