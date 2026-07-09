// Gmail → DB sync for the HUD's Mail and Expenses panels. Used by the manual
// Sync buttons (via routes) and by the background auto-update poller.
import { fetchRecentMessages, EXPENSE_TERMS } from "./google/gmail.js";
import {
  upsertMailMessage, listMailMessages, getMailMessage, markMailProcessed,
  insertTransaction, getSetting, setSetting, getGmailTokens,
} from "./db.js";
import { extractTransaction } from "./ai/expenseExtractor.js";
import { gmailConfigured } from "./google/oauth.js";
import { broadcastGlobal } from "./sse.js";

const DEFAULT_DAYS = 7;

// Run async `fn` over items with a bounded concurrency.
async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx]); }
  });
  await Promise.all(workers);
}

// Pull recent mail (last N days, all of it) into the mail_messages table.
export async function syncMail({ days = DEFAULT_DAYS, maxResults = 60 } = {}) {
  const messages = await fetchRecentMessages({ days, maxResults });
  let added = 0;
  for (const m of messages) if (upsertMailMessage(m)) added += 1;
  return { synced: messages.length, added, messages: listMailMessages({ limit: 20 }) };
}

// Pull recent transaction-looking mail and extract income/expense rows.
// Extraction (one LLM call per candidate) runs with bounded concurrency so a
// week of mail processes in seconds rather than a minute-plus.
export async function syncExpenses({ days = DEFAULT_DAYS, maxResults = 80 } = {}) {
  const messages = await fetchRecentMessages({ days, maxResults, query: EXPENSE_TERMS, withBody: true });

  const candidates = [];
  for (const m of messages) {
    upsertMailMessage(m);
    const stored = getMailMessage(m.id);
    if (stored && !stored.processed) candidates.push(m);
  }

  let inserted = 0;
  await mapLimit(candidates, 6, async (m) => {
    let txn = null;
    try { txn = await extractTransaction(m); } catch { /* skip this one */ }
    if (txn) { insertTransaction({ ...txn, message_id: m.id, source: "gmail" }); inserted += 1; }
    markMailProcessed(m.id);
  });

  return { scanned: messages.length, inserted };
}

// ── Background auto-update poller ────────────────────────────────
// Checks once a minute whether the configured interval has elapsed and, if
// Gmail is connected, refreshes mail + expenses. `auto_update_hours` is the
// cadence in hours (minimum 1; 0 disables).
let timer = null;

export function autoSyncEnabled() {
  return Number(getSetting("auto_update_hours") || 0) > 0;
}

function gmailReady() {
  return gmailConfigured() && Boolean(getGmailTokens()?.refresh_token);
}

async function runIfDue(force = false) {
  const hours = Number(getSetting("auto_update_hours") || 0);
  if (hours <= 0 || !gmailReady()) return;
  const last = Number(getSetting("last_auto_sync_at") || 0);
  if (!force && Date.now() - last < Math.max(1, hours) * 3600_000) return;

  setSetting("last_auto_sync_at", String(Date.now()));
  try {
    broadcastGlobal({ type: "auto-sync", phase: "start", message: "Auto-updating mail & expenses…" });
    const mail = await syncMail({});
    const exp = await syncExpenses({});
    broadcastGlobal({
      type: "auto-sync", phase: "done",
      message: `Auto-update: ${mail.added} new mail, ${exp.inserted} transactions`,
    });
  } catch (err) {
    broadcastGlobal({ type: "auto-sync", phase: "error", message: `Auto-update failed: ${err.message}` });
  }
}

export function startAutoSync() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => { runIfDue(false).catch(() => {}); }, 60_000);
  // Kick a first check shortly after boot (respects the interval window).
  setTimeout(() => { runIfDue(false).catch(() => {}); }, 15_000);
}
