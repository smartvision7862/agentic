// HUD dashboard logic — Expenses, Recent Mail, Tasks, and the Jarvis assistant.
// Loaded as a classic script AFTER app.js, so it shares app.js's top-level
// lexical scope ($, api, toast, escapeHtml, fmt).

const hudState = {
  range: "month",
  history: [],          // rolling window sent to the model for context
  chatLog: [],          // full transcript for the history panel (persisted)
  busy: false,
  ttsProvider: "openrouter",
  gmailConnected: false,
  gmailConfigured: false,
};

const CHAT_LOG_KEY = "agentic-os.chatLog";
function loadChatLog() {
  try { hudState.chatLog = JSON.parse(localStorage.getItem(CHAT_LOG_KEY) || "[]"); }
  catch { hudState.chatLog = []; }
  hudState.history = hudState.chatLog.slice(-8).map((m) => ({ role: m.role, content: m.content }));
}
function persistChatLog() {
  try { localStorage.setItem(CHAT_LOG_KEY, JSON.stringify(hudState.chatLog.slice(-200))); } catch {}
}
function logChat(role, content, extra = {}) {
  if (!content && !extra.imagePath) return;
  hudState.chatLog.push({ role, content: content || "", at: Date.now(), ...extra });
  persistChatLog();
  renderChatHistory();
}

function money(n, currency = "INR") {
  const v = Number(n || 0);
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(v);
  } catch {
    return `${currency} ${v.toLocaleString("en-IN")}`;
  }
}

// Empty-state markup that nudges the user to connect Gmail when it isn't yet
// linked, so expenses / mail can be retrieved. Falls back to a plain message
// once connected, or a config note when keys are missing.
function gmailCta(label, connectedMsg) {
  if (hudState.gmailConnected) return `<div class="hud-empty">${connectedMsg}</div>`;
  if (!hudState.gmailConfigured) {
    return `<div class="hud-empty">Gmail isn't configured. Add <code>GOOGLE_CLIENT_ID</code> / <code>GOOGLE_CLIENT_SECRET</code> in <code>.env</code>, then connect from Settings.</div>`;
  }
  return `
    <div class="hud-connect">
      <div class="hud-connect-msg">Connect Gmail to retrieve your ${escapeHtml(label)} automatically.</div>
      <button class="connect-btn hud-connect-gmail">Connect Gmail</button>
    </div>`;
}

// Kick off the Gmail OAuth flow from anywhere on the HUD.
async function connectGmail() {
  try {
    const { url } = await api("/api/gmail/connect");
    if (url) window.location.href = url;
    else toast("Gmail isn't configured", "error");
  } catch (e) { toast(e.message, "error"); }
}
document.addEventListener("click", (e) => {
  if (e.target.closest(".hud-connect-gmail")) connectGmail();
});

// Run a sync/fetch action with explicit "Fetching…" → "Failed"/done button
// states so the user always sees progress and failure.
async function withSyncState(btn, fn) {
  if (!btn || btn.dataset.busy === "1") return;
  const original = btn.dataset.label || btn.textContent;
  btn.dataset.label = original;
  btn.dataset.busy = "1";
  btn.disabled = true;
  btn.classList.remove("sync-failed");
  btn.classList.add("sync-busy");
  btn.textContent = "Fetching…";
  try {
    await fn();
    btn.textContent = original;
  } catch (e) {
    toast(e.message || "Failed", "error");
    btn.classList.add("sync-failed");
    btn.textContent = "Failed";
    setTimeout(() => { btn.textContent = original; btn.classList.remove("sync-failed"); }, 2800);
  } finally {
    btn.classList.remove("sync-busy");
    btn.disabled = false;
    btn.dataset.busy = "0";
  }
}

// Sync buttons only make sense once Gmail is linked; the empty-state CTA covers
// the disconnected case.
function updateSyncButtons() {
  const connected = hudState.gmailConnected;
  $("#mailSync")?.classList.toggle("hidden", !connected);
  $("#expSync")?.classList.toggle("hidden", !connected);
}

// ── Expenses ─────────────────────────────────────────────────────
function renderExpenses(data) {
  $("#expRevenue").textContent = money(data.revenue);
  $("#expExpense").textContent = money(data.expense);
  const net = data.net ?? data.revenue - data.expense;
  $("#expNet").textContent = `${net >= 0 ? "+" : "−"}${money(Math.abs(net))}`;

  const cats = (data.byCategory?.expense || []).slice(0, 6);
  const box = $("#expCats");
  if (!cats.length) {
    box.innerHTML = gmailCta("income & expenses", "No transactions in this range. Hit Sync, or add one manually.");
    return;
  }
  const max = Math.max(...cats.map((c) => c.total), 1);
  box.innerHTML = cats.map((c) => `
    <div class="cat-row">
      <span class="cat-name">${escapeHtml(c.category)}</span>
      <span class="cat-bar"><span style="width:${Math.round((c.total / max) * 100)}%"></span></span>
      <span class="cat-amt">${money(c.total)}</span>
    </div>`).join("");
}

async function loadExpenses() {
  try { renderExpenses(await api(`/api/expenses?range=${hudState.range}`)); }
  catch (e) { toast(e.message, "error"); }
}

$$("#expRange button").forEach((b) => b.addEventListener("click", () => {
  hudState.range = b.dataset.range;
  $$("#expRange button").forEach((x) => x.classList.toggle("active", x === b));
  loadExpenses();
}));

// ── Recent mail ──────────────────────────────────────────────────
function renderMail(messages) {
  const box = $("#mailList");
  if (!messages?.length) {
    box.innerHTML = gmailCta("recent mail", "No mail yet. Hit Sync to pull your latest messages.");
    return;
  }
  box.innerHTML = messages.map((m) => `
    <div class="mail-item">
      <div class="mail-from">
        <span>${escapeHtml(m.from_name || m.from_addr || "Unknown")}</span>
        <span class="time">${fmt(m.internal_date ? new Date(m.internal_date).toISOString() : null)}</span>
      </div>
      <div class="mail-subject">${escapeHtml(m.subject || "(no subject)")}</div>
      <div class="mail-snippet">${escapeHtml(m.snippet || "")}</div>
    </div>`).join("");
}

$("#mailSync")?.addEventListener("click", () => withSyncState($("#mailSync"), async () => {
  const r = await api("/api/mail/sync", { method: "POST", body: { days: 7 } });
  renderMail(r.messages);
  toast(`Synced ${r.added} new email${r.added === 1 ? "" : "s"} (last 7 days)`, "success");
}));

// Expenses "Process": pull transaction mail for the CURRENTLY SELECTED range
// (day/week/month/year) so the panel reflects the complete period, then refresh.
$("#expSync")?.addEventListener("click", () => withSyncState($("#expSync"), async () => {
  const r = await api("/api/expenses/sync", { method: "POST", body: { range: hudState.range } });
  await loadExpenses();
  const label = { today: "today", week: "this week", month: "this month", year: "this year" }[hudState.range] || hudState.range;
  toast(`Processed ${r.scanned} mail${r.scanned === 1 ? "" : "s"} · ${r.inserted} new transaction${r.inserted === 1 ? "" : "s"} (${label})`, "success");
}));

// ── Tasks ────────────────────────────────────────────────────────
function renderTasks(tasks) {
  const box = $("#taskList");
  if (!tasks?.length) {
    box.innerHTML = `<div class="hud-empty">No tasks for today. Add one above.</div>`;
    return;
  }
  box.innerHTML = tasks.map((t) => `
    <div class="task-item ${t.status === "done" ? "done" : ""}" data-id="${t.id}">
      <span class="task-check" data-act="toggle">✓</span>
      <span class="task-title">${escapeHtml(t.title)}</span>
      <button class="task-del" data-act="del">×</button>
    </div>`).join("");
  $$(".task-item", box).forEach((el) => {
    const id = el.dataset.id;
    $("[data-act='toggle']", el).addEventListener("click", async () => {
      const done = el.classList.contains("done");
      await api(`/api/tasks/${id}`, { method: "PUT", body: { status: done ? "open" : "done" } });
      loadTasks();
    });
    $("[data-act='del']", el).addEventListener("click", async () => {
      await api(`/api/tasks/${id}`, { method: "DELETE" });
      loadTasks();
    });
  });
}

async function loadTasks() {
  try { renderTasks(await api("/api/tasks?due=today")); }
  catch (e) { toast(e.message, "error"); }
}

async function addTask() {
  const input = $("#taskInput");
  const title = input.value.trim();
  if (!title) return;
  try {
    await api("/api/tasks", { method: "POST", body: { title } });
    input.value = "";
    loadTasks();
  } catch (e) { toast(e.message, "error"); }
}
$("#taskAdd")?.addEventListener("click", addTask);
$("#taskInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter") addTask(); });

// ── Jarvis live voice assistant ──────────────────────────────────
// Continuous conversation: tap globe → record → transcribe (OpenRouter) →
// agentic chat → speak reply → auto-listen again until tapped to stop.
const voice = {
  conversing: false,   // continuous loop active
  recording: false,
  stream: null, audioCtx: null, analyser: null, recorder: null, levelRAF: 0,
};
const VAD = { speakThresh: 0.045, silenceMs: 1300, noSpeechMs: 7000, maxTurnMs: 20000 };

function setAssistantState(state, label) {
  const el = $("#assistantStatus");
  el.className = `assistant-status ${state === "listening" ? "listening" : state === "thinking" ? "thinking" : ""}`;
  el.textContent = label ?? state;
  window.dispatchEvent(new CustomEvent("assistant:state", { detail: { state } }));
}
function setLevel(level) { window.dispatchEvent(new CustomEvent("assistant:level", { detail: { level } })); }

function showReply(html) {
  const box = $("#assistantReply");
  box.innerHTML = html;
  box.classList.add("show");
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
    fr.readAsDataURL(blob);
  });
}

// Speak a reply, then resolve when playback ends (so the loop can continue).
async function speak(text) {
  if (!text) return;
  setAssistantState("speaking", "Speaking…");
  if (hudState.ttsProvider === "openrouter") {
    try {
      const r = await api("/api/assistant/speak", { method: "POST", body: { text } });
      await new Promise((resolve) => {
        const audio = new Audio(`data:${r.mime};base64,${r.audio}`);
        audio.onended = audio.onerror = resolve;
        audio.play().catch(resolve);
      });
      setAssistantState("idle", "Idle");
      return;
    } catch { /* fall back to browser voice */ }
  }
  if ("speechSynthesis" in window) {
    await new Promise((resolve) => {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02; u.pitch = 0.95;
      u.onend = u.onerror = resolve;
      window.speechSynthesis.speak(u);
    });
  }
  setAssistantState("idle", "Idle");
}

// Reveal text at a natural reading pace so an instant reply doesn't flash in
// all at once ("fast, but not too fast"). Resolves when fully typed.
function typeOut(el, text) {
  return new Promise((resolve) => {
    el.textContent = "";
    const chars = [...(text || "")];
    if (!chars.length) return resolve();
    let i = 0;
    const step = Math.max(1, Math.round(chars.length / 90)); // ~90 ticks total
    const tick = () => {
      i += step;
      el.textContent = chars.slice(0, i).join("");
      const box = $("#assistantReply");
      box.scrollTop = box.scrollHeight;
      if (i < chars.length) setTimeout(tick, 16);
      else resolve();
    };
    tick();
  });
}

// One assistant turn over the streaming endpoint. `speakReply` is true for voice
// turns (auto re-listen) and false for typed turns (silent, fast text).
// When Jarvis mutates data via tools, reflect it in the HUD immediately so the
// user sees the change live (e.g. a checked-off task) without a manual refresh.
function refreshAfterActions(final) {
  const actions = final?.actions || [];
  const TASK_ACTIONS = ["add_task", "complete_task", "delete_task"];
  if (actions.some((a) => TASK_ACTIONS.includes(a))) loadTasks();
  if (final?.draftId) toast("Draft saved to the Studio.", "ok");
}

async function sendToAssistant(text, { speakReply = false } = {}) {
  if (hudState.busy) return;
  hudState.busy = true;
  logChat("user", text);
  setAssistantState("thinking", "Thinking…");
  showReply(`<div class="hud-empty">“${escapeHtml(text)}”…</div>`);

  try {
    const res = await fetch("/api/assistant/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, history: hudState.history }),
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let final = null;
    let acked = false;

    const handle = (ev) => {
      if (ev.phase === "ack") {
        acked = true;
        setAssistantState("thinking", "Working…");
        showReply(`<div class="ack-note">${escapeHtml(ev.reply)}</div>`);
      } else if (ev.phase === "error") {
        throw new Error(ev.error || "Assistant error");
      } else if (ev.phase === "final") {
        final = ev;
      }
    };

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) handle(JSON.parse(line));
      }
    }
    if (buffer.trim()) handle(JSON.parse(buffer.trim()));

    if (!final) throw new Error("No reply");
    const reply = final.reply || (final.type === "image" ? "Here is the image." : "");

    // Render the answer with a typewriter reveal, then append any image.
    const box = $("#assistantReply");
    box.classList.add("show");
    box.innerHTML = `<div class="reply-text"></div>`;
    setAssistantState("idle", "Idle");
    await typeOut($(".reply-text", box), reply);
    if (final.type === "image" && final.imagePath) {
      const img = document.createElement("img");
      img.src = final.imagePath; img.alt = "generated";
      box.appendChild(img);
    }

    logChat("assistant", reply, final.type === "image" && final.imagePath ? { imagePath: final.imagePath } : {});
    hudState.history.push({ role: "user", content: text }, { role: "assistant", content: reply });
    hudState.history = hudState.history.slice(-8);

    refreshAfterActions(final);

    if (speakReply) await speak(reply);
  } catch (e) {
    showReply(`<div class="hud-empty">${escapeHtml(e.message)}</div>`);
    setAssistantState("idle", "Idle");
    toast(e.message, "error");
  } finally {
    hudState.busy = false;
  }
}

// Record one turn: stream mic to an analyser (drives the globe waves), detect
// end-of-speech via simple VAD, then transcribe and hand off to the assistant.
async function recordTurn() {
  if (voice.recording) return;
  try {
    voice.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    toast("Microphone blocked — type your request instead", "error");
    stopConversation();
    $("#assistantInput")?.focus();
    return;
  }
  voice.recording = true;
  setAssistantState("listening", "Listening…");

  voice.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const src = voice.audioCtx.createMediaStreamSource(voice.stream);
  voice.analyser = voice.audioCtx.createAnalyser();
  voice.analyser.fftSize = 1024;
  src.connect(voice.analyser);
  const buf = new Uint8Array(voice.analyser.fftSize);

  const chunks = [];
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
  voice.recorder = new MediaRecorder(voice.stream, { mimeType: mime });
  voice.recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  const started = Date.now();
  let lastVoice = 0; let sawVoice = false; let stopped = false;

  const finish = () => {
    if (stopped) return; stopped = true;
    cancelAnimationFrame(voice.levelRAF);
    try { voice.recorder.state !== "inactive" && voice.recorder.stop(); } catch {}
  };

  const loop = () => {
    if (stopped) return;
    voice.analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / buf.length);
    setLevel(Math.min(1, rms * 4));
    const now = Date.now();
    if (rms > VAD.speakThresh) { sawVoice = true; lastVoice = now; }
    const silentFor = now - (lastVoice || started);
    if (sawVoice && silentFor > VAD.silenceMs) return finish();        // end of utterance
    if (!sawVoice && now - started > VAD.noSpeechMs) return finish();  // nobody spoke
    if (now - started > VAD.maxTurnMs) return finish();                // hard cap
    voice.levelRAF = requestAnimationFrame(loop);
  };

  voice.recorder.onstop = async () => {
    voice.recording = false;
    setLevel(0);
    try { voice.stream.getTracks().forEach((t) => t.stop()); } catch {}
    try { voice.audioCtx.close(); } catch {}
    const blob = new Blob(chunks, { type: "audio/webm" });
    if (!sawVoice || blob.size < 1200) {           // nothing meaningful captured
      setAssistantState("idle", "Idle");
      if (voice.conversing) toast("Didn't catch that — tap to try again");
      stopConversation();
      return;
    }
    setAssistantState("thinking", "Transcribing…");
    try {
      const b64 = await blobToBase64(blob);
      const { text } = await api("/api/assistant/transcribe", { method: "POST", body: { audio: b64, format: "webm" } });
      const said = (text || "").trim();
      if (!said) { setAssistantState("idle", "Idle"); if (voice.conversing) recordTurn(); return; }
      if (/^\s*(stop|cancel|that's all|thank you,? jarvis)\.?\s*$/i.test(said)) { stopConversation(); return; }
      $("#assistantInput").value = said;
      await sendToAssistant(said, { speakReply: true });
      if (voice.conversing) recordTurn();          // continuous: listen again
    } catch (e) {
      toast(e.message, "error");
      setAssistantState("idle", "Idle");
      stopConversation();
    }
  };

  voice.recorder.start();
  voice.levelRAF = requestAnimationFrame(loop);
}

function startConversation() {
  if (voice.conversing) return;
  voice.conversing = true;
  recordTurn();
}
function stopConversation() {
  voice.conversing = false;
  if (voice.recording) { try { voice.recorder.stop(); } catch {} }
  setLevel(0);
  setAssistantState("idle", "Idle");
}

// Tap globe toggles the live conversation on/off.
window.addEventListener("globe:click", () => {
  if (voice.conversing || voice.recording) stopConversation();
  else startConversation();
});

// Typed input is a one-shot, silent turn (fast text, no speech, no re-listen).
function submitTyped() {
  const input = $("#assistantInput");
  const v = input.value.trim();
  if (!v || hudState.busy) return;
  input.value = "";
  sendToAssistant(v, { speakReply: false });
}
$("#assistantSend")?.addEventListener("click", submitTyped);
$("#assistantInput")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitTyped();
});

// ── Chat history (pill + panel) ──────────────────────────────────
function renderChatHistory() {
  const pill = $("#chatHistoryPill");
  const count = hudState.chatLog.length;
  if (pill) {
    pill.classList.toggle("hidden", count === 0);
    pill.textContent = `⌃ Chat history · ${count}`;
  }
  const list = $("#chatHistoryList");
  if (!list) return;
  if (!count) {
    list.innerHTML = `<div class="hud-empty">No messages yet.</div>`;
    return;
  }
  list.innerHTML = hudState.chatLog.map((m) => `
    <div class="chat-msg ${m.role}">
      <div class="chat-msg-role">${m.role === "user" ? "You" : "Jarvis"}</div>
      <div class="chat-msg-text">${escapeHtml(m.content)}</div>
      ${m.imagePath ? `<img class="chat-msg-img" src="${escapeHtml(m.imagePath)}" alt="" />` : ""}
    </div>`).join("");
  list.scrollTop = list.scrollHeight;
}

function toggleChatHistory(show) {
  const panel = $("#chatHistoryPanel");
  if (!panel) return;
  const open = show ?? panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !open);
  if (open) renderChatHistory();
}

$("#chatHistoryPill")?.addEventListener("click", () => toggleChatHistory());
$("#chatHistoryClose")?.addEventListener("click", () => toggleChatHistory(false));
$("#chatHistoryClear")?.addEventListener("click", () => {
  hudState.chatLog = [];
  hudState.history = [];
  persistChatLog();
  renderChatHistory();
});

// ── Aggregate load (called by app.js showView('home')) ───────────
async function loadDashboard() {
  try {
    const d = await api(`/api/dashboard?range=${hudState.range}`);
    if (d.voice?.tts_provider) hudState.ttsProvider = d.voice.tts_provider;
    hudState.gmailConnected = Boolean(d.gmail?.connected);
    hudState.gmailConfigured = Boolean(d.gmail?.configured);
    updateSyncButtons();
    renderExpenses(d.expenses);
    renderMail(d.mail);
    renderTasks(d.tasks);
  } catch (e) {
    // Fall back to independent loads so one failure doesn't blank the HUD.
    loadExpenses(); loadTasks();
  }
}

window.HUD = { load: loadDashboard };

// Restore prior conversation so it survives reloads, and show the pill.
loadChatLog();
renderChatHistory();

// app.js runs showView("home") before this script defines window.HUD, so the
// first load is skipped there — trigger it here once the HUD is wired.
if (document.body.classList.contains("hud-mode")) loadDashboard();
