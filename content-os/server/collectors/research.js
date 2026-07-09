import { researchWeb } from "../ai/openrouter.js";

// Auto-research a saved query via Perplexity Sonar (through OpenRouter) and
// return article candidates the existing pipeline (dedup → rank → feed) can use.
// `query` is the source.url field (we reuse it as the research prompt).
export async function collectResearch(query, { tags = [], depth = "sonar" } = {}) {
  const model = depth === "sonar-pro" ? "perplexity/sonar-pro" : "perplexity/sonar";
  const items = await researchWeb(query, { model, count: 8 });
  return items
    .map((it) => ({
      title: it.title || query,
      url: it.url || null,
      summary: (it.summary || "").slice(0, 600),
      raw_markdown: [it.summary, it.angle ? `Angle: ${it.angle}` : ""].filter(Boolean).join("\n\n"),
      published_at: null,
      topic_tags: tags,
    }))
    .filter((a) => a.url); // need a URL for dedup + feed linking
}
