const base = process.env.EXPORTFLOW_BASE || "http://127.0.0.1:43176";

async function burst(label, count, gapMs) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    if (gapMs) await new Promise((resolve) => setTimeout(resolve, gapMs));
    const started = Date.now();
    try {
      const response = await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(15000) });
      const text = await response.text();
      rows.push({
        i,
        status: response.status,
        ms: Date.now() - started,
        transport: text.includes("fetch failed") ? "PRE_HANDLER_HTML" : "HTTP",
      });
    } catch (error) {
      const cause = error instanceof Error && error.cause && typeof error.cause === "object" && "code" in error.cause ? String(error.cause.code) : "";
      rows.push({ i, status: 0, ms: Date.now() - started, transport: `${error instanceof Error ? error.name : "error"}:${cause}` });
    }
  }
  const bad = rows.filter((row) => row.transport !== "HTTP" || row.status >= 500).length;
  return { label, count, gapMs, bad, rows };
}

async function postBurst(label, count) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const started = Date.now();
    try {
      const response = await fetch(`${base}/api/v1/__test/d1-batch-probe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ size: 1 }),
        signal: AbortSignal.timeout(15000),
      });
      const text = await response.text();
      rows.push({
        i,
        status: response.status,
        ms: Date.now() - started,
        transport: text.includes("fetch failed") ? "PRE_HANDLER_HTML" : "HTTP",
      });
    } catch (error) {
      const cause = error instanceof Error && error.cause && typeof error.cause === "object" && "code" in error.cause ? String(error.cause.code) : "";
      rows.push({ i, status: 0, ms: Date.now() - started, transport: `${error instanceof Error ? error.name : "error"}:${cause}` });
    }
  }
  return { label, count, bad: rows.filter((row) => row.transport !== "HTTP").length, rows };
}

const report = {
  getImmediate: await burst("get-immediate", 8, 0),
  postImmediate: await postBurst("post-immediate", 12),
};
console.log(JSON.stringify(report, null, 2));
