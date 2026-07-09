import { chat, generateImage, generateImageV2, researchWeb } from "./openrouter.js";
import { getSetting, getArticle, getDraft, updateDraft, addVersion, listVersions } from "../db.js";

function brandVoice() {
  return getSetting("brand_voice") || "Clear, confident, and concise.";
}

const PLATFORM_NOTES = {
  instagram: "Instagram: engaging hook, line breaks for readability, 3-8 relevant hashtags at the end, emojis okay if they fit the brand.",
  linkedin: "LinkedIn: professional, insight-led, no hashtag spam (1-3 max), short paragraphs, a thought-provoking opener.",
  twitter: "X/Twitter: punchy, under 280 characters, at most 1-2 hashtags, strong first line.",
};

// Draft an initial caption from an article.
export async function generateCaption(articleId, platform = "general") {
  const article = getArticle(articleId);
  if (!article) throw new Error("Article not found");

  const platformNote = PLATFORM_NOTES[platform] || "Write a general social caption.";
  const caption = await chat([
    {
      role: "system",
      content: `You are a social media copywriter. Brand voice: ${brandVoice()}\n${platformNote}\nGround the post in the source material. Do not invent facts. End with the source URL on its own line.`,
    },
    {
      role: "user",
      content: `Write a social post based on this article.\n\nTitle: ${article.title}\nSuggested angle: ${article.suggested_angle || "(none)"}\nSource: ${article.url}\n\nContent:\n${(article.raw_markdown || article.summary || "").slice(0, 4000)}`,
    },
  ]);
  return caption.trim();
}

// Conversational refine: apply a user instruction to the current caption.
export async function refineCaption(draftId, instruction) {
  const draft = getDraft(draftId);
  if (!draft) throw new Error("Draft not found");

  addVersion(draftId, "user", instruction, draft.caption);

  const history = listVersions(draftId).slice(-8);
  const messages = [
    {
      role: "system",
      content: `You are a social media copy editor. Brand voice: ${brandVoice()}\nRevise the caption per the user's instruction. Return ONLY the full revised caption, nothing else.`,
    },
    { role: "user", content: `Current caption:\n${draft.caption || "(empty)"}` },
  ];
  for (const v of history) {
    if (v.role === "user") messages.push({ role: "user", content: v.content });
  }

  const revised = (await chat(messages)).trim();
  addVersion(draftId, "assistant", revised, revised);
  updateDraft(draftId, { caption: revised });
  return revised;
}

// Build a news/text-rich image prompt from the draft (optionally grounded in
// live web research), then generate it in the EXACT chosen ratio. Returns the
// new image path + prompt; the caller persists it and records history.
export async function generateDraftImage(draftId, customPrompt, { aspectRatio = "1:1", research = false } = {}) {
  const draft = getDraft(draftId);
  if (!draft) throw new Error("Draft not found");

  let prompt = customPrompt;
  if (!prompt) {
    const baseText = draft.caption || draft.title || "";
    let facts = [];
    if (research) {
      try { facts = await researchWeb(baseText, { count: 3 }); } catch { /* best-effort */ }
    }
    const factNote = facts.length
      ? "\n\nReal, current facts to ground the card in (use these for the headline/subhead):\n" +
        facts.map((f) => `- ${f.title}: ${f.summary}`).join("\n")
      : "";

    // A social post needs to *say something*. Design a news-card prompt whose
    // graphic visibly renders a real headline + subhead about the topic.
    prompt = await chat([
      {
        role: "system",
        content:
          "You write prompts for an AI image model that renders editorial SOCIAL MEDIA NEWS CARDS. " +
          "The graphic MUST visibly include crisp, readable, correctly-spelled text: a punchy HEADLINE " +
          "(max 7 words) and a short supporting SUBHEAD (max 12 words), both drawn from the post's actual " +
          "topic / the provided facts — never lorem ipsum or invented claims. Describe a clean modern layout: " +
          "bold sans-serif headline with clear visual hierarchy, a tasteful accent color, relevant background " +
          "imagery or iconography, strong contrast, balanced negative space, social-ready and on-brand " +
          `(brand voice: ${brandVoice()}). State the EXACT headline and subhead to render, each in double quotes. ` +
          "Output ONLY the image prompt as one paragraph, no preamble.",
      },
      { role: "user", content: `Post caption / topic:\n${baseText}${factNote}\n\nTarget aspect ratio: ${aspectRatio}.` },
    ]);
    prompt = prompt.trim();
  }

  let imagePath;
  try {
    imagePath = await generateImageV2(prompt, { aspectRatio });
  } catch {
    // Fall back to the chat-modality image path (Gemini) — pass the EXACT ratio
    // through so the selection is always honored.
    imagePath = await generateImage(prompt, { aspectRatio });
  }
  return { imagePath, prompt };
}
