import { google } from "googleapis";
import { getAuthorizedClient } from "./oauth.js";

// Transaction-signalling terms — narrows the candidate set before any LLM
// expense extraction runs. Combine with a `newer_than:Nd` window per call.
export const EXPENSE_TERMS =
  "(receipt OR invoice OR payment OR debited OR credited OR " +
  "order OR transaction OR purchase OR paid OR refund OR salary OR payout)";

function gmail() {
  return google.gmail({ version: "v1", auth: getAuthorizedClient() });
}

function header(headers, name) {
  const h = (headers || []).find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

// Split "Display Name <addr@x.com>" into { name, addr }.
function parseFrom(value) {
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), addr: m[2].trim() };
  return { name: "", addr: value.trim() };
}

function decodeB64Url(data) {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

// Walk the MIME tree and pull the best text body (prefer text/plain).
function extractBody(payload) {
  if (!payload) return "";
  let plain = "";
  let html = "";
  const walk = (part) => {
    if (!part) return;
    const mime = part.mimeType || "";
    if (mime === "text/plain" && part.body?.data) plain += decodeB64Url(part.body.data);
    else if (mime === "text/html" && part.body?.data) html += decodeB64Url(part.body.data);
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  if (plain.trim()) return plain;
  // Strip tags from HTML as a fallback.
  return html.replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Map with a small concurrency cap so 50+ message fetches run in parallel
// without tripping Gmail's per-user rate limits.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Fetch recent messages with metadata + (optionally) decoded body.
 * By default pulls everything from the last `days` days (7). Pass `query` to
 * narrow (e.g. expense candidates); `days` is folded in as `newer_than:Nd`.
 * `withBody` controls whether the full MIME body is decoded — keep it off for
 * the mail list (faster, lighter) and on for expense extraction.
 * @returns {Promise<Array<{id, thread_id, from_addr, from_name, subject, snippet, internal_date, labels, body}>>}
 */
export async function fetchRecentMessages({ maxResults = 50, days = 7, query, withBody = false } = {}) {
  const window = `newer_than:${Math.max(1, Number(days) || 7)}d`;
  const q = query ? `${window} ${query}` : window;
  const api = gmail();
  const list = await api.users.messages.list({ userId: "me", maxResults, q });
  const ids = (list.data.messages ?? []).map((m) => m.id);

  const fetchOpts = withBody
    ? { format: "full" }
    : { format: "metadata", metadataHeaders: ["From", "Subject"] };

  const results = await mapLimit(ids, 8, async (id) => {
    try {
      const msg = await api.users.messages.get({ userId: "me", id, ...fetchOpts });
      const payload = msg.data.payload;
      const headers = payload?.headers ?? [];
      const from = parseFrom(header(headers, "From"));
      return {
        id: msg.data.id,
        thread_id: msg.data.threadId,
        from_addr: from.addr,
        from_name: from.name,
        subject: header(headers, "Subject"),
        snippet: msg.data.snippet ?? "",
        internal_date: msg.data.internalDate ? Number(msg.data.internalDate) : null,
        labels: msg.data.labelIds ?? [],
        body: withBody ? extractBody(payload) : "",
      };
    } catch {
      return null; // skip individual fetch failures
    }
  });
  return results.filter(Boolean);
}
