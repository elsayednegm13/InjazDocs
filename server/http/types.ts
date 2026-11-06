import type { createAuth } from "../auth";
import type { Actor } from "../services/actor";

export type AppEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
    actor: Actor;
    sessionId: string;
  };
};

export type AppDependencies = {
  /**
   * Test-only injection point. Production calls `createApp()` and therefore
   * cannot enable any fault path from a header, query or remote request.
   */
  createAuth?: typeof createAuth;
  failBootstrapCompensation?: boolean;
  failUserCompensation?: boolean;
};
