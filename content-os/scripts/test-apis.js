// Live diagnostic for the three external services. Reads keys from .env via config.
// Usage: node scripts/test-apis.js
import { config, serviceStatus } from "../server/config.js";

const ZERNIO = "https://zernio.com/api/v1";
const OPENROUTER = "https://openrouter.ai/api/v1";
const FIRECRAWL = "https://api.firecrawl.dev/v2";

const pass = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const fail = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m) => console.log(`    ${m}`);

function trunc(obj, n = 240) {
  const s = typeof obj === "string" ? obj : JSON.stringify(obj);
  return s.length > n ? s.slice(0, n) + "…" : s;
}

async function testFirecrawl() {
  console.log("\nFirecrawl");
  if (!config.firecrawlApiKey) return fail("FIRECRAWL_API_KEY not set");
  try {
    const res = await fetch(`${FIRECRAWL}/scrape`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.firecrawlApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", formats: ["markdown"] }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.success !== false) pass(`scrape ok (markdown ${(json.data?.markdown || "").length} chars)`);
    else fail(`scrape failed: ${trunc(json)}`);
  } catch (e) { fail(e.message); }
}

async function testOpenRouter() {
  console.log("\nOpenRouter");
  if (!config.openrouterApiKey) return fail("OPENROUTER_API_KEY not set");
  try {
    const res = await fetch(`${OPENROUTER}/models?output_modalities=image`, {
      headers: { Authorization: `Bearer ${config.openrouterApiKey}` },
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) pass(`models ok (${json.data?.length ?? 0} image-capable models)`);
    else return fail(`models failed: ${trunc(json)}`);

    // Tiny chat to confirm the key can actually complete.
    const chat = await fetch(`${OPENROUTER}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.openrouterApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.defaults.textModel, messages: [{ role: "user", content: "Reply with the single word: ok" }], max_tokens: 5 }),
    });
    const cjson = await chat.json().catch(() => ({}));
    if (chat.ok) pass(`chat ok with ${config.defaults.textModel} → ${trunc(cjson.choices?.[0]?.message?.content)}`);
    else fail(`chat failed (${config.defaults.textModel}): ${trunc(cjson)}`);
  } catch (e) { fail(e.message); }
}

async function zernio(path, opts = {}) {
  const res = await fetch(`${ZERNIO}${path}`, {
    headers: { Authorization: `Bearer ${config.zernioApiKey}`, "Content-Type": "application/json" },
    ...opts,
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function testZernio() {
  console.log("\nZernio");
  if (!config.zernioApiKey) return fail("ZERNIO_API_KEY not set");

  // 1. Profiles
  let profileId = null;
  const profs = await zernio("/profiles");
  if (profs.ok) {
    const list = profs.json.profiles || profs.json.data || profs.json || [];
    pass(`GET /profiles ok (${Array.isArray(list) ? list.length : 0} profile(s))`);
    if (Array.isArray(list) && list.length) {
      const def = list.find((p) => p.isDefault || p.default) || list[0];
      profileId = def._id || def.id;
      info(`using profileId: ${profileId} (${def.name || "unnamed"})`);
    }
  } else {
    fail(`GET /profiles → ${profs.status}: ${trunc(profs.json)}`);
  }

  // 2. Create a default profile if none exist
  if (!profileId) {
    const created = await zernio("/profiles", {
      method: "POST",
      body: JSON.stringify({ name: "Content Agent OS", description: "Auto-created by Content Agent OS" }),
    });
    if (created.ok) {
      const p = created.json.profile || created.json.data || created.json;
      profileId = p._id || p.id;
      pass(`POST /profiles created profileId: ${profileId}`);
    } else {
      fail(`POST /profiles → ${created.status}: ${trunc(created.json)}`);
    }
  }

  // 3. Accounts
  const accts = await zernio("/accounts");
  if (accts.ok) {
    const list = accts.json.accounts || accts.json.data || accts.json || [];
    pass(`GET /accounts ok (${Array.isArray(list) ? list.length : 0} account(s))`);
    for (const a of (Array.isArray(list) ? list : []).slice(0, 5)) {
      info(`${a.platform}: ${a._id || a.id} ${a.username || a.displayName || ""}`);
    }
  } else {
    fail(`GET /accounts → ${accts.status}: ${trunc(accts.json)}`);
  }

  // 4. Connect URL for each supported platform
  if (profileId) {
    for (const platform of ["instagram", "linkedin", "twitter"]) {
      const redirect = `${config.publicBaseUrl}/api/accounts/callback`;
      const q = `profileId=${encodeURIComponent(profileId)}&redirect_url=${encodeURIComponent(redirect)}`;
      const conn = await zernio(`/connect/${platform}?${q}`);
      const url = conn.json.authUrl || conn.json.data?.authUrl || conn.json.url;
      if (conn.ok && url) pass(`GET /connect/${platform} ok → authUrl present`);
      else fail(`GET /connect/${platform} → ${conn.status}: ${trunc(conn.json)}`);
    }
  } else {
    fail("Skipping connect tests — no profileId available");
  }

  // 5. Media presign (no actual upload)
  const presign = await zernio("/media/presign", {
    method: "POST",
    body: JSON.stringify({ filename: "test.jpg", contentType: "image/jpeg" }),
  });
  if (presign.ok && (presign.json.uploadUrl || presign.json.data?.uploadUrl)) pass("POST /media/presign ok");
  else fail(`POST /media/presign → ${presign.status}: ${trunc(presign.json)}`);
}

(async () => {
  console.log("Service config:", serviceStatus());
  await testFirecrawl();
  await testOpenRouter();
  await testZernio();
  console.log("\nDone.\n");
})();
