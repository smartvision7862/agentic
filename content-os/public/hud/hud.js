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
const voice = {
  active: false,
  stream: null,
  audioCtx: null,
  workletNode: null,
  analyser: null,
  ws: null,
  levelRAF: 0,
  nextPlayTime: 0,
};

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

function refreshAfterActions(final) {
  const actions = final?.actions || [];
  const TASK_ACTIONS = ["add_task", "complete_task", "delete_task"];
  if (actions.some((a) => TASK_ACTIONS.includes(a))) loadTasks();
  if (final?.draftId) toast("Draft saved to the Studio.", "ok");
}

async function startConversation() {
  if (voice.active) return;
  
  try {
    voice.stream = await navigator.mediaDevices.getUserMedia({ audio: {
      sampleRate: 16000,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    }});
  } catch (e) {
    toast("Microphone blocked — type your request instead", "error");
    return;
  }
  
  voice.active = true;
  setAssistantState("listening", "Listening…");
  $("#assistantReply").innerHTML = "";
  
  voice.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
  const src = voice.audioCtx.createMediaStreamSource(voice.stream);
  
  voice.analyser = voice.audioCtx.createAnalyser();
  voice.analyser.fftSize = 1024;
  src.connect(voice.analyser);
  
  await voice.audioCtx.audioWorklet.addModule('/hud/pcm-worklet.js');
  voice.workletNode = new AudioWorkletNode(voice.audioCtx, 'pcm-capture-processor');
  src.connect(voice.workletNode);
  
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  voice.ws = new WebSocket(`${protocol}//${window.location.host}/live`);
  voice.ws.binaryType = "arraybuffer";
  
  voice.workletNode.port.onmessage = (e) => {
    if (voice.ws && voice.ws.readyState === WebSocket.OPEN) {
      voice.ws.send(e.data); // Int16Array buffer sent as ArrayBuffer
    }
  };
  
  voice.ws.onmessage = async (e) => {
    if (typeof e.data === "string") {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "text") {
          const box = $("#assistantReply");
          if (!box.classList.contains("show")) {
            box.innerHTML = `<div class="reply-text"></div>`;
            box.classList.add("show");
          }
          const textEl = $(".reply-text", box);
          textEl.textContent += msg.text;
          box.scrollTop = box.scrollHeight;
        } else if (msg.type === "state") {
          setAssistantState(msg.state, msg.label);
        } else if (msg.type === "actions") {
          refreshAfterActions(msg);
        } else if (msg.type === "error") {
          toast(msg.message, "error");
        } else if (msg.type === "clear_text") {
          $("#assistantReply").innerHTML = "";
          $("#assistantReply").classList.remove("show");
        }
      } catch (err) {}
    } else {
      // Binary data = PCM 24kHz audio from Gemini
      setAssistantState("speaking", "Speaking…");
      const pcm16 = new Int16Array(e.data);
      const audioBuffer = voice.audioCtx.createBuffer(1, pcm16.length, 24000);
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < pcm16.length; i++) {
        channelData[i] = pcm16[i] / 32768.0;
      }
      const source = voice.audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(voice.audioCtx.destination);
      
      const now = voice.audioCtx.currentTime;
      if (voice.nextPlayTime < now) voice.nextPlayTime = now;
      source.start(voice.nextPlayTime);
      voice.nextPlayTime += audioBuffer.duration;
      
      source.onended = () => {
        if (voice.audioCtx.currentTime >= voice.nextPlayTime - 0.1 && voice.active) {
          setAssistantState("listening", "Listening…");
        }
      };
    }
  };
  
  voice.ws.onclose = () => stopConversation();
  voice.ws.onerror = () => { toast("Live connection error", "error"); stopConversation(); };
  
  const buf = new Uint8Array(voice.analyser.fftSize);
  const loop = () => {
    if (!voice.active) return;
    voice.analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
    voice.levelRAF = requestAnimationFrame(loop);
  };
  voice.levelRAF = requestAnimationFrame(loop);
}

function stopConversation() {
  voice.active = false;
  cancelAnimationFrame(voice.levelRAF);
  try { voice.stream?.getTracks().forEach(t => t.stop()); } catch {}
  try { voice.workletNode?.disconnect(); } catch {}
  try { voice.audioCtx?.close(); } catch {}
  try { if (voice.ws) voice.ws.close(); } catch {}
  voice.stream = voice.audioCtx = voice.workletNode = voice.ws = null;
  setLevel(0);
  setAssistantState("idle", "Idle");
  $("#assistantReply")?.classList.remove("show");
}

// Tap globe toggles the live conversation on/off.
window.addEventListener("globe:click", () => {
  if (voice.active) stopConversation();
  else startConversation();
});

// Typed input is a one-shot, silent turn (fast text, no speech, no re-listen).
function submitTyped() {
  const input = $("#assistantInput");
  const v = input.value.trim();
  if (!v || hudState.busy) return;
  input.value = "";
  
  const send = () => {
    if (voice.ws && voice.ws.readyState === WebSocket.OPEN) {
      voice.ws.send(JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text: v }] }] } }));
    }
  };
  
  if (voice.active) {
    send();
  } else {
    startConversation().then(() => setTimeout(send, 800));
  }
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
