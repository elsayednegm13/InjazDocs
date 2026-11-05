import { useQuery } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { SessionContext, type SessionUser } from "@/app/session-context";
import { api, setApiSessionScope } from "@/lib/api";
import { SkeletonRegion, Skeleton } from "@/components/ui/skeleton";

export type { SessionUser };

export function SessionProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await api<SessionUser>("/api/v1/me")).data,
    retry: false,
  });
  const userId = query.data?.id ?? "anonymous";
  useEffect(() => {
    // Keep the in-flight mutation map bound to the signed-in user.
    setApiSessionScope(userId);
  }, [userId]);
  if (query.isPending) {
    return (
      <SkeletonRegion label="Loading workspace" className="min-h-screen space-y-4 p-4 md:p-6">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28 rounded-2xl" />
          ))}
        </div>
      </SkeletonRegion>
    );
  }
  return <SessionContext.Provider value={query.data ?? null}>{children}</SessionContext.Provider>;
}

