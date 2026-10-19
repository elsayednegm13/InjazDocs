const base = process.argv[2];
const arm = process.argv[3] ?? "unknown";
if (!base?.startsWith("http://127.0.0.1:")) throw new Error("Pass a loopback base URL");

async function post() {
  const started = performance.now();
  try {
    const response = await fetch(`${base}/api/v1/auth/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base, "x-bootstrap-secret": "probe-not-the-secret" },
      body: JSON.stringify({ email: "probe@example.com", password: "not-used-password", name: "Probe" }),
    });
    const text = await response.text();
    return { status: response.status, duration_ms: Math.round(performance.now() - started), fetch_failed: text.includes("fetch failed") };
  } catch (error) {
    const cause = error && typeof error === "object" && "cause" in error ? error.cause : undefined;
    const code = cause && typeof cause === "object" && cause && "code" in cause ? String(cause.code) : null;
    return { status: 0, duration_ms: Math.round(performance.now() - started), fetch_failed: true, error_cause_code: code };
  }
}

const gaps = [0, 1100, 5000];
const rows = [];
for (const gap of gaps) {
  if (gap) await new Promise((resolve) => setTimeout(resolve, gap));
  const batch = await Promise.all(Array.from({ length: 8 }, () => post()));
  for (const row of batch) rows.push({ ...row, gap_before_ms: gap });
}
const summary = {
  arm,
  base,
  time_utc: new Date().toISOString(),
  observations: rows.length,
  fetch_failed: rows.filter((row) => row.fetch_failed).length,
  statuses: rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {}),
};
console.log(JSON.stringify({ summary, rows }));
