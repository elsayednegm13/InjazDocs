const base = process.env.EXPORTFLOW_BASE || "http://127.0.0.1:43176";
const sizes = [1, 80, 100, 200, 500, 1000, 1500];
const rows = [];
for (const size of sizes) {
  const started = Date.now();
  const response = await fetch(`${base}/api/v1/__test/d1-batch-probe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ size, poison: false }),
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  rows.push({ size, poison: false, status: response.status, ms: Date.now() - started, body: text.slice(0, 300) });
}
for (const size of [5, 80, 500]) {
  const started = Date.now();
  const response = await fetch(`${base}/api/v1/__test/d1-batch-probe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ size, poison: true }),
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  rows.push({ size, poison: true, status: response.status, ms: Date.now() - started, body: text.slice(0, 300) });
}
console.log(JSON.stringify(rows, null, 2));
