import { listEnabledSources, updateSource } from "./db.js";
import { enqueueSourceJob } from "./jobRunner.js";
import { broadcastGlobal } from "./sse.js";

const TICK_MS = 60 * 1000;
let timer = null;

export function computeNextRun(from, value, unit) {
  const d = new Date(from);
  const n = Math.max(1, Number(value) || 1);
  if (unit === "hours") d.setHours(d.getHours() + n);
  else if (unit === "days") d.setDate(d.getDate() + n);
  else if (unit === "months") d.setMonth(d.getMonth() + n);
  else d.setHours(d.getHours() + n);
  return d.toISOString();
}

// Match one cron field (min/hour/dom/month/dow) against a value. Supports
// *, lists (a,b), ranges (a-b), and steps (*/n or a-b/n).
function fieldMatches(field, value, min, max) {
  if (field === "*") return true;
  for (const part of field.split(",")) {
    const [range, stepRaw] = part.split("/");
    const step = stepRaw ? Number(stepRaw) : 1;
    let lo = min, hi = max;
    if (range !== "*") {
      const [a, b] = range.split("-");
      lo = Number(a);
      hi = b !== undefined ? Number(b) : Number(a);
    }
    if (value < lo || value > hi) continue;
    if ((value - lo) % step === 0) return true;
  }
  return false;
}

export function cronMatches(expr, date) {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return false;
  return (
    fieldMatches(f[0], date.getMinutes(), 0, 59) &&
    fieldMatches(f[1], date.getHours(), 0, 23) &&
    fieldMatches(f[2], date.getDate(), 1, 31) &&
    fieldMatches(f[3], date.getMonth() + 1, 1, 12) &&
    fieldMatches(f[4], date.getDay(), 0, 6)
  );
}

// Next minute (strictly after `from`) matching the cron expr. Scans up to ~7
// days, which covers daily/weekly schedules; returns null if none found.
export function nextCronRun(expr, from = new Date()) {
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 7 * 24 * 60; i++) {
    if (cronMatches(expr, d)) return d.toISOString();
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

// Unified next-run for a source: cron expression wins, else the interval.
function nextRunFor(source, from = new Date()) {
  if (source.cron_expression) {
    return nextCronRun(source.cron_expression, from) ||
      computeNextRun(from, source.interval_value, source.interval_unit);
  }
  return computeNextRun(from, source.interval_value, source.interval_unit);
}

function tick() {
  const now = Date.now();
  for (const source of listEnabledSources()) {
    const due = !source.next_run_at || new Date(source.next_run_at).getTime() <= now;
    if (!due) continue;
    updateSource(source.id, { next_run_at: nextRunFor(source, new Date()) });
    try {
      enqueueSourceJob(source.id, "scheduled");
      broadcastGlobal({ type: "scheduler", message: `Scheduled scrape: ${source.name}`, sourceId: source.id });
    } catch (err) {
      broadcastGlobal({ type: "scheduler", level: "error", message: `Scheduler error: ${err.message}` });
    }
  }
}

// Ensure every enabled source has a next_run_at so the UI can show it.
export function primeSchedule() {
  for (const source of listEnabledSources()) {
    if (!source.next_run_at) {
      updateSource(source.id, { next_run_at: nextRunFor(source, new Date()) });
    }
  }
}

export function startScheduler() {
  if (timer) return;
  primeSchedule();
  timer = setInterval(tick, TICK_MS);
  console.log(`  Scheduler armed · tick every ${TICK_MS / 1000}s`);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
