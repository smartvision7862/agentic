import Database from "./sqlite.js";
import { mkdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { randomUUID } from "crypto";
import { ROOT_DIR, config } from "./config.js";

mkdirSync(join(ROOT_DIR, "data"), { recursive: true });
mkdirSync(join(ROOT_DIR, "storage", "images"), { recursive: true });

const db = new Database(join(ROOT_DIR, "data", "content-os-twilio.sqlite"));
db.pragma("journal_mode = WAL");

// node-sqlite3-wasm needs an explicit close to finalize statements; flush on exit.
process.once("exit", () => { try { db.close(); } catch { /* shutting down */ } });
for (const sig of ["SIGINT", "SIGTERM"]) process.once(sig, () => process.exit(0));

db.exec(`
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS scrape_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'auto',          -- auto | rss | url | search
  interval_value INTEGER NOT NULL DEFAULT 6,
  interval_unit TEXT NOT NULL DEFAULT 'hours', -- hours | days | months
  topic_tags TEXT NOT NULL DEFAULT '[]',       -- JSON array
  freshness_override_hours INTEGER,            -- null => use global default
  enabled INTEGER NOT NULL DEFAULT 1,
  cron_expression TEXT,                        -- optional 5-field cron (advanced scheduling)
  research_depth TEXT NOT NULL DEFAULT 'sonar',-- sonar | sonar-pro (for type='research')
  last_run_at TEXT,
  next_run_at TEXT,
  last_status TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scrape_jobs (
  id TEXT PRIMARY KEY,
  source_id TEXT,
  trigger TEXT NOT NULL DEFAULT 'manual',       -- manual | scheduled
  status TEXT NOT NULL DEFAULT 'pending',       -- pending|running|completed|failed|cancelled
  found_count INTEGER DEFAULT 0,
  new_count INTEGER DEFAULT 0,
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY (source_id) REFERENCES scrape_sources(id)
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  source_id TEXT,
  job_id TEXT,
  dedup_hash TEXT UNIQUE,
  title TEXT,
  url TEXT,
  summary TEXT,
  raw_markdown TEXT,
  topic_tags TEXT NOT NULL DEFAULT '[]',
  published_at TEXT,
  scraped_at TEXT NOT NULL,
  priority_score INTEGER,
  priority_reason TEXT,
  suggested_angle TEXT,
  status TEXT NOT NULL DEFAULT 'new',           -- new|shortlisted|used|dismissed
  FOREIGN KEY (source_id) REFERENCES scrape_sources(id)
);

CREATE TABLE IF NOT EXISTS post_drafts (
  id TEXT PRIMARY KEY,
  article_id TEXT,
  title TEXT,
  caption TEXT,
  image_path TEXT,
  image_prompt TEXT,
  platform_overrides TEXT NOT NULL DEFAULT '{}', -- JSON { instagram, linkedin, twitter }
  status TEXT NOT NULL DEFAULT 'draft',           -- draft|scheduled|published|failed
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES articles(id)
);

CREATE TABLE IF NOT EXISTS post_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id TEXT NOT NULL,
  role TEXT NOT NULL,                             -- user | assistant
  content TEXT NOT NULL,
  caption_snapshot TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (draft_id) REFERENCES post_drafts(id)
);

-- Complete history of every image generated for a draft, newest first.
CREATE TABLE IF NOT EXISTS draft_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id TEXT NOT NULL,
  image_path TEXT NOT NULL,
  prompt TEXT,
  aspect_ratio TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (draft_id) REFERENCES post_drafts(id)
);

CREATE TABLE IF NOT EXISTS scheduled_posts (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  zernio_post_id TEXT,
  scheduled_for TEXT,
  timezone TEXT,
  platforms TEXT NOT NULL DEFAULT '[]',          -- JSON [{platform, accountId}]
  status TEXT NOT NULL DEFAULT 'scheduled',      -- scheduled|published|failed|cancelled
  status_detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (draft_id) REFERENCES post_drafts(id)
);

CREATE TABLE IF NOT EXISTS connected_accounts (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,                         -- instagram | linkedin | twitter
  zernio_account_id TEXT NOT NULL,
  username TEXT,
  display_name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  connected_at TEXT NOT NULL
);

-- ── Agentic OS / HUD dashboard ───────────────────────────────────
CREATE TABLE IF NOT EXISTS gmail_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),          -- single-row, single user
  email TEXT,
  access_token TEXT,
  refresh_token TEXT,
  scope TEXT,
  token_type TEXT,
  expiry_date INTEGER,                            -- ms epoch from google-auth-library
  connected_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS mail_messages (
  id TEXT PRIMARY KEY,                            -- Gmail message id (dedup natural key)
  thread_id TEXT,
  from_addr TEXT,
  from_name TEXT,
  subject TEXT,
  snippet TEXT,
  internal_date INTEGER,                          -- ms epoch (Gmail internalDate)
  labels TEXT NOT NULL DEFAULT '[]',              -- JSON array
  processed INTEGER NOT NULL DEFAULT 0,           -- 1 once expense extraction has run
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  message_id TEXT,                                -- source Gmail message (null for manual)
  type TEXT NOT NULL,                             -- income | expense
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  category TEXT NOT NULL DEFAULT 'Uncategorized',
  merchant TEXT,
  description TEXT,
  occurred_at TEXT NOT NULL,                      -- ISO date the txn happened
  source TEXT NOT NULL DEFAULT 'gmail',           -- gmail | manual
  created_at TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES mail_messages(id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT,
  due_date TEXT,                                  -- ISO date (today's tasks filter on this)
  status TEXT NOT NULL DEFAULT 'open',            -- open | done
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bigo_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  messages_count INTEGER DEFAULT 0,
  replies_count INTEGER DEFAULT 0,
  proxy_mode INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bigo_chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  sender TEXT NOT NULL,
  message TEXT NOT NULL,
  reply TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bigo_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  level TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_job ON activity_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_score ON articles(priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON scrape_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_versions_draft ON post_versions(draft_id);
CREATE INDEX IF NOT EXISTS idx_txn_occurred ON transactions(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_txn_type_cat ON transactions(type, category);
CREATE INDEX IF NOT EXISTS idx_mail_date ON mail_messages(internal_date DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date, status);
`);

// Lightweight migrations for DBs created before the v2 columns existed.
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn("scrape_sources", "cron_expression", "cron_expression TEXT");
ensureColumn("scrape_sources", "research_depth", "research_depth TEXT NOT NULL DEFAULT 'sonar'");
// idle | generating | ready | failed — drives the persistent "generating" UI.
ensureColumn("post_drafts", "image_status", "image_status TEXT NOT NULL DEFAULT 'idle'");

// ── Settings ─────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  global_freshness_hours: String(config.defaults.freshnessHours),
  text_model: config.defaults.textModel,
  image_model: config.defaults.imageModel,
  timezone: config.defaults.timezone,
  brand_voice: "Clear, confident, and concise. No hype, no emojis unless they add value.",
  niche_keywords: JSON.stringify(["AI", "automation", "startups", "technology"]),
  // v2: research / voice / content-image / agentic assistant
  research_model: "perplexity/sonar",
  assistant_model: config.defaults.textModel,
  // Fast, conversational model for the assistant's instant replies. Tool-capable
  // and low-latency so plain chat feels immediate.
  assistant_fast_model: "google/gemini-2.5-flash",
  // Dedicated image model (honors aspect_ratio via the OpenRouter image API).
  image_content_model: "google/gemini-2.5-flash-image",
  transcribe_model: "openai/whisper-large-v3",
  tts_provider: "openrouter",
  tts_model: "hexgrad/kokoro-82m",
  tts_voice: "bm_george",
  // Auto-update cadence (hours) for Gmail mail + expense polling. Minimum 1;
  // "0" disables the background poller.
  auto_update_hours: "6",
};

const getSettingStmt = db.prepare("SELECT value FROM app_settings WHERE key = ?");
const setSettingStmt = db.prepare(
  "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);

for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  if (!getSettingStmt.get(key)) setSettingStmt.run(key, value);
}

// Repair a previously-seeded invalid image model. `openai/gpt-image-2` is not a
// real OpenRouter slug, so generation failed/ignored aspect ratio — move it to
// a real dedicated image model that honors aspect_ratio.
if (getSettingStmt.get("image_content_model")?.value === "openai/gpt-image-2") {
  setSettingStmt.run("image_content_model", DEFAULT_SETTINGS.image_content_model);
}

export function getSetting(key) {
  return getSettingStmt.get(key)?.value ?? null;
}

export function setSetting(key, value) {
  setSettingStmt.run(key, String(value));
}

export function getAllSettings() {
  const rows = db.prepare("SELECT key, value FROM app_settings").all();
  const out = {};
  for (const { key, value } of rows) out[key] = value;
  return out;
}

export function getFreshnessHours(sourceOverride) {
  if (sourceOverride != null) return Number(sourceOverride);
  return Number(getSetting("global_freshness_hours") ?? 24);
}

// ── Sources ──────────────────────────────────────────────────────
export function createSource(row) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO scrape_sources
      (id, name, url, type, interval_value, interval_unit, topic_tags, freshness_override_hours, enabled, cron_expression, research_depth, created_at)
     VALUES (@id, @name, @url, @type, @interval_value, @interval_unit, @topic_tags, @freshness_override_hours, @enabled, @cron_expression, @research_depth, @created_at)`
  ).run({
    id,
    name: row.name,
    url: row.url,
    type: row.type ?? "auto",
    interval_value: row.interval_value ?? 6,
    interval_unit: row.interval_unit ?? "hours",
    topic_tags: JSON.stringify(row.topic_tags ?? []),
    freshness_override_hours: row.freshness_override_hours ?? null,
    enabled: row.enabled === false ? 0 : 1,
    cron_expression: row.cron_expression ?? null,
    research_depth: row.research_depth ?? "sonar",
    created_at: new Date().toISOString(),
  });
  return getSource(id);
}

export function updateSource(id, fields) {
  const allowed = [
    "name", "url", "type", "interval_value", "interval_unit",
    "topic_tags", "freshness_override_hours", "enabled",
    "cron_expression", "research_depth",
    "last_run_at", "next_run_at", "last_status",
  ];
  const sets = [];
  const params = { id };
  for (const [k, v] of Object.entries(fields)) {
    if (!allowed.includes(k)) continue;
    sets.push(`${k} = @${k}`);
    params[k] = k === "topic_tags" ? JSON.stringify(v ?? []) : k === "enabled" ? (v ? 1 : 0) : v;
  }
  if (!sets.length) return getSource(id);
  db.prepare(`UPDATE scrape_sources SET ${sets.join(", ")} WHERE id = @id`).run(params);
  return getSource(id);
}

export function deleteSource(id) {
  db.prepare("DELETE FROM scrape_sources WHERE id = ?").run(id);
}

function hydrateSource(row) {
  if (!row) return null;
  return { ...row, topic_tags: JSON.parse(row.topic_tags || "[]"), enabled: Boolean(row.enabled) };
}

export function getSource(id) {
  return hydrateSource(db.prepare("SELECT * FROM scrape_sources WHERE id = ?").get(id));
}

export function listSources() {
  return db.prepare("SELECT * FROM scrape_sources ORDER BY created_at DESC").all().map(hydrateSource);
}

export function listEnabledSources() {
  return db.prepare("SELECT * FROM scrape_sources WHERE enabled = 1").all().map(hydrateSource);
}

// ── Jobs + logs ──────────────────────────────────────────────────
export function createJob(row) {
  db.prepare(
    `INSERT INTO scrape_jobs (id, source_id, trigger, status, created_at)
     VALUES (@id, @source_id, @trigger, 'pending', @created_at)`
  ).run({
    id: row.id,
    source_id: row.source_id ?? null,
    trigger: row.trigger ?? "manual",
    created_at: new Date().toISOString(),
  });
}

export function updateJob(id, fields) {
  const allowed = ["status", "found_count", "new_count", "failure_reason", "started_at", "finished_at"];
  const sets = [];
  const params = { id };
  for (const [k, v] of Object.entries(fields)) {
    if (!allowed.includes(k)) continue;
    sets.push(`${k} = @${k}`);
    params[k] = v;
  }
  if (!sets.length) return;
  db.prepare(`UPDATE scrape_jobs SET ${sets.join(", ")} WHERE id = @id`).run(params);
}

export function addLog(jobId, level, message, detail = null) {
  const created_at = new Date().toISOString();
  const info = db.prepare(
    "INSERT INTO activity_logs (job_id, level, message, detail, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(jobId, level, message, detail, created_at);
  return { id: info.lastInsertRowid, job_id: jobId, level, message, detail, created_at };
}

export function listJobs(limit = 50) {
  return db.prepare(
    `SELECT j.*, s.name AS source_name
       FROM scrape_jobs j LEFT JOIN scrape_sources s ON s.id = j.source_id
      ORDER BY j.created_at DESC LIMIT ?`
  ).all(limit);
}

export function getJobWithDetails(id) {
  const job = db.prepare(
    `SELECT j.*, s.name AS source_name
       FROM scrape_jobs j LEFT JOIN scrape_sources s ON s.id = j.source_id
      WHERE j.id = ?`
  ).get(id);
  if (!job) return null;
  job.logs = db.prepare("SELECT * FROM activity_logs WHERE job_id = ? ORDER BY id ASC").all(id);
  return job;
}

export function recoverStaleJobs() {
  db.prepare(
    "UPDATE scrape_jobs SET status = 'cancelled', finished_at = ? WHERE status IN ('pending','running')"
  ).run(new Date().toISOString());
}

// ── Articles ─────────────────────────────────────────────────────
export function makeDedupHash(url, title) {
  const norm = (url || "").replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
  return createHash("sha256").update(`${norm}|${(title || "").trim().toLowerCase()}`).digest("hex");
}

export function insertArticle(row) {
  const dedup_hash = makeDedupHash(row.url, row.title);
  const existing = db.prepare("SELECT id FROM articles WHERE dedup_hash = ?").get(dedup_hash);
  if (existing) return { inserted: false, id: existing.id };
  const id = randomUUID();
  db.prepare(
    `INSERT INTO articles
      (id, source_id, job_id, dedup_hash, title, url, summary, raw_markdown, topic_tags, published_at, scraped_at, status)
     VALUES (@id, @source_id, @job_id, @dedup_hash, @title, @url, @summary, @raw_markdown, @topic_tags, @published_at, @scraped_at, 'new')`
  ).run({
    id,
    source_id: row.source_id ?? null,
    job_id: row.job_id ?? null,
    dedup_hash,
    title: row.title ?? null,
    url: row.url ?? null,
    summary: row.summary ?? null,
    raw_markdown: row.raw_markdown ?? null,
    topic_tags: JSON.stringify(row.topic_tags ?? []),
    published_at: row.published_at ?? null,
    scraped_at: row.scraped_at ?? new Date().toISOString(),
  });
  return { inserted: true, id };
}

function hydrateArticle(row) {
  if (!row) return null;
  return { ...row, topic_tags: JSON.parse(row.topic_tags || "[]") };
}

export function getArticle(id) {
  return hydrateArticle(db.prepare("SELECT * FROM articles WHERE id = ?").get(id));
}

export function listArticles({ withinHours, statuses, limit = 200 } = {}) {
  const clauses = [];
  const params = [];
  if (statuses?.length) {
    clauses.push(`status IN (${statuses.map(() => "?").join(",")})`);
    params.push(...statuses);
  }
  if (withinHours != null) {
    const cutoff = new Date(Date.now() - withinHours * 3600 * 1000).toISOString();
    clauses.push("COALESCE(published_at, scraped_at) >= ?");
    params.push(cutoff);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(limit);
  return db.prepare(
    `SELECT * FROM articles ${where}
      ORDER BY (priority_score IS NULL), priority_score DESC, COALESCE(published_at, scraped_at) DESC
      LIMIT ?`
  ).all(...params).map(hydrateArticle);
}

export function listUnrankedArticles(withinHours, limit = 40) {
  const cutoff = new Date(Date.now() - withinHours * 3600 * 1000).toISOString();
  return db.prepare(
    `SELECT * FROM articles
      WHERE priority_score IS NULL AND status = 'new' AND COALESCE(published_at, scraped_at) >= ?
      ORDER BY COALESCE(published_at, scraped_at) DESC LIMIT ?`
  ).all(cutoff, limit).map(hydrateArticle);
}

export function setArticleRanking(id, { score, reason, angle }) {
  db.prepare(
    "UPDATE articles SET priority_score = ?, priority_reason = ?, suggested_angle = ? WHERE id = ?"
  ).run(score, reason ?? null, angle ?? null, id);
}

export function setArticleStatus(id, status) {
  db.prepare("UPDATE articles SET status = ? WHERE id = ?").run(status, id);
  return getArticle(id);
}

// ── Drafts + versions ────────────────────────────────────────────
function hydrateDraft(row) {
  if (!row) return null;
  return { ...row, platform_overrides: JSON.parse(row.platform_overrides || "{}") };
}

export function createDraft(row) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO post_drafts (id, article_id, title, caption, image_path, image_prompt, platform_overrides, status, created_at, updated_at)
     VALUES (@id, @article_id, @title, @caption, @image_path, @image_prompt, @platform_overrides, 'draft', @now, @now)`
  ).run({
    id,
    article_id: row.article_id ?? null,
    title: row.title ?? null,
    caption: row.caption ?? "",
    image_path: row.image_path ?? null,
    image_prompt: row.image_prompt ?? null,
    platform_overrides: JSON.stringify(row.platform_overrides ?? {}),
    now,
  });
  return getDraft(id);
}

export function updateDraft(id, fields) {
  const allowed = ["title", "caption", "image_path", "image_prompt", "platform_overrides", "status", "image_status"];
  const sets = ["updated_at = @updated_at"];
  const params = { id, updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(fields)) {
    if (!allowed.includes(k)) continue;
    sets.push(`${k} = @${k}`);
    params[k] = k === "platform_overrides" ? JSON.stringify(v ?? {}) : v;
  }
  db.prepare(`UPDATE post_drafts SET ${sets.join(", ")} WHERE id = @id`).run(params);
  return getDraft(id);
}

export function getDraft(id) {
  return hydrateDraft(db.prepare("SELECT * FROM post_drafts WHERE id = ?").get(id));
}

export function listDrafts(limit = 100) {
  return db.prepare("SELECT * FROM post_drafts ORDER BY updated_at DESC LIMIT ?").all(limit).map(hydrateDraft);
}

export function addVersion(draftId, role, content, captionSnapshot = null) {
  db.prepare(
    "INSERT INTO post_versions (draft_id, role, content, caption_snapshot, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(draftId, role, content, captionSnapshot, new Date().toISOString());
}

export function listVersions(draftId) {
  return db.prepare("SELECT * FROM post_versions WHERE draft_id = ? ORDER BY id ASC").all(draftId);
}

// ── Draft image history ──────────────────────────────────────────
export function addDraftImage(draftId, { image_path, prompt = null, aspect_ratio = null }) {
  db.prepare(
    "INSERT INTO draft_images (draft_id, image_path, prompt, aspect_ratio, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(draftId, image_path, prompt, aspect_ratio, new Date().toISOString());
}

export function listDraftImages(draftId, limit = 30) {
  return db.prepare("SELECT * FROM draft_images WHERE draft_id = ? ORDER BY id DESC LIMIT ?").all(draftId, limit);
}

// ── Scheduled posts ──────────────────────────────────────────────
function hydrateScheduled(row) {
  if (!row) return null;
  return { ...row, platforms: JSON.parse(row.platforms || "[]") };
}

export function createScheduledPost(row) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO scheduled_posts (id, draft_id, zernio_post_id, scheduled_for, timezone, platforms, status, status_detail, created_at, updated_at)
     VALUES (@id, @draft_id, @zernio_post_id, @scheduled_for, @timezone, @platforms, @status, @status_detail, @now, @now)`
  ).run({
    id,
    draft_id: row.draft_id,
    zernio_post_id: row.zernio_post_id ?? null,
    scheduled_for: row.scheduled_for ?? null,
    timezone: row.timezone ?? null,
    platforms: JSON.stringify(row.platforms ?? []),
    status: row.status ?? "scheduled",
    status_detail: row.status_detail ?? null,
    now,
  });
  return getScheduledPost(id);
}

export function updateScheduledPost(id, fields) {
  const allowed = ["zernio_post_id", "scheduled_for", "status", "status_detail"];
  const sets = ["updated_at = @updated_at"];
  const params = { id, updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(fields)) {
    if (!allowed.includes(k)) continue;
    sets.push(`${k} = @${k}`);
    params[k] = v;
  }
  db.prepare(`UPDATE scheduled_posts SET ${sets.join(", ")} WHERE id = @id`).run(params);
  return getScheduledPost(id);
}

export function getScheduledPost(id) {
  return hydrateScheduled(db.prepare("SELECT * FROM scheduled_posts WHERE id = ?").get(id));
}

export function getScheduledByZernioId(zernioId) {
  return hydrateScheduled(
    db.prepare("SELECT * FROM scheduled_posts WHERE zernio_post_id = ?").get(zernioId)
  );
}

export function listScheduledPosts(limit = 100) {
  return db.prepare(
    `SELECT sp.*, d.title AS draft_title, d.caption AS draft_caption, d.image_path AS draft_image
       FROM scheduled_posts sp LEFT JOIN post_drafts d ON d.id = sp.draft_id
      ORDER BY COALESCE(sp.scheduled_for, sp.created_at) DESC LIMIT ?`
  ).all(limit).map(hydrateScheduled);
}

// ── Connected accounts ───────────────────────────────────────────
export function upsertAccount(row) {
  const existing = db.prepare(
    "SELECT id FROM connected_accounts WHERE zernio_account_id = ?"
  ).get(row.zernio_account_id);
  if (existing) {
    db.prepare(
      "UPDATE connected_accounts SET platform=?, username=?, display_name=?, is_active=1 WHERE id=?"
    ).run(row.platform, row.username ?? null, row.display_name ?? null, existing.id);
    return existing.id;
  }
  const id = randomUUID();
  db.prepare(
    `INSERT INTO connected_accounts (id, platform, zernio_account_id, username, display_name, is_active, connected_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  ).run(id, row.platform, row.zernio_account_id, row.username ?? null, row.display_name ?? null, new Date().toISOString());
  return id;
}

export function listAccounts() {
  return db.prepare("SELECT * FROM connected_accounts WHERE is_active = 1 ORDER BY platform").all();
}

export function deleteAccount(id) {
  db.prepare("DELETE FROM connected_accounts WHERE id = ?").run(id);
}

// ── Gmail tokens ─────────────────────────────────────────────────
export function getGmailTokens() {
  return db.prepare("SELECT * FROM gmail_tokens WHERE id = 1").get() ?? null;
}

export function saveGmailTokens(row) {
  const now = new Date().toISOString();
  const existing = getGmailTokens();
  db.prepare(
    `INSERT INTO gmail_tokens (id, email, access_token, refresh_token, scope, token_type, expiry_date, connected_at, updated_at)
     VALUES (1, @email, @access_token, @refresh_token, @scope, @token_type, @expiry_date, @connected_at, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
       email = COALESCE(excluded.email, gmail_tokens.email),
       access_token = COALESCE(excluded.access_token, gmail_tokens.access_token),
       refresh_token = COALESCE(excluded.refresh_token, gmail_tokens.refresh_token),
       scope = COALESCE(excluded.scope, gmail_tokens.scope),
       token_type = COALESCE(excluded.token_type, gmail_tokens.token_type),
       expiry_date = COALESCE(excluded.expiry_date, gmail_tokens.expiry_date),
       updated_at = excluded.updated_at`
  ).run({
    email: row.email ?? null,
    access_token: row.access_token ?? null,
    refresh_token: row.refresh_token ?? null,
    scope: row.scope ?? null,
    token_type: row.token_type ?? null,
    expiry_date: row.expiry_date ?? null,
    connected_at: existing?.connected_at ?? now,
    updated_at: now,
  });
  return getGmailTokens();
}

export function clearGmailTokens() {
  db.prepare("DELETE FROM gmail_tokens WHERE id = 1").run();
}

// ── Mail messages ────────────────────────────────────────────────
export function upsertMailMessage(row) {
  const info = db.prepare(
    `INSERT OR IGNORE INTO mail_messages
      (id, thread_id, from_addr, from_name, subject, snippet, internal_date, labels, processed, created_at)
     VALUES (@id, @thread_id, @from_addr, @from_name, @subject, @snippet, @internal_date, @labels, 0, @created_at)`
  ).run({
    id: row.id,
    thread_id: row.thread_id ?? null,
    from_addr: row.from_addr ?? null,
    from_name: row.from_name ?? null,
    subject: row.subject ?? null,
    snippet: row.snippet ?? null,
    internal_date: row.internal_date ?? null,
    labels: JSON.stringify(row.labels ?? []),
    created_at: new Date().toISOString(),
  });
  return info.changes > 0;
}

function hydrateMail(row) {
  if (!row) return null;
  return { ...row, labels: JSON.parse(row.labels || "[]"), processed: Boolean(row.processed) };
}

export function listMailMessages({ limit = 20 } = {}) {
  return db.prepare("SELECT * FROM mail_messages ORDER BY internal_date DESC LIMIT ?")
    .all(limit).map(hydrateMail);
}

export function getMailMessage(id) {
  return hydrateMail(db.prepare("SELECT * FROM mail_messages WHERE id = ?").get(id));
}

export function listUnprocessedMail(limit = 50) {
  return db.prepare("SELECT * FROM mail_messages WHERE processed = 0 ORDER BY internal_date DESC LIMIT ?")
    .all(limit).map(hydrateMail);
}

export function markMailProcessed(id) {
  db.prepare("UPDATE mail_messages SET processed = 1 WHERE id = ?").run(id);
}

// ── Transactions (expenses / income) ─────────────────────────────
export function insertTransaction(row) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO transactions
      (id, message_id, type, amount, currency, category, merchant, description, occurred_at, source, created_at)
     VALUES (@id, @message_id, @type, @amount, @currency, @category, @merchant, @description, @occurred_at, @source, @created_at)`
  ).run({
    id,
    message_id: row.message_id ?? null,
    type: row.type,
    amount: row.amount,
    currency: row.currency ?? "INR",
    category: row.category ?? "Uncategorized",
    merchant: row.merchant ?? null,
    description: row.description ?? null,
    occurred_at: row.occurred_at ?? new Date().toISOString(),
    source: row.source ?? "gmail",
    created_at: new Date().toISOString(),
  });
  return db.prepare("SELECT * FROM transactions WHERE id = ?").get(id);
}

function rangeClause(from, to) {
  const clauses = [];
  const params = [];
  if (from) { clauses.push("occurred_at >= ?"); params.push(from); }
  if (to) { clauses.push("occurred_at <= ?"); params.push(to); }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export function listTransactions({ from, to, type, limit = 200 } = {}) {
  const { where, params } = rangeClause(from, to);
  let sql = `SELECT * FROM transactions ${where}`;
  const extra = [...params];
  if (type) {
    sql += where ? " AND type = ?" : " WHERE type = ?";
    extra.push(type);
  }
  sql += " ORDER BY occurred_at DESC LIMIT ?";
  extra.push(limit);
  return db.prepare(sql).all(...extra);
}

export function sumByCategory({ from, to, type } = {}) {
  const { where, params } = rangeClause(from, to);
  let sql = `SELECT category, SUM(amount) AS total, COUNT(*) AS count FROM transactions ${where}`;
  const extra = [...params];
  if (type) {
    sql += where ? " AND type = ?" : " WHERE type = ?";
    extra.push(type);
  }
  sql += " GROUP BY category ORDER BY total DESC";
  return db.prepare(sql).all(...extra);
}

export function revenueVsExpense({ from, to } = {}) {
  const { where, params } = rangeClause(from, to);
  const rows = db.prepare(
    `SELECT type, SUM(amount) AS total FROM transactions ${where} GROUP BY type`
  ).all(...params);
  const out = { income: 0, expense: 0 };
  for (const r of rows) out[r.type] = r.total ?? 0;
  return out;
}

// ── Tasks ────────────────────────────────────────────────────────
export function createTask(row) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tasks (id, title, notes, due_date, status, priority, created_at, updated_at)
     VALUES (@id, @title, @notes, @due_date, 'open', @priority, @now, @now)`
  ).run({
    id,
    title: row.title,
    notes: row.notes ?? null,
    due_date: row.due_date ?? null,
    priority: row.priority ?? 0,
    now,
  });
  return getTask(id);
}

export function getTask(id) {
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) ?? null;
}

export function listTasks({ dueDate, status } = {}) {
  const clauses = [];
  const params = [];
  if (dueDate) { clauses.push("due_date = ?"); params.push(dueDate); }
  if (status) { clauses.push("status = ?"); params.push(status); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(
    `SELECT * FROM tasks ${where} ORDER BY status ASC, priority DESC, created_at ASC`
  ).all(...params);
}

export function updateTask(id, fields) {
  const allowed = ["title", "notes", "due_date", "status", "priority"];
  const sets = ["updated_at = @updated_at"];
  const params = { id, updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(fields)) {
    if (!allowed.includes(k)) continue;
    sets.push(`${k} = @${k}`);
    params[k] = v;
  }
  db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = @id`).run(params);
  return getTask(id);
}

export function deleteTask(id) {
  db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
}

// ── Bigo Live Database Helpers ─────────────────────────────────────
export function createBigoJob({ roomId, proxyMode = false }) {
  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO bigo_jobs (room_id, status, created_at, proxy_mode)
    VALUES (?, 'active', ?, ?)
  `).run(roomId, now, proxyMode ? 1 : 0);
  return info.lastInsertRowid;
}

export function updateBigoJobStatus(id, status) {
  db.prepare(`UPDATE bigo_jobs SET status = ? WHERE id = ?`).run(status, id);
}

export function incrementBigoJobStats(id, isReply = false) {
  if (isReply) {
    db.prepare(`UPDATE bigo_jobs SET replies_count = replies_count + 1 WHERE id = ?`).run(id);
  } else {
    db.prepare(`UPDATE bigo_jobs SET messages_count = messages_count + 1 WHERE id = ?`).run(id);
  }
}

export function addBigoChatMessage({ jobId, sender, message, reply }) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO bigo_chats (job_id, sender, message, reply, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(jobId, sender, message, reply || null, now);
}

export function addBigoActivityLog({ jobId, message, level = "info" }) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO bigo_logs (job_id, message, level, created_at)
    VALUES (?, ?, ?, ?)
  `).run(jobId, message, level, now);
}

export function listBigoJobs() {
  return db.prepare(`SELECT * FROM bigo_jobs ORDER BY id DESC LIMIT 50`).all();
}

export function getBigoJob(id) {
  return db.prepare(`SELECT * FROM bigo_jobs WHERE id = ?`).get(id);
}

export function getBigoJobChats(jobId) {
  return db.prepare(`SELECT * FROM bigo_chats WHERE job_id = ? ORDER BY id DESC`).all(jobId);
}

export function getBigoJobLogs(jobId) {
  return db.prepare(`SELECT * FROM bigo_logs WHERE job_id = ? ORDER BY id ASC`).all(jobId);
}

export function getActiveBigoJob() {
  return db.prepare(`SELECT * FROM bigo_jobs WHERE status = 'active' ORDER BY id DESC LIMIT 1`).get();
}

export function clearStaleBigoJobs() {
  db.prepare(`UPDATE bigo_jobs SET status = 'failed' WHERE status = 'active'`).run();
}

export default db;
