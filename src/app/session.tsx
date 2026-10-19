import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SessionContext, type SessionUser } from "@/app/session-context";
import { api } from "@/lib/api";

export type { SessionUser };

export function SessionProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await api<SessionUser>("/api/v1/me")).data,
    retry: false,
  });
  if (query.isPending) return <div className="p-8 text-ink-muted">Loading workspace…</div>;
  return <SessionContext.Provider value={query.data ?? null}>{children}</SessionContext.Provider>;
}

