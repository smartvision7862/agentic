import { readFileSync } from "fs";
import { join } from "path";
import { config, ROOT_DIR } from "./config.js";
import { getSetting, setSetting } from "./db.js";

const BASE = "https://zernio.com/api/v1";

// Only these three platforms are exposed in the dashboard for now.
export const SUPPORTED_PLATFORMS = ["instagram", "linkedin", "twitter"];

function requireKey() {
  if (!config.zernioApiKey) {
    throw new Error("Zernio not configured — set ZERNIO_API_KEY in .env");
  }
}

// Zernio's gateway occasionally returns transient 5xx (502/503/504) or drops
// the connection. A single blip should not hard-fail a connect/sync action, so
// we retry idempotent GETs with exponential backoff. POSTs are never retried —
// re-sending /posts or /media/presign could create duplicate posts/uploads.
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const MAX_RETRIES = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function zernio(path, { method = "GET", body } = {}) {
  requireKey();
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${config.zernioApiKey}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const canRetry = method === "GET";

  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`${BASE}${path}`, init);
    } catch (netErr) {
      // No response at all (DNS / reset / gateway down).
      if (canRetry && attempt < MAX_RETRIES) {
        await sleep(400 * 2 ** attempt);
        continue;
      }
      const err = new Error(`Zernio ${path}: Zernio is temporarily unreachable — please try again`);
      err.status = 503;
      err.code = "UPSTREAM_UNREACHABLE";
      err.cause = netErr;
      throw err;
    }

    if (res.ok) return res.json().catch(() => ({}));

    if (canRetry && RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
      await sleep(400 * 2 ** attempt);
      continue;
    }

    const json = await res.json().catch(() => ({}));
    const msg = json?.error || json?.message || `HTTP ${res.status}`;
    const err = new Error(`Zernio ${path}: ${msg}`);
    err.status = res.status;
    err.code = json?.code;
    throw err;
  }
}

function unwrap(json, key) {
  return json?.[key] ?? json?.data?.[key] ?? json?.data ?? json;
}

// Zernio groups accounts under a "profile". We resolve (and cache) a default
// profile id so the connect flow has the required profileId param.
export async function getProfileId() {
  const cached = getSetting("zernio_profile_id");
  if (cached) return cached;

  const list = unwrap(await zernio("/profiles"), "profiles");
  const profiles = Array.isArray(list) ? list : [];
  let profile = profiles.find((p) => p.isDefault || p.default) || profiles[0];

  if (!profile) {
    const created = unwrap(
      await zernio("/profiles", { method: "POST", body: { name: "Content Agent OS", description: "Auto-created by Content Agent OS" } }),
      "profile"
    );
    profile = created;
  }

  const id = profile?._id || profile?.id;
  if (!id) throw new Error("Could not resolve a Zernio profile id");
  setSetting("zernio_profile_id", id);
  return id;
}

// Start the hosted OAuth flow for a platform. Returns the URL to open.
export async function getConnectUrl(platform) {
  if (!SUPPORTED_PLATFORMS.includes(platform)) throw new Error(`Unsupported platform: ${platform}`);
  const profileId = await getProfileId();
  const redirect = `${config.publicBaseUrl}/api/accounts/callback`;
  const q = `profileId=${encodeURIComponent(profileId)}&redirect_url=${encodeURIComponent(redirect)}`;
  const json = await zernio(`/connect/${platform}?${q}`);
  const url = json.authUrl || json.data?.authUrl || json.url;
  if (!url) throw new Error("Zernio did not return an authUrl");
  return url;
}

// List connected accounts from Zernio, filtered to supported platforms.
export async function fetchAccounts() {
  const list = unwrap(await zernio("/accounts"), "accounts");
  const accounts = Array.isArray(list) ? list : [];
  return accounts
    .filter((a) => SUPPORTED_PLATFORMS.includes(a.platform))
    .map((a) => ({
      zernio_account_id: a._id || a.id || a.accountId,
      platform: a.platform,
      username: a.username || a.handle,
      display_name: a.displayName || a.name,
    }))
    .filter((a) => a.zernio_account_id);
}

// Upload a locally generated image to Zernio storage; returns its public URL.
export async function uploadMedia(localImagePath) {
  requireKey();
  const filename = localImagePath.split("/").pop();
  const contentType = filename.endsWith(".png")
    ? "image/png"
    : filename.endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";

  const presign = await zernio("/media/presign", {
    method: "POST",
    body: { filename, contentType },
  });
  const uploadUrl = presign.uploadUrl || presign.data?.uploadUrl;
  const publicUrl = presign.publicUrl || presign.data?.publicUrl;
  if (!uploadUrl || !publicUrl) throw new Error("Zernio presign did not return URLs");

  const bytes = readFileSync(join(ROOT_DIR, localImagePath.replace(/^\//, "")));
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: bytes,
  });
  if (!put.ok) throw new Error(`Media upload failed: HTTP ${put.status}`);
  return publicUrl;
}

// Create (and schedule) a post across the selected platforms.
export async function createPost({ content, scheduledFor, timezone, platforms, mediaUrls = [], publishNow = false }) {
  const body = {
    content,
    timezone: timezone || config.defaults.timezone,
    platforms: platforms.map((p) => ({ platform: p.platform, accountId: p.accountId })),
  };
  if (publishNow) body.publishNow = true;
  else if (scheduledFor) body.scheduledFor = scheduledFor;
  if (mediaUrls.length) body.mediaItems = mediaUrls.map((url) => ({ url }));

  const json = await zernio("/posts", { method: "POST", body });
  const post = json.data?.post || json.post || json.data || json;
  return {
    id: post._id || post.id,
    status: post.status,
    raw: post,
  };
}
