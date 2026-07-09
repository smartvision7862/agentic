import express from "express";
import { join } from "path";
import { config, ROOT_DIR, serviceStatus } from "./config.js";
import {
  getAllSettings, setSetting,
  listSources, createSource, updateSource, deleteSource, getSource,
  listJobs, getJobWithDetails, recoverStaleJobs,
  listArticles, getArticle, setArticleStatus, getFreshnessHours,
  listDrafts, getDraft, createDraft, updateDraft, listVersions,
  addDraftImage, listDraftImages,
  listScheduledPosts, createScheduledPost, updateScheduledPost,
  listAccounts, upsertAccount, deleteAccount,
  createTask, listTasks, updateTask, deleteTask, getTask,
  getGmailTokens, clearGmailTokens,
  listMailMessages,
  insertTransaction, listTransactions, sumByCategory, revenueVsExpense,
  insertArticle,
} from "./db.js";
import { enqueueSourceJob, queueSize } from "./jobRunner.js";
import { subscribeJob, subscribeGlobal, broadcastGlobal } from "./sse.js";
import { startScheduler, computeNextRun, nextCronRun } from "./sourceScheduler.js";
import { collectResearch } from "./collectors/research.js";
import { generateCaption, refineCaption, generateDraftImage } from "./ai/contentAgent.js";
import { listImageModels, transcribeAudio, textToSpeech } from "./ai/openrouter.js";
import { rankPendingArticles } from "./ai/rankArticles.js";
import {
  SUPPORTED_PLATFORMS, getConnectUrl, fetchAccounts, uploadMedia, createPost,
} from "./zernio.js";
import { handleZernioWebhook } from "./webhooks/zernio.js";
import { handleWhatsAppWebhook } from "./webhooks/whatsapp.js";
import { askAssistant, askAssistantStream } from "./ai/assistant.js";
import { buildAuthUrl, exchangeCode, gmailConfigured } from "./google/oauth.js";
import { syncMail, syncExpenses, startAutoSync } from "./autoSync.js";

recoverStaleJobs();

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true, limit: "4mb" }));
app.use(express.static(join(ROOT_DIR, "public")));
app.use("/storage", express.static(join(ROOT_DIR, "storage")));

const ok = (res, data) => res.json(data);
const fail = (res, code, msg) => res.status(code).json({ error: msg });
const asyncRoute = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => fail(res, 500, err.message));

// "Today" as a YYYY-MM-DD string in the configured timezone. Transaction
// occurred_at and task due_date are stored as date-only strings, so plain
// string comparison against these bounds is correct.
function todayISODate() {
  const tz = getAllSettings().timezone || config.defaults.timezone;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function shiftDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Number of days a range spans, ending today — used to size the Gmail
// `newer_than:Nd` window so a "Process" covers the whole selected period.
function daysForRange(range, customFrom, customTo) {
  const { from, to } = rangeToDates(range, customFrom, customTo);
  const ms = new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
  return Math.max(1, Math.ceil(ms / 86400000) + 1);
}

// Resolve a range keyword (today|week|month|year|custom) into {from, to} dates.
function rangeToDates(range, customFrom, customTo) {
  const today = todayISODate();
  switch (range) {
    case "today": return { from: today, to: today };
    case "week": return { from: shiftDays(today, -6), to: today };
    case "year": return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "custom": return { from: customFrom || `${today.slice(0, 4)}-01-01`, to: customTo || today };
    case "month":
    default: return { from: `${today.slice(0, 7)}-01`, to: today };
  }
}

// ── Health ───────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => ok(res, {
  ok: true,
  time: new Date().toISOString(),
  services: serviceStatus(),
  queue: queueSize(),
  platforms: SUPPORTED_PLATFORMS,
}));

// ── Settings ─────────────────────────────────────────────────────
app.get("/api/settings", (_req, res) => ok(res, getAllSettings()));

app.put("/api/settings", (req, res) => {
  const body = req.body || {};
  // Auto-update cadence: clamp to a whole number of hours, min 1 (0 = disabled).
  if ("auto_update_hours" in body) {
    const n = Math.floor(Number(body.auto_update_hours));
    body.auto_update_hours = Number.isFinite(n) && n > 0 ? String(Math.max(1, n)) : "0";
  }
  for (const [key, value] of Object.entries(body)) setSetting(key, value);
  ok(res, getAllSettings());
});

app.get("/api/models/images", asyncRoute(async (_req, res) => ok(res, await listImageModels())));

// ── Sources ──────────────────────────────────────────────────────
app.get("/api/sources", (_req, res) => ok(res, listSources()));

app.post("/api/sources", (req, res) => {
  const { name, url } = req.body || {};
  if (!url || String(url).trim().length < 2) return fail(res, 400, "URL or search query is required");
  const source = createSource({
    name: name?.trim() || String(url).trim(),
    url: String(url).trim(),
    type: req.body.type || "auto",
    interval_value: req.body.interval_value,
    interval_unit: req.body.interval_unit,
    topic_tags: req.body.topic_tags,
    freshness_override_hours: req.body.freshness_override_hours ?? null,
    enabled: req.body.enabled,
    cron_expression: req.body.cron_expression?.trim() || null,
    research_depth: req.body.research_depth,
  });
  const next = source.cron_expression
    ? (nextCronRun(source.cron_expression) || computeNextRun(new Date(), source.interval_value, source.interval_unit))
    : computeNextRun(new Date(), source.interval_value, source.interval_unit);
  updateSource(source.id, { next_run_at: next });
  res.status(201).json(getSource(source.id));
});

app.put("/api/sources/:id", (req, res) => {
  if (!getSource(req.params.id)) return fail(res, 404, "Source not found");
  ok(res, updateSource(req.params.id, req.body || {}));
});

app.delete("/api/sources/:id", (req, res) => {
  deleteSource(req.params.id);
  ok(res, { ok: true });
});

app.post("/api/sources/:id/run", (req, res) => {
  if (!getSource(req.params.id)) return fail(res, 404, "Source not found");
  const job = enqueueSourceJob(req.params.id, "manual");
  res.status(201).json(job);
});

// Ad-hoc "Research now" — research a query immediately via Perplexity Sonar,
// insert results into the feed, and rank, without saving a source.
app.post("/api/research", asyncRoute(async (req, res) => {
  const query = String(req.body?.query || "").trim();
  if (query.length < 2) return fail(res, 400, "A research query is required");
  const depth = req.body?.depth === "sonar-pro" ? "sonar-pro" : "sonar";
  const tags = Array.isArray(req.body?.topic_tags) ? req.body.topic_tags : [];
  const items = await collectResearch(query, { tags, depth });
  let added = 0;
  for (const it of items) {
    const r = insertArticle({ ...it, scraped_at: new Date().toISOString() });
    if (r.inserted) added += 1;
  }
  let ranked = 0;
  try { ranked = await rankPendingArticles(); } catch { /* ranking optional */ }
  ok(res, { found: items.length, added, ranked });
}));

// ── Jobs + live streams ──────────────────────────────────────────
app.get("/api/jobs", (_req, res) => ok(res, listJobs(50)));

app.get("/api/jobs/:id", (req, res) => {
  const job = getJobWithDetails(req.params.id);
  if (!job) return fail(res, 404, "Job not found");
  ok(res, job);
});

function sseHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
}

app.get("/api/jobs/:id/stream", (req, res) => { sseHeaders(res); subscribeJob(req.params.id, res); });
app.get("/api/events", (_req, res) => { sseHeaders(res); subscribeGlobal(res); });

// ── Articles (Feed) ──────────────────────────────────────────────
app.get("/api/articles", (req, res) => {
  const bypass = req.query.bypassFreshness === "true";
  const statuses = req.query.statuses ? String(req.query.statuses).split(",") : null;
  const withinHours = bypass ? null : getFreshnessHours();
  ok(res, listArticles({ withinHours, statuses, limit: 300 }));
});

app.post("/api/articles/rank", asyncRoute(async (_req, res) => {
  const count = await rankPendingArticles();
  ok(res, { ranked: count });
}));

app.post("/api/articles/:id/status", (req, res) => {
  const article = getArticle(req.params.id);
  if (!article) return fail(res, 404, "Article not found");
  const { status } = req.body || {};
  if (!["new", "shortlisted", "used", "dismissed"].includes(status)) {
    return fail(res, 400, "Invalid status");
  }
  ok(res, setArticleStatus(req.params.id, status));
});

// Create a draft from an article and optionally auto-generate a caption.
app.post("/api/articles/:id/draft", asyncRoute(async (req, res) => {
  const article = getArticle(req.params.id);
  if (!article) return fail(res, 404, "Article not found");
  let caption = "";
  if (req.body?.generate !== false && config.openrouterApiKey) {
    caption = await generateCaption(article.id, req.body?.platform || "general");
  }
  const draft = createDraft({ article_id: article.id, title: article.title, caption });
  setArticleStatus(article.id, "used");
  res.status(201).json(draft);
}));

// ── Drafts (Studio) ──────────────────────────────────────────────
app.get("/api/drafts", (_req, res) => ok(res, listDrafts()));

app.get("/api/drafts/:id", (req, res) => {
  const draft = getDraft(req.params.id);
  if (!draft) return fail(res, 404, "Draft not found");
  ok(res, { ...draft, versions: listVersions(draft.id), images: listDraftImages(draft.id) });
});

app.post("/api/drafts", (req, res) => {
  const draft = createDraft({
    title: req.body?.title,
    caption: req.body?.caption ?? "",
    article_id: req.body?.article_id ?? null,
  });
  res.status(201).json(draft);
});

app.put("/api/drafts/:id", (req, res) => {
  if (!getDraft(req.params.id)) return fail(res, 404, "Draft not found");
  ok(res, updateDraft(req.params.id, req.body || {}));
});

app.post("/api/drafts/:id/caption", asyncRoute(async (req, res) => {
  const draft = getDraft(req.params.id);
  if (!draft) return fail(res, 404, "Draft not found");
  if (!draft.article_id) return fail(res, 400, "Draft has no source article");
  const caption = await generateCaption(draft.article_id, req.body?.platform || "general");
  ok(res, updateDraft(draft.id, { caption }));
}));

app.post("/api/drafts/:id/refine", asyncRoute(async (req, res) => {
  const instruction = String(req.body?.instruction || "").trim();
  if (!instruction) return fail(res, 400, "Instruction is required");
  const caption = await refineCaption(req.params.id, instruction);
  ok(res, { caption, versions: listVersions(req.params.id) });
}));

// Supported output ratios — passed through verbatim to the image model.
const IMAGE_RATIOS = ["1:1", "4:5", "3:4", "4:3", "9:16", "16:9"];

// Image generation runs in the background so the "generating" state persists in
// the DB and survives refreshes. Progress is broadcast over SSE; the client can
// also poll GET /api/drafts/:id (image_status).
app.post("/api/drafts/:id/image", (req, res) => {
  const draft = getDraft(req.params.id);
  if (!draft) return fail(res, 404, "Draft not found");
  if (draft.image_status === "generating") return fail(res, 409, "An image is already generating for this draft");

  const aspectRatio = IMAGE_RATIOS.includes(req.body?.aspectRatio) ? req.body.aspectRatio : "1:1";
  const research = Boolean(req.body?.research);
  const customPrompt = req.body?.prompt;

  updateDraft(draft.id, { image_status: "generating" });
  broadcastGlobal({ type: "draft-image", draftId: draft.id, status: "generating" });

  (async () => {
    try {
      const r = await generateDraftImage(draft.id, customPrompt, { aspectRatio, research });
      addDraftImage(draft.id, { image_path: r.imagePath, prompt: r.prompt, aspect_ratio: aspectRatio });
      updateDraft(draft.id, { image_path: r.imagePath, image_prompt: r.prompt, image_status: "ready" });
      broadcastGlobal({ type: "draft-image", draftId: draft.id, status: "ready", imagePath: r.imagePath });
    } catch (err) {
      updateDraft(draft.id, { image_status: "failed" });
      broadcastGlobal({ type: "draft-image", draftId: draft.id, status: "failed", error: err.message });
    }
  })();

  res.status(202).json({ status: "generating", aspectRatio });
});

// ── Accounts (Settings → connect IG / LinkedIn / X) ──────────────
app.get("/api/accounts", (_req, res) => ok(res, listAccounts()));

app.get("/api/accounts/connect/:platform", async (req, res) => {
  try {
    const url = await getConnectUrl(req.params.platform);
    ok(res, { url });
  } catch (err) {
    // Strip the internal "Zernio /connect/...:" prefix for a clean UI message.
    const clean = err.message.replace(/^Zernio \/[^:]+:\s*/, "");
    const code =
      err.code === "PAYMENT_REQUIRED" ? 402 :
      err.code === "UPSTREAM_UNREACHABLE" ? 503 :
      err.status >= 400 && err.status < 600 ? err.status :
      502;
    res.status(code).json({ error: clean, code: err.code });
  }
});

// Zernio redirects here after the user finishes OAuth. Standard mode appends
// ?connected={platform}&accountId=Y&username=Z — capture it, then resync.
app.get("/api/accounts/callback", asyncRoute(async (req, res) => {
  const { connected, platform, accountId, username } = req.query;
  if (accountId && (platform || connected)) {
    upsertAccount({
      zernio_account_id: String(accountId),
      platform: String(platform || connected),
      username: username ? String(username) : null,
    });
  }
  try {
    const accounts = await fetchAccounts();
    for (const a of accounts) upsertAccount(a);
  } catch { /* surfaced on next manual sync */ }
  res.redirect("/?connected=1#settings");
}));

app.post("/api/accounts/sync", asyncRoute(async (_req, res) => {
  const accounts = await fetchAccounts();
  for (const a of accounts) upsertAccount(a);
  ok(res, listAccounts());
}));

app.delete("/api/accounts/:id", (req, res) => {
  deleteAccount(req.params.id);
  ok(res, { ok: true });
});

// ── Scheduling ───────────────────────────────────────────────────
app.get("/api/scheduled", (_req, res) => ok(res, listScheduledPosts()));

app.post("/api/drafts/:id/schedule", asyncRoute(async (req, res) => {
  const draft = getDraft(req.params.id);
  if (!draft) return fail(res, 404, "Draft not found");

  const { platforms, scheduledFor, publishNow } = req.body || {};
  if (!Array.isArray(platforms) || !platforms.length) {
    return fail(res, 400, "Select at least one platform/account");
  }
  for (const p of platforms) {
    if (!SUPPORTED_PLATFORMS.includes(p.platform)) return fail(res, 400, `Unsupported platform: ${p.platform}`);
    if (!p.accountId) return fail(res, 400, "Each platform needs an accountId");
  }

  const mediaUrls = [];
  if (draft.image_path) mediaUrls.push(await uploadMedia(draft.image_path));

  const post = await createPost({
    content: draft.caption,
    scheduledFor,
    publishNow: Boolean(publishNow),
    timezone: getAllSettings().timezone,
    platforms,
    mediaUrls,
  });

  const scheduled = createScheduledPost({
    draft_id: draft.id,
    zernio_post_id: post.id,
    scheduled_for: scheduledFor || new Date().toISOString(),
    timezone: getAllSettings().timezone,
    platforms,
    status: publishNow ? "published" : "scheduled",
    status_detail: post.status,
  });
  updateDraft(draft.id, { status: "scheduled" });
  res.status(201).json(scheduled);
}));

// ── Webhooks ─────────────────────────────────────────────────────
app.post("/api/webhooks/zernio", handleZernioWebhook);
app.post("/api/webhooks/whatsapp", handleWhatsAppWebhook);

// ── Tasks (HUD: "to do today") ───────────────────────────────────
app.get("/api/tasks", (req, res) => {
  const dueDate = req.query.due === "today" ? todayISODate() : req.query.due || undefined;
  ok(res, listTasks({ dueDate, status: req.query.status || undefined }));
});

app.post("/api/tasks", (req, res) => {
  const title = String(req.body?.title || "").trim();
  if (!title) return fail(res, 400, "Task title is required");
  res.status(201).json(createTask({
    title,
    notes: req.body?.notes ?? null,
    due_date: req.body?.due_date ?? todayISODate(),
    priority: req.body?.priority ?? 0,
  }));
});

app.put("/api/tasks/:id", (req, res) => {
  if (!getTask(req.params.id)) return fail(res, 404, "Task not found");
  ok(res, updateTask(req.params.id, req.body || {}));
});

app.delete("/api/tasks/:id", (req, res) => {
  deleteTask(req.params.id);
  ok(res, { ok: true });
});

// ── Gmail OAuth ──────────────────────────────────────────────────
app.get("/api/gmail/status", (_req, res) => {
  const t = getGmailTokens();
  ok(res, { configured: gmailConfigured(), connected: Boolean(t?.refresh_token), email: t?.email ?? null });
});

app.get("/api/gmail/connect", (_req, res) => {
  try {
    ok(res, { url: buildAuthUrl() });
  } catch (err) {
    fail(res, 400, err.message);
  }
});

app.get("/api/gmail/callback", asyncRoute(async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect("/?gmail=error");
  try {
    await exchangeCode(String(code));
    res.redirect("/?gmail=1");
  } catch {
    res.redirect("/?gmail=error");
  }
}));

app.post("/api/gmail/disconnect", (_req, res) => {
  clearGmailTokens();
  ok(res, { ok: true });
});

// ── Mail ─────────────────────────────────────────────────────────
app.get("/api/mail", (req, res) => {
  ok(res, listMailMessages({ limit: Number(req.query.limit) || 20 }));
});

app.post("/api/mail/sync", asyncRoute(async (req, res) => {
  const days = Math.max(1, Number(req.body?.days) || 7);
  ok(res, await syncMail({ days }));
}));

// ── Expenses / income ────────────────────────────────────────────
// Process Gmail into transactions for the requested window. Pass `range`
// (today|week|month|year) to cover that entire period — so e.g. "month" pulls
// the whole month, not just the last 7 days — or an explicit `days`.
app.post("/api/expenses/sync", asyncRoute(async (req, res) => {
  const days = req.body?.range
    ? daysForRange(req.body.range, req.body.from, req.body.to)
    : Math.max(1, Number(req.body?.days) || 7);
  // Scale how many candidate mails we scan with the window length.
  const maxResults = Math.min(400, Math.max(60, days * 6));
  ok(res, await syncExpenses({ days, maxResults }));
}));

app.get("/api/expenses", (req, res) => {
  const { from, to } = rangeToDates(req.query.range, req.query.from, req.query.to);
  const totals = revenueVsExpense({ from, to });
  ok(res, {
    range: req.query.range || "month",
    from, to,
    revenue: totals.income,
    expense: totals.expense,
    net: totals.income - totals.expense,
    byCategory: {
      income: sumByCategory({ from, to, type: "income" }),
      expense: sumByCategory({ from, to, type: "expense" }),
    },
    transactions: listTransactions({ from, to, limit: 50 }),
  });
});

app.post("/api/expenses", (req, res) => {
  const { type, amount } = req.body || {};
  if (!["income", "expense"].includes(type)) return fail(res, 400, "type must be income or expense");
  if (!Number(amount)) return fail(res, 400, "amount is required");
  res.status(201).json(insertTransaction({
    type,
    amount: Number(amount),
    currency: req.body.currency || "INR",
    category: req.body.category || "Other",
    merchant: req.body.merchant ?? null,
    description: req.body.description ?? null,
    occurred_at: req.body.occurred_at || new Date().toISOString().slice(0, 10),
    source: "manual",
  }));
});

// ── Jarvis assistant ─────────────────────────────────────────────
app.post("/api/assistant/chat", asyncRoute(async (req, res) => {
  const text = String(req.body?.text || "").trim();
  if (!text) return fail(res, 400, "text is required");
  ok(res, await askAssistant(text, Array.isArray(req.body?.history) ? req.body.history : []));
}));

// Streaming variant: emits newline-delimited JSON events so the client can show
// an instant reply and an early "give me a moment" notice before slow tools run.
app.post("/api/assistant/stream", async (req, res) => {
  const text = String(req.body?.text || "").trim();
  if (!text) return fail(res, 400, "text is required");
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  try {
    for await (const ev of askAssistantStream(text, history)) {
      res.write(JSON.stringify(ev) + "\n");
    }
  } catch (err) {
    res.write(JSON.stringify({ phase: "error", error: err.message }) + "\n");
  }
  res.end();
});

// Speech-to-text: browser sends base64 mic audio, OpenRouter returns the text.
app.post("/api/assistant/transcribe", asyncRoute(async (req, res) => {
  const { audio, format } = req.body || {};
  if (!audio) return fail(res, 400, "audio (base64) is required");
  const text = await transcribeAudio(String(audio), format || "webm", {});
  ok(res, { text });
}));

// Text-to-speech via OpenRouter (used when tts_provider = openrouter).
app.post("/api/assistant/speak", asyncRoute(async (req, res) => {
  const text = String(req.body?.text || "").trim();
  if (!text) return fail(res, 400, "text is required");
  if (getAllSettings().tts_provider === "browser") {
    return fail(res, 409, "TTS provider is set to browser");
  }
  const { b64, mime } = await textToSpeech(text, {});
  ok(res, { audio: b64, mime });
}));

// ── Dashboard aggregate (single-request HUD hydration) ───────────
app.get("/api/dashboard", (req, res) => {
  const { from, to } = rangeToDates(req.query.range, req.query.from, req.query.to);
  const totals = revenueVsExpense({ from, to });
  ok(res, {
    expenses: {
      range: req.query.range || "month",
      from, to,
      revenue: totals.income,
      expense: totals.expense,
      net: totals.income - totals.expense,
      byCategory: {
        income: sumByCategory({ from, to, type: "income" }),
        expense: sumByCategory({ from, to, type: "expense" }),
      },
      transactions: listTransactions({ from, to, limit: 50 }),
    },
    mail: listMailMessages({ limit: 8 }),
    tasks: listTasks({ dueDate: todayISODate() }),
    gmail: { connected: Boolean(getGmailTokens()?.refresh_token), configured: gmailConfigured() },
    voice: { tts_provider: getAllSettings().tts_provider || "openrouter" },
    autoUpdateHours: Number(getAllSettings().auto_update_hours || 0),
  });
});

// ── SPA fallback ─────────────────────────────────────────────────
app.get("*", (_req, res) => res.sendFile(join(ROOT_DIR, "public", "index.html")));

app.listen(config.port, "0.0.0.0", () => {
  console.log(`\n  Content Agent OS → http://localhost:${config.port}`);
  console.log(`  Services: ${Object.entries(serviceStatus()).map(([k, v]) => `${k} ${v ? "✓" : "✗"}`).join("  ")}`);
  startScheduler();
  startAutoSync();
});
