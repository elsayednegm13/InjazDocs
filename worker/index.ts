import { boosthisEntryPoint, withBoosthis } from "@workspace/boosthis-edge";
import { createApp, handleScheduled } from "../server/http/app";

const app = createApp();

export default withBoosthis(
  {
    fetch(request: Request, env: Env, ctx: ExecutionContext) {
      return app.fetch(request, env, ctx);
    },
    scheduled: boosthisEntryPoint(
      "scheduled",
      async (_controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
        ctx.waitUntil(handleScheduled(env));
      },
      { appName: "ExportFlow", job: "minute" },
    ),
  },
  { appName: "ExportFlow" },
);
