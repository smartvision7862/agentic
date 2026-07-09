import { config } from "../config.js";

const BASE = "https://api.firecrawl.dev/v2";

function requireKey() {
  if (!config.firecrawlApiKey) {
    throw new Error("Firecrawl not configured — set FIRECRAWL_API_KEY in .env");
  }
}

async function firecrawl(path, body) {
  requireKey();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.firecrawlApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    const detail = json?.error || json?.message || `HTTP ${res.status}`;
    throw new Error(`Firecrawl ${path}: ${detail}`);
  }
  return json;
}

function firstHeading(markdown) {
  const m = (markdown || "").match(/^#{1,3}\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

// Scrape a single URL → one article (the page itself).
export async function scrapeUrl(url, { tags = [] } = {}) {
  const json = await firecrawl("/scrape", {
    url,
    formats: ["markdown"],
    onlyMainContent: true,
  });
  const data = json.data ?? json;
  const markdown = data.markdown || "";
  const meta = data.metadata || {};
  return [{
    title: meta.title || firstHeading(markdown) || url,
    url: meta.sourceURL || meta.url || url,
    summary: (meta.description || markdown).slice(0, 600),
    raw_markdown: markdown.slice(0, 12000),
    published_at: meta.publishedTime || meta.modifiedTime || null,
    topic_tags: tags,
  }];
}

// Web search → multiple fresh results, scraped to markdown.
export async function searchWeb(query, { tags = [], limit = 10 } = {}) {
  const json = await firecrawl("/search", {
    query,
    limit,
    sources: [{ type: "news" }, { type: "web" }],
    scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
  });
  const buckets = json.data ?? json;
  const items = [
    ...(Array.isArray(buckets?.news) ? buckets.news : []),
    ...(Array.isArray(buckets?.web) ? buckets.web : []),
    ...(Array.isArray(buckets) ? buckets : []),
  ];
  return items.map((item) => ({
    title: item.title || item.metadata?.title || query,
    url: item.url || item.metadata?.sourceURL,
    summary: (item.description || item.snippet || item.markdown || "").slice(0, 600),
    raw_markdown: (item.markdown || item.description || "").slice(0, 12000),
    published_at: item.date || item.metadata?.publishedTime || null,
    topic_tags: tags,
  })).filter((a) => a.url);
}
