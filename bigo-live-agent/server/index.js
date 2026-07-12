import express from "express";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import {
  clearStaleJobs,
  listJobs,
  createJob,
  getJob,
  getJobChats,
  getJobLogs,
  getActiveJob,
} from "./db.js";
import { startBigoAgent, stopBigoAgent, setLogBroadcaster } from "./jobRunner.js";
import { getProxyPublicConfig } from "./nodemaven-proxy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

const app = express();
app.use(express.json());
app.use(express.static(publicDir));

// Clean up any stale active jobs from previous runs
clearStaleJobs();

// Store active SSE connections
const sseClients = new Map(); // jobId -> Set of res objects

setLogBroadcaster((jobId, data) => {
  const clients = sseClients.get(jobId);
  if (clients) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      res.write(payload);
    }
  }
});

// ── REST API ─────────────────────────────────────────────────────

app.get("/api/health", (req, res) => {
  const proxyConf = getProxyPublicConfig();
  const activeJob = getActiveJob();
  res.json({
    status: "ok",
    proxy: proxyConf,
    activeJobId: activeJob ? activeJob.id : null,
  });
});

app.get("/api/jobs", (req, res) => {
  try {
    const jobs = listJobs();
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/jobs", async (req, res) => {
  const { room_id, proxy_mode } = req.body || {};
  if (!room_id) {
    return res.status(400).json({ error: "room_id is required" });
  }

  // Check if there is already an active job
  const active = getActiveJob();
  if (active) {
    return res.status(400).json({ error: `Job ${active.id} is already active` });
  }

  try {
    const jobId = createJob({
      roomId: room_id.trim(),
      proxyMode: !!proxy_mode,
    });
    
    // Launch the agent
    startBigoAgent(jobId);

    res.json({ success: true, jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/jobs/:id/stop", async (req, res) => {
  const jobId = parseInt(req.params.id);
  try {
    await stopBigoAgent(jobId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/jobs/:id/chats", (req, res) => {
  const jobId = parseInt(req.params.id);
  try {
    const chats = getJobChats(jobId);
    res.json(chats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/jobs/:id/logs", (req, res) => {
  const jobId = parseInt(req.params.id);
  try {
    const logs = getJobLogs(jobId);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SSE Event Stream for live progress
app.get("/api/jobs/:id/stream", (req, res) => {
  const jobId = parseInt(req.params.id);
  
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  if (!sseClients.has(jobId)) {
    sseClients.set(jobId, new Set());
  }
  sseClients.get(jobId).add(res);

  req.on("close", () => {
    const clients = sseClients.get(jobId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        sseClients.delete(jobId);
      }
    }
  });
});

// SPA Fallback
app.get("*", (req, res) => {
  res.sendFile(join(publicDir, "index.html"));
});

const PORT = config.port;
app.listen(PORT, () => {
  console.log(`\n  🤖 Bigo Live Chat Agent OS -> http://localhost:${PORT}`);
  console.log(`  Proxy settings loaded: ${getProxyPublicConfig().configured ? "YES" : "NO"}`);
});
