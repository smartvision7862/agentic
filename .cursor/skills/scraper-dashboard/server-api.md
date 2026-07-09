# Dashboard Server API (Pattern A)

Default Express backend for job-queue dashboards. Vanilla `public/` SPA frontend.

## Project structure

```
server/
  index.js          # Express routes + static public/
  config.js         # PORT from env
  db.js             # SQLite CRUD
  jobRunner.js      # Queue, SSE, scrape orchestration
  jobControl.js     # AbortController cancel (optional)
  nodemaven-proxy.js
public/
  index.html
  styles.css
  app.js
```

## config.js

```js
import { loadProxyEnv } from "./nodemaven-proxy.js";
loadProxyEnv();

export const config = {
  port: Number(process.env.PORT ?? 3950),
  maxParallelJobs: Number(process.env.MAX_PARALLEL_JOBS ?? 3),
};
```

## REST endpoints

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/health` | `{ ok, time, proxy, maxParallelJobs }` |
| GET | `/api/proxy/status` | `getProxyPublicConfig()` — no secrets |
| POST | `/api/jobs` | Enqueue job — body: `{ query, count, proxyMode, ... }` |
| GET | `/api/jobs` | List recent jobs (for history panel) |
| GET | `/api/jobs/:id` | Job + results + logs |
| GET | `/api/jobs/:id/stream` | SSE live updates |
| POST | `/api/jobs/:id/cancel` | Cancel running job |
| GET | `/api/jobs/:id/export.csv` | CSV download |
| GET | `*` | SPA fallback → `public/index.html` |

## index.js skeleton

```js
import express from "express";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { listJobs, getJobWithDetails } from "./db.js";
import { enqueueJob, subscribe, cancelJob } from "./jobRunner.js";
import { getProxyPublicConfig, isProxyConfigured } from "./nodemaven-proxy.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(ROOT, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), proxy: getProxyPublicConfig(), maxParallelJobs: config.maxParallelJobs });
});

app.get("/api/proxy/status", (_req, res) => res.json(getProxyPublicConfig()));

app.post("/api/jobs", (req, res) => {
  const query = String(req.body?.query ?? "").trim();
  if (!query || query.length < 2) return res.status(400).json({ error: "Query required" });
  if (req.body?.proxyMode && !isProxyConfigured()) {
    return res.status(400).json({ error: "Proxy not configured", reason: "Set NODEMAVEN_API_KEY in .env" });
  }
  const job = enqueueJob(req.body);
  res.status(201).json(job);
});

app.get("/api/jobs", (_req, res) => res.json(listJobs(50)));
app.get("/api/jobs/:id", (req, res) => {
  const job = getJobWithDetails(req.params.id);
  if (!job) return res.status(404).json({ error: "Not found" });
  res.json(job);
});

app.get("/api/jobs/:id/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  subscribe(req.params.id, res);
});

app.post("/api/jobs/:id/cancel", (req, res) => {
  const ok = cancelJob(req.params.id);
  res.json({ ok });
});

app.get("/api/jobs/:id/export.csv", (req, res) => {
  // Generate CSV from job results
});

app.get("*", (_req, res) => res.sendFile(join(ROOT, "public", "index.html")));

app.listen(config.port, () => {
  console.log(`\n  Dashboard → http://localhost:${config.port}\n`);
});
```

## jobRunner.js essentials

```js
import { v4 as uuidv4 } from "uuid";
import { createJob, updateJob, addLog, getJobWithDetails } from "./db.js";

const listeners = new Map();
const queue = [];
let activeCount = 0;

// Recover stale jobs on server start
function recoverStaleJobs() { /* mark pending/running → cancelled */ }
recoverStaleJobs();

export function subscribe(jobId, res) {
  if (!listeners.has(jobId)) listeners.set(jobId, new Set());
  listeners.get(jobId).add(res);
  res.on("close", () => listeners.get(jobId)?.delete(res));
}

function broadcast(jobId, payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of listeners.get(jobId) ?? []) {
    try { res.write(data); } catch { /* client gone */ }
  }
}

function log(jobId, level, message, detail = null) {
  const row = addLog(jobId, level, message, detail);
  broadcast(jobId, { type: "log", log: row });
}

export function enqueueJob(body) {
  const id = uuidv4();
  createJob({ id, query: body.query, proxyMode: body.proxyMode ? 1 : 0, createdAt: new Date().toISOString() });
  log(id, "info", "Job queued");
  queue.push({ id, body });
  drainQueue();
  return getJobWithDetails(id);
}

async function drainQueue() {
  if (activeCount >= config.maxParallelJobs || !queue.length) return;
  activeCount++;
  const { id, body } = queue.shift();
  updateJob(id, { status: "running", started_at: new Date().toISOString() });
  try {
    await runScrape(id, body);
    updateJob(id, { status: "completed", finished_at: new Date().toISOString() });
    broadcast(id, { type: "done" });
  } catch (err) {
    updateJob(id, { status: "failed", failure_reason: err.message, finished_at: new Date().toISOString() });
    log(id, "error", "Job failed", err.message);
    broadcast(id, { type: "done" });
  } finally {
    activeCount--;
    drainQueue();
  }
}

export function cancelJob(id) {
  // Set abort flag; update status to cancelled
  return true;
}
```

## SSE message types

| type | Payload | Frontend action |
|------|---------|-----------------|
| `log` | `{ log: { level, message, detail, created_at } }` | `appendLog()` |
| `progress` | `{ collected, total, ... }` | Update stat cards |
| `<domain>` | `{ place, file, company, ... }` | Append to results table/gallery |
| `proxy-rotation` | `{ site, usernameMasked }` | Log panel info |
| `proxy-ip` | `{ ip, city, country }` | Log panel success |
| `done` | `{}` | Close EventSource, re-fetch job |

## package.json

```json
{
  "type": "module",
  "scripts": {
    "start": "node server/index.js",
    "dev": "node --watch server/index.js",
    "test:proxy": "node scripts/test-proxy.js"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "express": "^4.21.0",
    "puppeteer": "^24.0.0",
    "uuid": "^11.0.0"
  }
}
```

## Pattern B — React Extract OS (only when user asks)

Single long-lived SSE on `GET /api/extract/stream?query=...&filters=...`

- Dev: `concurrently` runs `node server/index.js` + `vite --config dashboard/vite.config.js`
- Prod: `vite build` then `express.static(dashboard/dist)`
- History: JSON files, not SQLite
- See job-scraper-test architecture only on explicit user request
