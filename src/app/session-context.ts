import { createContext } from "react";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  mustChangePassword: boolean;
  permissions: string[];
  roles: string[];
};

export const SessionContext = createContext<SessionUser | null>(null);

/** True only while the first session read has not settled. Default is ready, so a missing provider does not lock the tree. */
export const SessionPendingContext = createContext(false);
