import { readFileSync, writeFileSync } from "node:fs";

const data = JSON.parse(readFileSync("docs/performance/checkpoint-06-4/comparison.json", "utf8"));
const lines = ["scenario,dataset,environment,viewport,phase,metric,unit,N,median,p95,minimum,maximum,failures,source_file,notes"];
const envOf = {
  "dev-large": "LOCAL DEV",
  "dev-large-after": "LOCAL DEV",
  "dev-medium-after": "LOCAL DEV",
  "dev-small-after": "LOCAL DEV",
  "built-large": "LOCAL BUILT",
};
const phaseOf = {
  "dev-large": "before",
  "dev-large-after": "after",
  "dev-medium-after": "after-only",
  "dev-small-after": "after-only",
  "built-large": "after",
};
for (const [file, row] of Object.entries(data)) {
  for (const [route, stat] of Object.entries(row.routes)) {
    lines.push([
      route,
      row.dataset,
      envOf[file],
      "api",
      phaseOf[file],
      "client_wall_ms",
      "ms",
      stat.n,
      stat.p50,
      stat.p95 ?? "",
      stat.min,
      stat.max,
      stat.failures,
      `docs/performance/checkpoint-06-4/${file}.json`,
      `resets=${stat.resets}`,
    ].join(","));
  }
}
writeFileSync("docs/performance/checkpoint-06-4/api-summary.csv", `${lines.join("\n")}\n`);
console.log(JSON.stringify({ rows: lines.length - 1 }));
