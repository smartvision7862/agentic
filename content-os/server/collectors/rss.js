import Parser from "rss-parser";

const parser = new Parser({ timeout: 15000 });

function stripHtml(html) {
  return (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Returns null if the URL is not a parseable feed (so callers can fall back).
export async function tryParseFeed(url) {
  try {
    const feed = await parser.parseURL(url);
    if (!feed?.items) return null;
    return feed;
  } catch {
    return null;
  }
}

export async function collectRss(url, { tags = [], maxItems = 50 } = {}) {
  const feed = await tryParseFeed(url);
  if (!feed) throw new Error("Not a valid RSS/Atom feed");
  return feed.items.slice(0, maxItems).map((item) => {
    const summary = stripHtml(item.contentSnippet || item.content || item.summary || "");
    return {
      title: item.title?.trim() || "(untitled)",
      url: item.link || item.guid || url,
      summary: summary.slice(0, 600),
      raw_markdown: stripHtml(item["content:encoded"] || item.content || summary).slice(0, 8000),
      published_at: item.isoDate || item.pubDate || null,
      topic_tags: tags,
    };
  });
}
