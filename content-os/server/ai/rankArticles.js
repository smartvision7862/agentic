import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { chatJSON } from "./openrouter.js";
import { getSetting, listUnrankedArticles, setArticleRanking, getFreshnessHours } from "../db.js";

const PROMPT = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "prompts", "rank.md"),
  "utf8"
);

function niche() {
  try {
    return JSON.parse(getSetting("niche_keywords") || "[]");
  } catch {
    return [];
  }
}

// Boost score when an article's tags overlap the niche keywords.
function applyTagBoost(score, tags, keywords) {
  const lowerKw = keywords.map((k) => k.toLowerCase());
  const overlap = (tags || []).filter((t) => lowerKw.includes(String(t).toLowerCase()));
  if (!overlap.length) return score;
  return Math.min(100, score + Math.min(15, overlap.length * 5));
}

// Rank any unranked, in-window articles. Returns count ranked.
export async function rankPendingArticles(log = () => {}) {
  const hours = getFreshnessHours();
  const articles = listUnrankedArticles(hours, 40);
  if (!articles.length) return 0;

  const keywords = niche();
  log("info", `Ranking ${articles.length} article(s) with AI…`);

  const payload = articles.map((a) => ({
    id: a.id,
    title: a.title,
    summary: (a.summary || "").slice(0, 400),
    tags: a.topic_tags,
  }));

  const result = await chatJSON([
    { role: "system", content: PROMPT },
    {
      role: "user",
      content: JSON.stringify({ niche_keywords: keywords, articles: payload }),
    },
  ]);

  const rankings = Array.isArray(result?.rankings) ? result.rankings : [];
  const byId = new Map(articles.map((a) => [a.id, a]));
  let ranked = 0;

  for (const r of rankings) {
    const article = byId.get(r.id);
    if (!article) continue;
    const base = Math.max(0, Math.min(100, Math.round(Number(r.priority_score) || 0)));
    const score = applyTagBoost(base, article.topic_tags, keywords);
    setArticleRanking(article.id, { score, reason: r.reason, angle: r.suggested_angle });
    ranked++;
  }

  // Any article the model skipped gets a neutral score so it still surfaces.
  for (const a of articles) {
    if (!rankings.find((r) => r.id === a.id)) {
      setArticleRanking(a.id, { score: 40, reason: "Not scored by model", angle: null });
    }
  }

  log("success", `Ranked ${ranked} article(s)`);
  return ranked;
}
