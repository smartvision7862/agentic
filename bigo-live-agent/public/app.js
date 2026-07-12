let activeJobId = null;
let eventSource = null;

// Helpers
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Format ISO date to human readable
function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

// ── Tab Management ─────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");

    const view = t.dataset.tab;
    if (view === "chat") {
      $("tabChat").classList.remove("hidden");
      $("tabLogs").classList.add("hidden");
    } else if (view === "logs") {
      $("tabChat").classList.add("hidden");
      $("tabLogs").classList.remove("hidden");
    }
  });
});

// ── Drawer Management ──────────────────────────────────────────────
$("historyBtn").addEventListener("click", async () => {
  $("historyBackdrop").classList.remove("hidden");
  $("historyPanel").classList.remove("hidden");
  await loadHistory();
});

const closeHistory = () => {
  $("historyBackdrop").classList.add("hidden");
  $("historyPanel").classList.add("hidden");
};
$("historyClose").addEventListener("click", closeHistory);
$("historyBackdrop").addEventListener("click", closeHistory);

async function loadHistory() {
  const list = $("historyList");
  list.innerHTML = `<div style="text-align:center;color:var(--muted);padding:20px;">Loading history...</div>`;
  try {
    const res = await fetch("/api/jobs");
    const jobs = await res.json();
    if (!jobs.length) {
      list.innerHTML = `<div style="text-align:center;color:var(--muted);padding:20px;">No past sessions</div>`;
      return;
    }
    list.innerHTML = jobs.map((j) => `
      <div class="history-item" data-id="${j.id}">
        <div class="history-item-top">
          <span>Session #${j.id}</span>
          <span>${fmtDate(j.created_at)}</span>
        </div>
        <div class="history-item-title">Room: ${esc(j.room_id)}</div>
        <div class="history-item-meta">
          <span>💬 ${j.messages_count} messages</span>
          <span>🤖 ${j.replies_count} replies</span>
          <span style="color: ${j.status === 'completed' ? 'var(--accent2)' : j.status === 'active' ? 'var(--warn)' : 'var(--error)'}">
            ${j.status.toUpperCase()}
          </span>
        </div>
      </div>
    `).join('');

    document.querySelectorAll(".history-item").forEach((el) => {
      el.addEventListener("click", () => {
        closeHistory();
        selectJob(parseInt(el.dataset.id));
      });
    });
  } catch (err) {
    list.innerHTML = `<div style="text-align:center;color:var(--error);padding:20px;">Failed to load: ${esc(err.message)}</div>`;
  }
}

// ── Agent Execution ────────────────────────────────────────────────
$("agentForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const roomId = $("roomId").value.trim();
  const useProxy = $("proxyCheck").checked;

  if (!roomId) return;

  $("submitBtn").disabled = true;
  $("submitBtn").textContent = "Launching Agent...";
  $("failureBanner").classList.add("hidden");

  try {
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room_id: roomId, proxy_mode: useProxy })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Launch failed");

    selectJob(data.jobId);
  } catch (err) {
    $("failureBanner").textContent = err.message;
    $("failureBanner").classList.remove("hidden");
    $("submitBtn").disabled = false;
    $("submitBtn").textContent = "Start Agent";
  }
});

$("stopBtn").addEventListener("click", async () => {
  if (!activeJobId) return;
  $("stopBtn").disabled = true;
  $("stopBtn").textContent = "Stopping...";
  try {
    await fetch(`/api/jobs/${activeJobId}/stop`, { method: "POST" });
  } catch (err) {
    console.error(err);
  }
});

// Load and monitor job run
async function selectJob(jobId) {
  activeJobId = jobId;
  
  // Show job view, hide welcome
  $("welcomeView").classList.add("hidden");
  $("jobView").classList.remove("hidden");
  
  // Reset fields
  $("chatFeed").innerHTML = "";
  $("logPanel").innerHTML = "";
  $("statMessages").textContent = "0";
  $("statReplies").textContent = "0";
  $("statRoom").textContent = "—";
  $("statStatus").textContent = "—";

  // Disconnect any existing SSE
  if (eventSource) {
    eventSource.close();
  }

  // Fetch job meta details
  try {
    const res = await fetch(`/api/jobs`);
    const jobs = await res.json();
    const job = jobs.find((j) => j.id === jobId);
    if (job) {
      $("jobTitle").textContent = `Bigo Room: ${job.room_id}`;
      $("jobMeta").textContent = `Started at ${fmtDate(job.created_at)}`;
      $("statRoom").textContent = job.room_id;
      $("statStatus").textContent = job.status.toUpperCase();
      $("statMessages").textContent = job.messages_count;
      $("statReplies").textContent = job.replies_count;

      if (job.status !== "active") {
        $("stopBtn").classList.add("hidden");
        $("submitBtn").disabled = false;
        $("submitBtn").textContent = "Start Agent";
        
        // Load past logs & chats
        loadPastLogs(jobId);
        loadPastChats(jobId);
        return;
      } else {
        $("stopBtn").classList.remove("hidden");
        $("stopBtn").disabled = false;
        $("stopBtn").textContent = "Stop Agent";
        $("submitBtn").disabled = true;
        $("submitBtn").textContent = "Agent Active";
      }
    }
  } catch (err) {
    console.error(err);
  }

  // Start live SSE listener
  eventSource = new EventSource(`/api/jobs/${jobId}/stream`);

  eventSource.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      return;
    }

    if (data.type === "system") {
      logSystem(data.message, "system");
    } else if (data.type === "chat_received") {
      addChatToFeed(data.sender, data.message);
      incrementStat("statMessages");
    } else if (data.type === "chat_sent") {
      addChatReplyToFeed(data.sender, data.message, data.reply);
      incrementStat("statReplies");
    } else if (data.type === "state") {
      $("statStatus").textContent = data.state.toUpperCase();
    } else if (data.type === "error") {
      logSystem(data.message, "error");
      $("statStatus").textContent = "CRASHED";
      stopEventSource();
    }
  };

  eventSource.onerror = () => {
    // If the server disconnects or stops job
    stopEventSource();
    checkHealth();
  };
}

function stopEventSource() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function incrementStat(id) {
  const el = $(id);
  el.textContent = parseInt(el.textContent) + 1;
}

function logSystem(message, className = "") {
  const panel = $("logPanel");
  const row = document.createElement("div");
  row.className = `log-line ${className}`;
  row.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  panel.appendChild(row);
  panel.scrollTop = panel.scrollHeight;
}

function addChatToFeed(sender, message) {
  const feed = $("chatFeed");
  
  // Clear placeholder if any
  const placeholder = feed.querySelector(".chat-placeholder");
  if (placeholder) placeholder.remove();

  const item = document.createElement("div");
  item.className = "chat-msg-item";
  item.innerHTML = `
    <div class="chat-msg-header">
      <span class="chat-msg-sender">${esc(sender)}</span>
      <span>${new Date().toLocaleTimeString()}</span>
    </div>
    <div class="chat-msg-body">${esc(message)}</div>
  `;
  feed.appendChild(item);
  feed.scrollTop = feed.scrollHeight;
}

function addChatReplyToFeed(sender, message, reply) {
  const feed = $("chatFeed");
  
  // Find if we already rendered this user's incoming message
  let foundItem = null;
  const items = feed.querySelectorAll(".chat-msg-item");
  for (let i = items.length - 1; i >= 0; i--) {
    const s = items[i].querySelector(".chat-msg-sender")?.textContent;
    const b = items[i].querySelector(".chat-msg-body")?.textContent;
    if (s === sender && b === message) {
      foundItem = items[i];
      break;
    }
  }

  if (foundItem) {
    // Append reply to existing bubble
    const repDiv = document.createElement("div");
    repDiv.className = "chat-msg-reply";
    repDiv.innerHTML = `<strong>🤖 Jarvis:</strong> ${esc(reply)}`;
    foundItem.appendChild(repDiv);
  } else {
    // Render complete new bubble
    const placeholder = feed.querySelector(".chat-placeholder");
    if (placeholder) placeholder.remove();

    const item = document.createElement("div");
    item.className = "chat-msg-item";
    item.innerHTML = `
      <div class="chat-msg-header">
        <span class="chat-msg-sender">${esc(sender)}</span>
        <span>${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="chat-msg-body">${esc(message)}</div>
      <div class="chat-msg-reply"><strong>🤖 Jarvis:</strong> ${esc(reply)}</div>
    `;
    feed.appendChild(item);
  }
  
  feed.scrollTop = feed.scrollHeight;
}

async function loadPastLogs(jobId) {
  try {
    const res = await fetch(`/api/jobs/${jobId}/logs`);
    const logs = await res.json();
    const panel = $("logPanel");
    panel.innerHTML = logs.map((l) => `
      <div class="log-line ${l.level === 'error' ? 'error' : l.level === 'warn' ? 'system' : ''}">
        [${new Date(l.created_at).toLocaleTimeString()}] ${esc(l.message)}
      </div>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

async function loadPastChats(jobId) {
  try {
    const res = await fetch(`/api/jobs/${jobId}/chats`);
    const chats = await res.json();
    const feed = $("chatFeed");
    if (!chats.length) {
      feed.innerHTML = `<div class="chat-placeholder">No chats recorded for this session.</div>`;
      return;
    }
    feed.innerHTML = chats.map((c) => `
      <div class="chat-msg-item">
        <div class="chat-msg-header">
          <span class="chat-msg-sender">${esc(c.sender)}</span>
          <span>${new Date(c.created_at).toLocaleTimeString()}</span>
        </div>
        <div class="chat-msg-body">${esc(c.message)}</div>
        ${c.reply ? `<div class="chat-msg-reply"><strong>🤖 Jarvis:</strong> ${esc(c.reply)}</div>` : ''}
      </div>
    `).reverse().join('');
  } catch (err) {
    console.error(err);
  }
}

// ── Health/Init ─────────────────────────────────────────────────────
async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();

    const pill = $("serverStatus");
    pill.textContent = "Online";
    pill.className = "status-pill online";

    // Disable proxy checkbox if not configured in .env
    if (!data.proxy || !data.proxy.configured) {
      $("proxyCheck").disabled = true;
      $("proxyCheck").checked = false;
      const label = $("proxyCheck").parentElement;
      label.style.opacity = "0.5";
      label.title = "Configure NODEMAVEN_API_KEY in .env to use proxies";
    } else {
      $("proxyCheck").disabled = false;
      const label = $("proxyCheck").parentElement;
      label.style.opacity = "1";
    }

    // Restore active job if server has one
    if (data.activeJobId && activeJobId !== data.activeJobId) {
      selectJob(data.activeJobId);
    } else if (!data.activeJobId && activeJobId) {
      // Current active job finished
      const lastId = activeJobId;
      activeJobId = null;
      selectJob(lastId);
    }
  } catch (err) {
    const pill = $("serverStatus");
    pill.textContent = "Offline";
    pill.className = "status-pill";
    
    $("submitBtn").disabled = false;
    $("submitBtn").textContent = "Start Agent";
  }
}

checkHealth();
setInterval(checkHealth, 5000);
