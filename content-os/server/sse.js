// Per-job SSE subscribers plus a global "firehose" channel so the dashboard
// can show live scheduler activity without watching one specific job.
const jobListeners = new Map();
const globalListeners = new Set();

export function subscribeJob(jobId, res) {
  if (!jobListeners.has(jobId)) jobListeners.set(jobId, new Set());
  jobListeners.get(jobId).add(res);
  res.write(`data: ${JSON.stringify({ type: "connected", jobId })}\n\n`);
  res.on("close", () => jobListeners.get(jobId)?.delete(res));
}

export function subscribeGlobal(res) {
  globalListeners.add(res);
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  res.on("close", () => globalListeners.delete(res));
}

export function broadcastJob(jobId, payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of jobListeners.get(jobId) ?? []) {
    try { res.write(data); } catch { /* client gone */ }
  }
  // Mirror to the global channel with job context attached.
  broadcastGlobal({ ...payload, jobId });
}

export function broadcastGlobal(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of globalListeners) {
    try { res.write(data); } catch { /* client gone */ }
  }
}
