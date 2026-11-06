# ExportFlow — Agent Entry Point

> This pointer is for AI coding tools that automatically discover `AGENTS.md` in a repository root.
>
> `HANDOFF.MD` is the committed handoff. `AGANT.MD` is a local filename variant and is not the committed source. This file is the agent entry point, not another project plan.

1. **Read [`HANDOFF.MD`](./HANDOFF.MD) in full.** It states the evidenced checkpoint, what has and has not been tested, owner decisions and the safe starting point. A local untracked copy of the longer charter may exist as `AGANT.MD`; that filename is not the committed source.
2. Verify dated claims against current source and the exact owner-approved task scope; do not infer that an older report is still today's state.
3. **Do not start Wrangler, Vite, Playwright or a Cloudflare plugin build** until isolation through subprocess shutdown is proven. Preserve `.wrangler/state`, `.dev.vars*`, historical fixtures, external resources and all unrelated projects.
4. Migrations `0001` through `0016` are in the repository. The 2026-10-23 handoff counts are historical and are not a current end-to-end or production approval. Remote migration and deploy still require an explicit owner request.
5. Document work and report findings to the owner **in Arabic**. Propose next work but **STOP** after the specifically authorized phase.

**Creation of these documents is not authorization for an engineering checkpoint.**
