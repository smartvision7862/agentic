# Storage Patterns for Dashboard Projects

## Decision tree

```
Dashboard requested?
├── Yes → SQLite (default) + output/ exports
└── No  → See scraper-script (files or JSON only)

Output type?
├── Tabular results (rows)     → SQLite domain table + CSV export
├── Binary files (images/PDFs) → storage/downloads/{jobId}/
├── Run metadata only          → jobs + activity_logs tables
└── Simple history, no queue   → output/history/*.json (Pattern B)
```

## Pattern A — SQLite job queue (default dashboard)

**Use when:** job history, live logs, cancel/retry, export from UI.

```
data/
  dashboard.sqlite    # or maps.sqlite, hr-finder.sqlite
output/
  exports/            # generated CSV files
storage/              # optional binary downloads
```

### Core schema

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  collected_count INTEGER DEFAULT 0,
  failure_reason TEXT,
  export_csv TEXT,
  proxy_mode INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

-- Domain table — rename and extend per project:
CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  title TEXT,
  url TEXT,
  data_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_logs_job ON activity_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_results_job ON results(job_id);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);
```

### db.js essentials

```js
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(ROOT, "data"), { recursive: true });
mkdirSync(join(ROOT, "output", "exports"), { recursive: true });

const db = new Database(join(ROOT, "data", "dashboard.sqlite"));
db.pragma("journal_mode = WAL");

// Run schema CREATE TABLE statements here

export function createJob(row) { /* INSERT */ }
export function updateJob(id, fields) { /* UPDATE */ }
export function addLog(jobId, level, message, detail = null) { /* INSERT + return row */ }
export function listJobs(limit = 50) { /* SELECT ORDER BY created_at DESC */ }
export function getJobWithDetails(id) { /* JOIN results + logs */ }
```

### Job statuses

`pending` → `running` → `completed` | `failed` | `cancelled` | `partial`

On server start, mark stale `pending`/`running` jobs as `cancelled`.

## Pattern B — JSON run history (React Extract OS)

**Use when:** user explicitly wants React + Vite filter-heavy UI, single long-lived SSE extract.

```
output/history/{runId}.json
output/settings.json          # optional user prefs
```

```js
// src/history-store.js
import { writeFileSync, readFileSync, readdirSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const DIR = join("output", "history");
mkdirSync(DIR, { recursive: true });

export function saveRun(data) {
  const id = randomUUID();
  writeFileSync(join(DIR, `${id}.json`), JSON.stringify({ id, ...data, createdAt: new Date().toISOString() }, null, 2));
  return id;
}

export function getRun(id) {
  return JSON.parse(readFileSync(join(DIR, `${id}.json`), "utf8"));
}

export function listRuns(limit = 30) {
  return readdirSync(DIR).filter((f) => f.endsWith(".json")).slice(0, limit).map((f) => getRun(f.replace(".json", "")));
}
```

## Binary file storage

For download/gallery dashboards:

```
storage/downloads/{jobId}/{filename}
```

Serve via: `GET /api/files/:jobId/:filename`

Store metadata in SQLite `downloaded_files` table with `filename`, `status`, `file_size`, `source_platform`.

## CSV export

Generate on job complete or on demand:

```js
// GET /api/jobs/:id/export.csv
import { mapsResultsToCsv } from "../src/csv-export.js";
res.setHeader("Content-Type", "text/csv");
res.setHeader("Content-Disposition", `attachment; filename="export-${id}.csv"`);
res.send(mapsResultsToCsv(results));
```

Also save path in `jobs.export_csv` for history re-download.

## Dependencies

| Pattern | npm packages |
|---------|-------------|
| Pattern A | `better-sqlite3`, `uuid`, `express`, `puppeteer` |
| Pattern B | `express`, `puppeteer`, `cors` + React/Vite dev deps |
