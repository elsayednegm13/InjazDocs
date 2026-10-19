const base = "http://127.0.0.1:43176";

async function run(label, count, gapMs, body) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    if (gapMs) await new Promise((resolve) => setTimeout(resolve, gapMs));
    const started = Date.now();
    const response = await fetch(`${base}/api/v1/__test/d1-batch-probe`, {
      method: "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    rows.push({ i, status: response.status, ms: Date.now() - started, bad: text.includes("fetch failed") });
  }
  return { label, bad: rows.filter((row) => row.bad).length, count, rows };
}

const report = [
  await run("gap-300-json", 10, 300, JSON.stringify({ size: 1 })),
  await run("gap-0-empty", 10, 0, ""),
];
console.log(JSON.stringify(report, null, 2));
