import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { config, ROOT_DIR } from "../config.js";
import { getSetting } from "../db.js";

const BASE = "https://openrouter.ai/api/v1";

function requireKey() {
  if (!config.openrouterApiKey) {
    throw new Error("OpenRouter not configured — set OPENROUTER_API_KEY in .env");
  }
}

function headers() {
  const h = {
    Authorization: `Bearer ${config.openrouterApiKey}`,
    "Content-Type": "application/json",
  };
  if (config.openrouterSiteUrl) h["HTTP-Referer"] = config.openrouterSiteUrl;
  if (config.openrouterSiteName) h["X-OpenRouter-Title"] = config.openrouterSiteName;
  return h;
}

export function textModel() {
  return getSetting("text_model") || config.defaults.textModel;
}

export function imageModel() {
  return getSetting("image_model") || config.defaults.imageModel;
}

// Settings-backed model getters for the v2 features (research, voice, content image,
// agentic assistant). Each falls back to a sensible default if unset.
export function researchModel() {
  return getSetting("research_model") || "perplexity/sonar";
}
export function imageContentModel() {
  return getSetting("image_content_model") || "google/gemini-2.5-flash-image";
}
export function transcribeModel() {
  return getSetting("transcribe_model") || "openai/whisper-large-v3";
}
export function ttsModel() {
  return getSetting("tts_model") || "hexgrad/kokoro-82m";
}
export function ttsVoice() {
  return getSetting("tts_voice") || "bm_george";
}
export function assistantModel() {
  return getSetting("assistant_model") || textModel();
}
// Low-latency conversational model for instant assistant replies.
export function assistantFastModel() {
  return getSetting("assistant_fast_model") || "google/gemini-2.5-flash";
}

async function postChat(payload) {
  requireKey();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`OpenRouter: ${json?.error?.message || `HTTP ${res.status}`}`);
  }
  return json;
}

// Plain text completion.
export async function chat(messages, { model, temperature = 0.7, maxTokens } = {}) {
  const json = await postChat({
    model: model || textModel(),
    messages,
    temperature,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
  });
  return json.choices?.[0]?.message?.content ?? "";
}

// Completion constrained to a JSON object. Falls back to brace-extraction
// if a model wraps the JSON in prose.
export async function chatJSON(messages, { model, temperature = 0.3 } = {}) {
  const json = await postChat({
    model: model || textModel(),
    messages,
    temperature,
    response_format: { type: "json_object" },
  });
  const content = json.choices?.[0]?.message?.content ?? "";
  try {
    return JSON.parse(content);
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start !== -1 && end !== -1) return JSON.parse(content.slice(start, end + 1));
    throw new Error("OpenRouter returned non-JSON content");
  }
}

// Tool-calling turn. Returns the raw assistant message so the caller can run
// its own multi-step loop (read message.tool_calls, run them, append results).
export async function chatWithTools(messages, tools, { model, temperature = 0.4, toolChoice = "auto" } = {}) {
  const json = await postChat({
    model: model || assistantModel(),
    messages,
    tools,
    tool_choice: toolChoice,
    temperature,
  });
  return json.choices?.[0]?.message ?? {};
}

// Web-grounded research via Perplexity Sonar. Sonar returns prose (it ignores
// JSON formatting), so we do it in two steps: (1) Sonar researches the live web,
// (2) a structuring model turns its findings into clean JSON items for the feed.
export async function researchWeb(query, { model, count = 6 } = {}) {
  const research = await chat(
    [
      { role: "system", content:
        "You are a research assistant with live web access. Find the most CURRENT, specific, real " +
        `developments for the user's topic. List up to ${count} items. For EACH item include its ` +
        "real source URL on its own line. Be concrete and factual." },
      { role: "user", content: query },
    ],
    { model: model || researchModel(), temperature: 0.3 }
  );

  let parsed;
  try {
    parsed = await chatJSON([
      { role: "system", content:
        'Convert the research notes into JSON: {"items":[{"title","url","summary","angle"}]}. ' +
        "Include ONLY items that have a real http(s) source URL from the notes. " +
        "summary = 1-2 sentences; angle = a short content angle to post about it. No invented URLs." },
      { role: "user", content: research },
    ]);
  } catch {
    return [];
  }
  return Array.isArray(parsed?.items) ? parsed.items.filter((i) => /^https?:\/\//.test(i.url || "")) : [];
}

// Speech-to-text via OpenRouter's dedicated transcription endpoint.
export async function transcribeAudio(b64, format = "webm", { model, language = "en" } = {}) {
  requireKey();
  const res = await fetch(`${BASE}/audio/transcriptions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      input_audio: { data: b64, format },
      model: model || transcribeModel(),
      language,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenRouter STT: ${json?.error?.message || `HTTP ${res.status}`}`);
  return json.text ?? "";
}

// Text-to-speech via OpenRouter. Returns { b64, mime } for the browser to play.
export async function textToSpeech(text, { model, voice, format = "mp3" } = {}) {
  requireKey();
  const res = await fetch(`${BASE}/audio/speech`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model: model || ttsModel(),
      input: text,
      voice: voice || ttsVoice(),
      response_format: format,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenRouter TTS: ${err?.error?.message || `HTTP ${res.status}`}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { b64: buf.toString("base64"), mime: `audio/${format}` };
}

// Image generation via the dedicated /images endpoint (gpt-image-2 etc.).
// Returns the public path under /storage/images.
export async function generateImageV2(prompt, { model, aspectRatio = "1:1", quality = "high" } = {}) {
  requireKey();
  const res = await fetch(`${BASE}/images`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model: model || imageContentModel(),
      prompt,
      aspect_ratio: aspectRatio,
      quality,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenRouter image: ${json?.error?.message || `HTTP ${res.status}`}`);

  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("Image model returned no image data");
  const dir = join(ROOT_DIR, "storage", "images");
  mkdirSync(dir, { recursive: true });
  const filename = `${randomUUID()}.png`;
  writeFileSync(join(dir, filename), Buffer.from(b64, "base64"));
  return `/storage/images/${filename}`;
}

// Generate an image. Returns the public path under /storage/images.
export async function generateImage(prompt, { model, aspectRatio = "4:3" } = {}) {
  const json = await postChat({
    model: model || imageModel(),
    modalities: ["image", "text"],
    image_config: { aspect_ratio: aspectRatio },
    messages: [{ role: "user", content: prompt }],
  });

  const message = json.choices?.[0]?.message ?? {};
  // Image output can arrive as message.images[] or as a data URL in content.
  let dataUrl =
    message.images?.[0]?.image_url?.url ||
    message.images?.[0]?.url ||
    null;

  if (!dataUrl && typeof message.content === "string") {
    const m = message.content.match(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/);
    if (m) dataUrl = m[0];
  }
  if (!dataUrl && Array.isArray(message.content)) {
    for (const part of message.content) {
      const url = part?.image_url?.url || part?.url;
      if (url?.startsWith("data:image")) { dataUrl = url; break; }
    }
  }

  if (!dataUrl) throw new Error("Image model returned no image data");

  const match = dataUrl.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
  if (!match) throw new Error("Unexpected image data format");
  const [, ext, b64] = match;

  const dir = join(ROOT_DIR, "storage", "images");
  mkdirSync(dir, { recursive: true });
  const filename = `${randomUUID()}.${ext === "jpeg" ? "jpg" : ext}`;
  writeFileSync(join(dir, filename), Buffer.from(b64, "base64"));
  return `/storage/images/${filename}`;
}

// List image-capable models for the Settings picker.
export async function listImageModels() {
  requireKey();
  const res = await fetch(`${BASE}/models?output_modalities=image`, { headers: headers() });
  const json = await res.json().catch(() => ({}));
  return (json.data ?? []).map((m) => ({ id: m.id, name: m.name }));
}
