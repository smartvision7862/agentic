import { collectRss, tryParseFeed } from "./rss.js";
import { scrapeUrl, searchWeb } from "./firecrawl.js";
import { collectResearch } from "./research.js";

// Resolve a source to a concrete collection strategy and return raw articles.
// `log` is an optional (level, message) callback for live job logs.
export async function collectSource(source, log = () => {}) {
  const tags = source.topic_tags ?? [];
  let type = source.type ?? "auto";

  if (type === "auto") {
    log("info", "Auto-detecting source type…");
    const feed = await tryParseFeed(source.url);
    if (feed) {
      log("success", `Detected RSS feed: ${feed.title || source.url}`);
      type = "rss";
    } else {
      log("info", "No RSS feed found — using Firecrawl to scrape the page");
      type = "url";
    }
  }

  switch (type) {
    case "research": {
      log("info", `Researching "${source.url}" via Perplexity ${source.research_depth || "sonar"}`);
      const items = await collectResearch(source.url, { tags, depth: source.research_depth });
      log("success", `Research returned ${items.length} items`);
      return items;
    }
    case "rss": {
      log("info", `Fetching RSS feed ${source.url}`);
      const items = await collectRss(source.url, { tags });
      log("success", `RSS returned ${items.length} items`);
      return items;
    }
    case "search": {
      log("info", `Searching the web for "${source.url}"`);
      const items = await searchWeb(source.url, { tags });
      log("success", `Search returned ${items.length} results`);
      return items;
    }
    case "url":
    default: {
      log("info", `Scraping ${source.url} via Firecrawl`);
      const items = await scrapeUrl(source.url, { tags });
      log("success", `Scraped ${items.length} page(s)`);
      return items;
    }
  }
}
