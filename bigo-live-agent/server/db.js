import Database from "./sqlite.js";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { ROOT_DIR } from "./config.js";

const dataDir = join(ROOT_DIR, "data");
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const dbPath = join(dataDir, "bigo.sqlite");
const db = new Database(dbPath);

// Initialize DB schema
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    messages_count INTEGER DEFAULT 0,
    replies_count INTEGER DEFAULT 0,
    proxy_mode INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    sender TEXT NOT NULL,
    message TEXT NOT NULL,
    reply TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    level TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

export function createJob({ roomId, proxyMode = false }) {
  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO jobs (room_id, status, created_at, proxy_mode)
    VALUES (?, 'active', ?, ?)
  `).run(roomId, now, proxyMode ? 1 : 0);
  return info.lastInsertRowid;
}

export function updateJobStatus(id, status) {
  db.prepare(`UPDATE jobs SET status = ? WHERE id = ?`).run(status, id);
}

export function incrementJobStats(id, isReply = false) {
  if (isReply) {
    db.prepare(`UPDATE jobs SET replies_count = replies_count + 1 WHERE id = ?`).run(id);
  } else {
    db.prepare(`UPDATE jobs SET messages_count = messages_count + 1 WHERE id = ?`).run(id);
  }
}

export function addChatMessage({ jobId, sender, message, reply }) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO chats (job_id, sender, message, reply, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(jobId, sender, message, reply || null, now);
}

export function addActivityLog({ jobId, message, level = "info" }) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO activity_logs (job_id, message, level, created_at)
    VALUES (?, ?, ?, ?)
  `).run(jobId, message, level, now);
}

export function listJobs() {
  return db.prepare(`SELECT * FROM jobs ORDER BY id DESC LIMIT 50`).all();
}

export function getJob(id) {
  return db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id);
}

export function getJobChats(jobId) {
  return db.prepare(`SELECT * FROM chats WHERE job_id = ? ORDER BY id DESC`).all(jobId);
}

export function getJobLogs(jobId) {
  return db.prepare(`SELECT * FROM activity_logs WHERE job_id = ? ORDER BY id ASC`).all(jobId);
}

export function getActiveJob() {
  return db.prepare(`SELECT * FROM jobs WHERE status = 'active' ORDER BY id DESC LIMIT 1`).get();
}

// Clean up stale active jobs on boot
export function clearStaleJobs() {
  db.prepare(`UPDATE jobs SET status = 'failed' WHERE status = 'active'`).run();
}
