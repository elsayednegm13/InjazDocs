import { useContext } from "react";
import { SessionContext, type SessionUser } from "@/app/session-context";

export function can(user: SessionUser | null, key: string) {
  return Boolean(user?.permissions.includes(key));
}

export function useSession() {
  return useContext(SessionContext);
}
