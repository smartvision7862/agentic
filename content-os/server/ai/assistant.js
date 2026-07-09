import { chatWithTools, chat, generateImageV2, researchWeb, imageContentModel, assistantFastModel } from "./openrouter.js";
import {
  revenueVsExpense, sumByCategory, listTransactions,
  listMailMessages, listTasks, createTask, updateTask, getSetting, createDraft,
} from "../db.js";

function systemPrompt() {
  const tz = getSetting("timezone") || "Asia/Kolkata";
  return (
    "You are JARVIS, the live assistant for Agentic OS. You are concise, calm, and precise — " +
    "a sci-fi AI butler. Replies are often read aloud, so answer in 1-2 short sentences with no " +
    "markdown, lists, code, or emoji. Answer ONLY what was asked — never volunteer extra facts, " +
    "summaries, or follow-up suggestions the user didn't request. If a yes/no or one-word answer is " +
    "correct, give just that. You can read the user's finances, mail, and tasks, and you can take " +
    "actions using the provided tools: add a task, MARK A TASK DONE (check it off), research the web, " +
    "generate images, and create a ready-to-post social media content draft (optionally researched). " +
    "When the user asks about spending, mail, or to-dos, CALL the relevant tool instead of guessing. " +
    "To check off / complete / mark done a task, CALL complete_task with the task's title. " +
    "When the user asks you to write or generate a post/content on their behalf, CALL create_content_draft. " +
    "When you finish an action, confirm it in one short sentence.\n" +
    `Today's date is ${todayISO()} (timezone ${tz}). Resolve relative dates like "tomorrow" or ` +
    "\"next Monday\" against this date, and pass due_date as an exact YYYY-MM-DD string."
  );
}

// Tools that take real time (web/network/image gen). When one of these is about
// to run we warn the user up front instead of leaving them staring at a spinner.
const SLOW_TOOLS = new Set(["research_web", "generate_image", "draft_content", "create_content_draft"]);

function ackForCalls(calls) {
  const names = calls.map((c) => c.function?.name);
  if (names.includes("generate_image")) return "On it — generating that image now. Give me a few moments.";
  if (names.includes("create_content_draft")) return "On it — researching and drafting your post. Give me a moment.";
  if (names.includes("research_web")) return "Let me look that up on the web — give me a moment.";
  return "Working on that — one moment.";
}

// ── Date helpers (configured timezone) ───────────────────────────
function todayISO() {
  const tz = getSetting("timezone") || "Asia/Kolkata";
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}
function rangeDates(range) {
  const today = todayISO();
  const shift = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  if (range === "today") return { from: today, to: today };
  if (range === "week") return { from: shift(today, -6), to: today };
  if (range === "year") return { from: `${today.slice(0, 4)}-01-01`, to: today };
  return { from: `${today.slice(0, 7)}-01`, to: today }; // month default
}

// ── Tool schemas (OpenAI function-calling format) ────────────────
const TOOLS = [
  { type: "function", function: {
    name: "get_expenses",
    description: "Get the user's income vs expense totals and category breakdown for a date range.",
    parameters: { type: "object", properties: { range: { type: "string", enum: ["today", "week", "month", "year"] } }, required: [] },
  }},
  { type: "function", function: {
    name: "get_recent_mail",
    description: "Get the user's most recent synced emails (sender, subject, snippet).",
    parameters: { type: "object", properties: { limit: { type: "number" } }, required: [] },
  }},
  { type: "function", function: {
    name: "get_tasks",
    description: "List today's tasks and their status.",
    parameters: { type: "object", properties: {}, required: [] },
  }},
  { type: "function", function: {
    name: "add_task",
    description: "Add a to-do task. Use an ISO date (YYYY-MM-DD) for due_date; omit to mean today.",
    parameters: { type: "object", properties: { title: { type: "string" }, due_date: { type: "string" } }, required: ["title"] },
  }},
  { type: "function", function: {
    name: "complete_task",
    description: "Mark a to-do task done / check it off (or reopen it). Match by the task's title; the title need not be exact.",
    parameters: { type: "object", properties: {
      title: { type: "string", description: "Title (or part of it) of the task to update." },
      done: { type: "boolean", description: "true = mark done (default), false = reopen." },
    }, required: ["title"] },
  }},
  { type: "function", function: {
    name: "research_web",
    description: "Research a topic on the live web (Perplexity). Returns titles, summaries, and source URLs.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  }},
  { type: "function", function: {
    name: "generate_image",
    description: "Generate an image from a prompt in the given aspect ratio.",
    parameters: { type: "object", properties: { prompt: { type: "string" }, aspect_ratio: { type: "string", enum: ["1:1", "4:5", "3:4", "9:16", "4:3", "16:9"] } }, required: ["prompt"] },
  }},
  { type: "function", function: {
    name: "draft_content",
    description: "Draft a short social media caption about a topic and return the text (does NOT save it).",
    parameters: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
  }},
  { type: "function", function: {
    name: "create_content_draft",
    description: "Research a topic (optional) and create a SAVED social media post draft in the Studio, ready to edit/schedule. Use this when the user asks you to write/generate a post or content on their behalf.",
    parameters: { type: "object", properties: {
      topic: { type: "string" },
      research: { type: "boolean", description: "Pull live web facts to ground the post. Default true." },
    }, required: ["topic"] },
  }},
];

// ── Tool executors ───────────────────────────────────────────────
const generatedImages = [];
const createdDrafts = [];
async function runTool(name, args) {
  switch (name) {
    case "get_expenses": {
      const { from, to } = rangeDates(args.range || "month");
      const totals = revenueVsExpense({ from, to });
      return {
        range: args.range || "month", from, to,
        income: totals.income, expense: totals.expense, net: totals.income - totals.expense,
        topExpenseCategories: sumByCategory({ from, to, type: "expense" }).slice(0, 6),
        recent: listTransactions({ from, to, limit: 8 }),
      };
    }
    case "get_recent_mail":
      return listMailMessages({ limit: Math.min(args.limit || 8, 20) })
        .map((m) => ({ from: m.from_name || m.from_addr, subject: m.subject, snippet: m.snippet }));
    case "get_tasks":
      return listTasks({ dueDate: todayISO() }).map((t) => ({ id: t.id, title: t.title, status: t.status }));
    case "add_task": {
      const t = createTask({ title: args.title, due_date: args.due_date || todayISO() });
      return { added: true, title: t.title, due_date: t.due_date };
    }
    case "complete_task": {
      const tasks = listTasks({ dueDate: todayISO() });
      const q = String(args.title || "").trim().toLowerCase();
      const target =
        (args.id && tasks.find((t) => t.id === args.id)) ||
        tasks.find((t) => t.title.toLowerCase() === q) ||
        tasks.find((t) => t.title.toLowerCase().includes(q)) ||
        (q && tasks.find((t) => q.includes(t.title.toLowerCase())));
      if (!target) return { completed: false, error: `No task today matching "${args.title}".` };
      const status = args.done === false ? "open" : "done";
      updateTask(target.id, { status });
      return { completed: status === "done", reopened: status === "open", title: target.title, status };
    }
    case "research_web":
      return (await researchWeb(args.query, { count: 5 })).map((i) => ({ title: i.title, summary: i.summary, url: i.url }));
    case "generate_image": {
      const path = await generateImageV2(args.prompt, { aspectRatio: args.aspect_ratio || "1:1", model: imageContentModel() });
      generatedImages.push(path);
      return { generated: true, imagePath: path };
    }
    case "draft_content": {
      const draft = await chat([
        { role: "system", content: "You are a social copywriter. Write one concise, ready-to-post caption. No preamble." },
        { role: "user", content: `Write a social post about: ${args.topic}` },
      ]);
      return { draft: draft.trim() };
    }
    case "create_content_draft": {
      const topic = String(args.topic || "").trim();
      let factNote = "";
      if (args.research !== false) {
        try {
          const found = await researchWeb(topic, { count: 4 });
          if (found.length) {
            factNote = "\n\nGround the post in these real, current facts (cite the most relevant source URL):\n" +
              found.map((f) => `- ${f.title}: ${f.summary} (${f.url})`).join("\n");
          }
        } catch { /* research is best-effort */ }
      }
      const caption = (await chat([
        { role: "system", content:
          `You are a social media copywriter. Brand voice: ${getSetting("brand_voice") || "clear, confident, concise"}. ` +
          "Write ONE ready-to-post caption grounded in the facts — accurate, specific, no invented claims. " +
          "End with the most relevant source URL on its own line. No preamble." },
        { role: "user", content: `Write a social post about: ${topic}${factNote}` },
      ])).trim();
      const draft = createDraft({ title: topic, caption });
      createdDrafts.push({ id: draft.id, title: draft.title });
      return { created: true, draftId: draft.id, title: draft.title, caption };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

/**
 * Agentic Jarvis turn as an async generator. Yields events so the caller can
 * stream them to the client:
 *   { phase: "ack",  reply }                         → quick "give me a moment"
 *   { phase: "final", type, reply, imagePath?, actions } → the answer
 * Plain conversational turns skip the ack and resolve almost instantly because
 * they run on the fast, low-latency model with no tool round-trips.
 */
export async function* askAssistantStream(text, history = []) {
  const query = String(text || "").trim();
  if (!query) throw new Error("Empty query");

  generatedImages.length = 0;
  createdDrafts.length = 0;
  const actions = [];
  const model = assistantFastModel();
  const messages = [
    { role: "system", content: systemPrompt() },
    ...history.slice(-6).filter((m) => m && m.role && m.content),
    { role: "user", content: query },
  ];

  let ackSent = false;
  for (let step = 0; step < 5; step++) {
    const msg = await chatWithTools(messages, TOOLS, { model });
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      const reply = (msg.content || "").trim();
      const imagePath = generatedImages[generatedImages.length - 1];
      const draftId = createdDrafts[createdDrafts.length - 1]?.id;
      yield imagePath
        ? { phase: "final", type: "image", reply: reply || "Done — here is the image.", imagePath, actions, draftId }
        : { phase: "final", type: "text", reply, actions, draftId };
      return;
    }
    // Warn the user before kicking off anything slow (web research, image gen).
    if (!ackSent && calls.some((c) => SLOW_TOOLS.has(c.function?.name))) {
      ackSent = true;
      yield { phase: "ack", reply: ackForCalls(calls) };
    }
    // Append the assistant's tool-call message, then each tool result.
    messages.push({ role: "assistant", content: msg.content || "", tool_calls: calls });
    for (const call of calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* tolerate */ }
      let result;
      try { result = await runTool(call.function.name, args); }
      catch (e) { result = { error: e.message }; }
      actions.push(call.function.name);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  // Fell through the loop budget — ask for a final summary without tools.
  const finalText = await chat([...messages, { role: "user", content: "Give your final concise spoken answer now." }], { model });
  const imagePath = generatedImages[generatedImages.length - 1];
  const draftId = createdDrafts[createdDrafts.length - 1]?.id;
  yield imagePath
    ? { phase: "final", type: "image", reply: finalText.trim(), imagePath, actions, draftId }
    : { phase: "final", type: "text", reply: finalText.trim(), actions, draftId };
}

/**
 * Non-streaming convenience wrapper (kept for back-compat with /api/assistant/chat).
 * @returns {Promise<{type:'text'|'image', reply, imagePath?, actions:string[]}>}
 */
export async function askAssistant(text, history = []) {
  let final = { type: "text", reply: "", actions: [] };
  for await (const ev of askAssistantStream(text, history)) {
    if (ev.phase === "final") final = ev;
  }
  return final;
}
