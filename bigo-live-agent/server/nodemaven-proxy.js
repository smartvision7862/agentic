import { randomBytes } from "crypto";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const DOCS = {
  provider: "NodeMaven",
  website: "https://nodemaven.com/",
  apiSwagger: "https://dashboard.nodemaven.com/documentation/v2/swagger/",
  puppeteerGuide: "https://nodemaven.com/integrations/proxies-for-puppeteer/",
};

const LOCATION_COUNTRY = {
  india: "in", "united states": "us", usa: "us",
  "united kingdom": "gb", uk: "gb", canada: "ca", australia: "au",
  germany: "de", france: "fr", brazil: "br", singapore: "sg",
};

let envLoaded = false;

export function loadProxyEnv() {
  if (envLoaded) return;
  envLoaded = true;
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

export function getApiKey() {
  loadProxyEnv();
  return process.env.NODEMAVEN_API_KEY?.trim() || process.env.NODEMAVEN_APIKEY?.trim() || null;
}

export function hasExplicitProxyCredentials() {
  loadProxyEnv();
  return Boolean(process.env.NODEMAVEN_PROXY_USER?.trim() && process.env.NODEMAVEN_PROXY_PASSWORD?.trim());
}

export function isProxyConfigured() {
  return Boolean(getApiKey() || hasExplicitProxyCredentials());
}

export async function resolveNodeMavenCredentials({ forceRefresh = false } = {}) {
  loadProxyEnv();
  if (hasExplicitProxyCredentials()) {
    return {
      baseUser: process.env.NODEMAVEN_PROXY_USER.trim(),
      password: process.env.NODEMAVEN_PROXY_PASSWORD.trim(),
      source: "env",
      account: null,
    };
  }
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Set NODEMAVEN_API_KEY or NODEMAVEN_PROXY_USER + NODEMAVEN_PROXY_PASSWORD in .env");

  const res = await fetch("https://api.nodemaven.com/api/v2/base/users/me", {
    headers: { Authorization: `x-api-key ${apiKey}` },
  });
  if (!res.ok) throw new Error(`NodeMaven API ${res.status}: check API key`);
  const data = await res.json();
  const baseUser = data.proxy_username?.trim();
  const password = data.proxy_password?.trim();
  if (!baseUser || !password) throw new Error("API did not return proxy_username/proxy_password");
  return { baseUser, password, source: "api", account: { email: data.email ?? null } };
}

export function getProxyPublicConfig() {
  loadProxyEnv();
  const apiKey = getApiKey();
  const explicit = hasExplicitProxyCredentials();
  return {
    configured: isProxyConfigured(),
    authMode: apiKey && !explicit ? "api_key" : explicit ? "proxy_credentials" : null,
    provider: DOCS.provider,
    host: process.env.NODEMAVEN_PROXY_HOST?.trim() || "gate.nodemaven.com",
    port: Number(process.env.NODEMAVEN_PROXY_PORT ?? 8080),
    protocol: process.env.NODEMAVEN_PROXY_PROTOCOL?.trim() || "http",
    filter: process.env.NODEMAVEN_PROXY_FILTER?.trim() || "medium",
    docs: DOCS,
  };
}

export function locationToCountryCode(location) {
  if (!location || typeof location !== "string") return null;
  const key = location.trim().toLowerCase();
  if (LOCATION_COUNTRY[key]) return LOCATION_COUNTRY[key];
  for (const [name, code] of Object.entries(LOCATION_COUNTRY)) {
    if (key.includes(name)) return code;
  }
  return null;
}

function generateSessionId() {
  return randomBytes(5).toString("hex").slice(0, 10);
}

export function buildNodeMavenUsername({ baseUser, country, sessionId, filter = "medium" }) {
  let username = baseUser.trim();
  if (country && !username.includes("-country-")) username += `-country-${country}`;
  if (sessionId && !username.includes("-sid-")) username += `-sid-${sessionId}`;
  if (filter && !username.includes("-filter-")) username += `-filter-${filter}`;
  return username;
}

export function createProxySessionManager({ country, credentials } = {}) {
  loadProxyEnv();
  const host = process.env.NODEMAVEN_PROXY_HOST?.trim() || "gate.nodemaven.com";
  const port = Number(process.env.NODEMAVEN_PROXY_PORT ?? 8080);
  const protocol = process.env.NODEMAVEN_PROXY_PROTOCOL?.trim() || "http";
  const filter = process.env.NODEMAVEN_PROXY_FILTER?.trim() || "medium";
  const baseUser = credentials?.baseUser ?? process.env.NODEMAVEN_PROXY_USER?.trim() ?? "";
  const password = credentials?.password ?? process.env.NODEMAVEN_PROXY_PASSWORD?.trim() ?? "";
  const countryCode = country || process.env.NODEMAVEN_PROXY_COUNTRY?.trim()?.toLowerCase() || null;
  const proxyServer = `${protocol}://${host}:${port}`;
  const rotations = [];
  let rotationCount = 0;

  return {
    proxyServer,
    rotateForSite(site) {
      rotationCount += 1;
      const sessionId = generateSessionId();
      const username = buildNodeMavenUsername({ baseUser, country: countryCode, sessionId, filter });
      const entry = { index: rotationCount, site, sessionId, country: countryCode ?? "any", startedAt: new Date().toISOString(), status: "active" };
      rotations.push(entry);
      return { username, password, proxyServer, entry };
    },
    buildReport() {
      return { provider: DOCS.provider, totalRotations: rotations.length, rotations: [...rotations] };
    },
  };
}

export async function checkProxyEgress(page) {
  const started = Date.now();
  try {
    const res = await page.goto("https://ipinfo.io/json", { timeout: 25000 });
    const body = await page.evaluate(() => document.body?.innerText ?? "");
    const data = JSON.parse(body);
    return { ok: res?.ok() !== false, ms: Date.now() - started, ip: data.ip, city: data.city, country: data.country };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: err.message, ip: null };
  }
}
