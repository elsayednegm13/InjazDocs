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
