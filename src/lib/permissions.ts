import { useMemo } from "react";
import type { PermissionKey } from "@shared/permissions";
import { useSession } from "@/app/access";

export function usePermissions() {
  const user = useSession();
  const permissions = useMemo(() => new Set<string>(user?.permissions ?? []), [user?.permissions]);

  return useMemo(
    () => ({
      user,
      permissions,
      has: (key: PermissionKey | string) => permissions.has(key),
      hasAny: (keys: ReadonlyArray<PermissionKey | string>) => keys.some((k) => permissions.has(k)),
      hasAll: (keys: ReadonlyArray<PermissionKey | string>) => keys.every((k) => permissions.has(k)),
    }),
    [user, permissions],
  );
}

