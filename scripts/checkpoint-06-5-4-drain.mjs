import { mkdirSync, writeFileSync } from "node:fs";

const base = process.env.EXPORTFLOW_BASE || "http://127.0.0.1:43179";
const outDir = "docs/performance/checkpoint-06-5-4";
mkdirSync(outDir, { recursive: true });

async function snapshot() {
  const response = await fetch(`${base}/api/v1/__test/reminder-drain`);
  if (!response.ok) throw new Error(`drain snapshot ${response.status}`);
  const payload = await response.json();
  return { at: new Date().toISOString(), ...payload.data };
}

const ticks = [];
let previousEligible = (await snapshot()).eligible;
for (let tick = 1; tick <= 40; tick += 1) {
  const before = await snapshot();
  const started = Date.now();
  let http = { status: 0, ms: 0 };
  try {
    const response = await fetch(`${base}/cdn-cgi/local/scheduled`, { signal: AbortSignal.timeout(120000) });
    http = { status: response.status, ms: Date.now() - started, body: (await response.text()).slice(0, 80) };
  } catch (error) {
    http = { status: 0, ms: Date.now() - started, body: error instanceof Error ? error.name : "error" };
  }
  let after = await snapshot();
  const settleDeadline = Date.now() + 15000;
  while (Date.now() < settleDeadline && after.deliveries === before.deliveries && before.eligible > 0) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    after = await snapshot();
  }
  const row = {
    tick,
    utc: new Date().toISOString(),
    beforeEligible: before.eligible,
    afterEligible: after.eligible,
    beforeDeliveries: before.deliveries,
    afterDeliveries: after.deliveries,
    duplicateCycles: after.duplicateCycles,
    http,
  };
  ticks.push(row);
  console.log(JSON.stringify(row));
  writeFileSync(`${outDir}/cron-ticks.json`, JSON.stringify(ticks, null, 2));
  if (before.eligible === 0 && after.deliveries === before.deliveries && tick > 1 && previousEligible === 0) break;
  previousEligible = after.eligible;
  if (http.status !== 200) break;
}
console.log(JSON.stringify({ done: true, ticks: ticks.length, last: ticks.at(-1) }));
