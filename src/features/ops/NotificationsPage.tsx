import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { EmptyState, Ltr, PageHeader } from "@/components/ui/chrome";
import { SkeletonCardList } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatWhen, useCopy } from "@/lib/copy";
import { notifyError } from "@/lib/notify";

export function NotificationsPage() {
  const { tx, stored, i18n } = useCopy();
  const client = useQueryClient();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await api<Array<Record<string, string | number>>>("/api/v1/notifications")).data,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    staleTime: 15_000,
  });
  const read = useMutation({
    mutationFn: (id: string | number) => api(`/api/v1/notifications/${id}/read`, { method: "POST" }),
    onMutate: async (id) => {
      await client.cancelQueries({ queryKey: ["notifications"] });
      const previous = client.getQueriesData<Array<Record<string, string | number>>>({ queryKey: ["notifications"] });
      client.setQueriesData<Array<Record<string, string | number>>>({ queryKey: ["notifications"] }, (rows) =>
        rows?.map((row) => (String(row.id) === String(id) ? { ...row, is_read: 1 } : row)),
      );
      return { previous };
    },
    onError: (error, _id, context) => {
      context?.previous.forEach(([key, data]) => client.setQueryData(key, data));
      notifyError(error);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
  const rows = query.data ?? [];
  const unread = rows.filter((row) => Number(row.is_read) === 0).length;
  return (
    <div className="space-y-4" data-notifications={query.isLoading ? "loading" : "ready"}>
      <PageHeader
        title={tx("notifications", "Notifications")}
        subtitle={unread ? tx("notificationsUnread", "Unread notifications are highlighted; opening one marks it as read.") : tx("inboxEmpty", "Inbox is empty.")}
      />
      {query.isLoading ? <SkeletonCardList rows={4} /> : null}
      <div className="grid gap-3">
        {rows.map((row) => {
          const isRead = Number(row.is_read) === 1;
          return (
            <Button
              key={String(row.id)}
              type="button"
              variant="ghost"
              onClick={() => {
                read.mutate(row.id);
                navigate(`/export-cases/${String(row.case_id)}`);
              }}
              className={`h-auto w-full items-start justify-start gap-3 rounded-card border bg-card p-4 text-start font-normal shadow-card hover:bg-card hover:border-accent/40 ${isRead ? "border-line opacity-80" : "border-accent/30"}`}
            >
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${isRead ? "bg-line" : "bg-accent"}`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-ink"><Ltr>{String(row.case_reference)}</Ltr></span>
                  <span className="text-[11px] text-ink-muted"><Ltr>{formatWhen(String(row.created_at), i18n.language)}</Ltr></span>
                </span>
                <span className="mt-1 block text-sm text-ink">{stored(String(row.reason))}</span>
                <span className="mt-0.5 block text-xs text-ink-muted">{stored(String(row.next_action))}</span>
              </span>
              {isRead ? null : <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">{tx("new", "New")}</span>}
            </Button>
          );
        })}
      </div>
      {!query.isLoading && !rows.length ? <EmptyState>{tx("inboxEmpty", "Inbox is empty.")}</EmptyState> : null}
    </div>
  );
}
