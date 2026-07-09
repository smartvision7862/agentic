import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Hand-rolled .env loader (no dotenv dependency, per repo convention).
function loadEnv() {
  const file = join(ROOT, ".env");
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnv();

export const ROOT_DIR = ROOT;

export const config = {
  // Hostinger routes traffic to process.env.PORT (often 3000). Default 3000 in prod.
  port: Number(process.env.PORT || (process.env.NODE_ENV === "production" ? 3000 : 3950)),
  scrapeConcurrency: Number(process.env.SCRAPE_CONCURRENCY ?? 5),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT || 3000}`,

  firecrawlApiKey: process.env.FIRECRAWL_API_KEY ?? "",

  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  openrouterSiteUrl: process.env.OPENROUTER_SITE_URL ?? "",
  openrouterSiteName: process.env.OPENROUTER_SITE_NAME ?? "Content Agent OS",

  zernioApiKey: process.env.ZERNIO_API_KEY ?? "",
  zernioWebhookSecret: process.env.ZERNIO_WEBHOOK_SECRET ?? "",

  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  googleRedirectUri:
    process.env.GOOGLE_REDIRECT_URI ??
    `${process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT || 3000}`}/api/gmail/callback`,

  // Seed defaults — the live values are stored in app_settings (DB) and
  // editable from the Settings tab. These only seed the first run.
  defaults: {
    freshnessHours: Number(process.env.DEFAULT_FRESHNESS_HOURS ?? 24),
    textModel: process.env.OPENROUTER_TEXT_MODEL ?? "anthropic/claude-sonnet-4",
    imageModel: process.env.OPENROUTER_IMAGE_MODEL ?? "google/gemini-2.5-flash-image",
    timezone: process.env.DEFAULT_TIMEZONE ?? "Asia/Kolkata",
  },
};

export function serviceStatus() {
  return {
    firecrawl: Boolean(config.firecrawlApiKey),
    openrouter: Boolean(config.openrouterApiKey),
    zernio: Boolean(config.zernioApiKey),
    gmail: Boolean(config.googleClientId && config.googleClientSecret),
  };
}
