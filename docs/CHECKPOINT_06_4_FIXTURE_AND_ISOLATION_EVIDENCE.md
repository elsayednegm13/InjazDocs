# Checkpoint 06.4 fixture and isolation evidence

Seed name: `checkpoint-06-4-v1`. Generator: `scripts/checkpoint-06-4-seed.mjs`. Randomness is limited to three tracking tokens stored only in `.wrangler-perf/tracks.json`. Names are `Perf Customer NN`, `PF-2026-NNNN`, `Synthetic Bank`, last4 `1234` / `5678`. No developer, customer, or bank rows were copied.

Users come from HTTP bootstrap on the perf server, not forged password hashes:

- `perf-admin@example.com` — administrator
- `perf-officer@example.com` — `export_officer`

Even-numbered cases are assigned to the officer. After seeding 500 cases, the officer's case list total was 250 and the page size was 20.

## Paths

| Path | Role |
| --- | --- |
| `.wrangler-perf/state` | Disposable D1 and local R2 persistence |
| `.wrangler-perf/accounts.json` | Generated credentials. Not copied into `docs/` |
| `.wrangler-perf/tracks.json` | Three tokens. Not copied into `docs/` |
| `.wrangler/state` | Developer. Not seeded. |

`scripts/checkpoint-06-4-guard.mjs` rejects a database path that resolves inside `.wrangler` or outside `.wrangler-perf`.

Migrations `0001`–`0004` were applied to the perf store only. The seed refuses to run without `actors.json`.

## Row counts

| Table | small (10) | medium (100) | large (500) |
| --- | --- | --- | --- |
| customers | 4 | 20 | 20 |
| export_cases | 10 | 100 | 500 |
| export_invoices | 10 | 100 | 500 |
| operation_document_requirements | 30 | 300 | 1500 |
| document_versions | 24 | 240 | 1200 |
| bookings | 10 | 100 | 500 |
| containers | 50 | 500 | 2500 |
| reminder_instances | 20 | 200 | 1000 |
| case_events | 30 | 300 | 1500 |
| courier_shipments | 2 | 20 | 100 |
| customer_tracking_links | 3 | 3 | 3 |

Seed time: large 319 ms, medium 531 ms, small 159 ms. Logical rows match the table. The SQLite file was 610304 bytes immediately after the large seed. After later session writes and a reseed, the file stayed about 2.8 MB because deleted pages were not vacuumed. File size is not the row payload.

## Domain shape

Each case rotates through five states that the transition tables already allow: draft/bank preparing, active/bank review, active/direct with courier dispatched, completed/bank documents delivered (with `closed_at`), on-hold/direct. Invoices alternate FOB (invoiced freight 0) and CFR (invoiced freight 15000). Actual freight is 12000 in both cases and is not added into the FOB total. The stored total is goods plus invoiced freight. Gross weight is greater than net. Each case has a commercial invoice, packing list (required), and certificate of origin (optional), with statuses rotating through missing, uploaded, under review, approved, and needs correction. Versions are metadata only (`synthetic.pdf`, 128 bytes, key `perf/synthetic/...`). No R2 object and no large PDF were written.

Each booking has five container slots. Official numbers exist only on slots 0 and 1 (`PFXU######0/1`). UCR is set when the case index is divisible by 3. Planned ETD/ETA are set; actual ETD/ETA are null. Reminders rotate pending, active, snoozed, and resolved, with unique `dedup_key` values. Three tracking links exist; index 1 is revoked. Direct cases in the dispatched and delivered patterns have one manual DHL shipment.

Document bytes were not uploaded. A screen that needs the real file bytes will not open a PDF. List, invoice, booking, and tracking metadata are present.
