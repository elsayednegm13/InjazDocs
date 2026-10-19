const base = "http://127.0.0.1:43176";

async function serial(count) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const started = Date.now();
    const response = await fetch(`${base}/api/v1/__test/d1-batch-probe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ size: 1 }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    rows.push({ i, status: response.status, ms: Date.now() - started, bad: text.includes("fetch failed") });
  }
  return { mode: "serial", bad: rows.filter((row) => row.bad).length, count, rows };
}

async function parallel(count) {
  const rows = await Promise.all(Array.from({ length: count }, async (_, i) => {
    const started = Date.now();
    const response = await fetch(`${base}/api/v1/__test/d1-batch-probe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ size: 1 }),
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    return { i, status: response.status, ms: Date.now() - started, bad: text.includes("fetch failed") };
  }));
  return { mode: "parallel", bad: rows.filter((row) => row.bad).length, count, rows };
}

console.log(JSON.stringify({ serial: await serial(20), parallel: await parallel(8) }, null, 2));
