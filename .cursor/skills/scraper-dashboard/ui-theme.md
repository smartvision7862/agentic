# Dark Scraper Dashboard UI Theme

Portable, self-contained UI spec. Copy into `public/` for any new dashboard. **Default theme** unless user explicitly requests light/React style.

## Fonts (index.html `<head>`)

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/styles.css" />
```

## Color tokens

| Token | Value | Use |
|-------|-------|-----|
| `--bg` | `#08080c` | Page background |
| `--bg-mesh-1` | `rgba(99, 102, 241, 0.12)` | Radial gradient accent |
| `--bg-mesh-2` | `rgba(16, 185, 129, 0.06)` | Radial gradient secondary |
| `--surface` | `rgba(18, 18, 24, 0.82)` | Glass cards |
| `--surface-solid` | `#121218` | History drawer |
| `--surface-raised` | `#1a1a22` | Inputs, raised panels |
| `--surface-hover` | `#22222c` | Hover states |
| `--border` | `rgba(255, 255, 255, 0.07)` | Card borders |
| `--border-strong` | `rgba(255, 255, 255, 0.12)` | Emphasized borders |
| `--text` | `#f4f4f5` | Primary text |
| `--text-secondary` | `#a1a1aa` | Labels |
| `--muted` | `#71717a` | Hints, subtitles |
| `--accent` | `#6366f1` | Primary indigo |
| `--accent-hover` | `#818cf8` | Active/hover accent |
| `--accent-soft` | `rgba(99, 102, 241, 0.14)` | Active toggle bg |
| `--accent-glow` | `rgba(99, 102, 241, 0.35)` | Button shadow |
| `--accent2` | `#34d399` | Success / online |
| `--accent2-soft` | `rgba(52, 211, 153, 0.12)` | Online pill bg |
| `--warn` | `#fbbf24` | Partial/warning |
| `--error` | `#f87171` | Failures |
| `--radius` | `16px` | Cards |
| `--radius-sm` | `10px` | Inputs, inner panels |
| `--radius-xs` | `8px` | Small chips |
| `--font` | `"Plus Jakarta Sans", system-ui, sans-serif` | UI |
| `--mono` | `"JetBrains Mono", ui-monospace, monospace` | Logs |
| `--transition` | `0.2s cubic-bezier(0.4, 0, 0.2, 1)` | All transitions |

## Layout regions

```
.app (max-width 1480px, centered)
├── header
│   ├── .logo → .logo-icon (48×48 gradient) + h1 + .subtitle
│   └── .header-actions → History btn, Local/Proxy .route-toggle, #serverStatus.status-pill
├── .grid (380px sidebar | 1fr main)
│   ├── aside → .card.sidebar-card
│   │   ├── .sidebar-fixed — h2 + primary input
│   │   └── .sidebar-scroll — form controls + .btn-primary
│   └── main.card.card-main
│       ├── #welcomeView.empty — emoji + chips
│       └── #jobView.hidden — stats, tabs, results, logs
├── #historyBackdrop.history-backdrop.hidden
└── #historyPanel.history-panel.hidden — right drawer
```

## HTML shell (public/index.html)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Scraper Dashboard</title>
  <!-- fonts + styles.css links -->
</head>
<body>
  <div class="app">
    <header>
      <div class="logo">
        <div class="logo-icon">🔍</div>
        <div>
          <h1>Scraper Dashboard</h1>
          <p class="subtitle">Live extraction · Proxy rotation · Export</p>
        </div>
      </div>
      <div class="header-actions">
        <button type="button" id="historyBtn" class="header-btn">History</button>
        <div class="route-toggle" id="routeToggle">
          <button type="button" class="route-btn active" data-mode="local">Local</button>
          <button type="button" class="route-btn" data-mode="proxy" id="proxyRouteBtn">Proxy</button>
        </div>
        <span id="serverStatus" class="status-pill">Checking server…</span>
      </div>
    </header>

    <div class="grid">
      <aside>
        <div class="card sidebar-card">
          <div class="sidebar-fixed">
            <h2>New search</h2>
            <label for="query">Search query</label>
            <input type="text" id="query" form="searchForm" placeholder="e.g. digital marketing agency" required />
          </div>
          <div class="sidebar-scroll">
            <form id="searchForm">
              <div class="mode-section">
                <label class="toggle-row">
                  <span>Use proxy</span>
                  <input type="checkbox" id="proxyCheck" />
                  <span class="toggle-track"></span>
                </label>
              </div>
              <div class="slider-row">
                <div class="slider-header">
                  <label for="count">Max results</label>
                  <span id="countLabel" class="count-badge">50</span>
                </div>
                <input type="range" id="count" min="5" max="200" value="50" step="5" />
              </div>
              <button type="submit" class="btn-primary" id="submitBtn">Start scrape</button>
            </form>
          </div>
        </div>
      </aside>

      <main class="card card-main">
        <div id="welcomeView" class="empty">
          <div class="empty-icon">🚀</div>
          <p>Enter a query and start scraping. Live logs and results appear here.</p>
          <div class="welcome-features">
            <span class="welcome-chip">Live SSE</span>
            <span class="welcome-chip">Proxy toggle</span>
            <span class="welcome-chip">CSV export</span>
          </div>
        </div>
        <div id="jobView" class="hidden">
          <div class="job-header">
            <div class="job-header-row">
              <div>
                <h3 id="jobTitle">—</h3>
                <p id="jobMeta">—</p>
              </div>
              <div class="job-header-actions">
                <a id="exportBtn" class="header-btn hidden" href="#" download>Export CSV</a>
                <button type="button" id="stopBtn" class="btn-stop hidden">Stop</button>
              </div>
            </div>
          </div>
          <div id="failureBanner" class="failure-banner hidden"></div>
          <div class="stats-row">
            <div class="stat"><div class="val" id="statTotal">0</div><div class="lbl">Collected</div></div>
            <div class="stat"><div class="val" id="statSuccess">0</div><div class="lbl">Success</div></div>
            <div class="stat stat-stat-failed"><div class="val" id="statFailed">0</div><div class="lbl">Failed</div></div>
            <div class="stat"><div class="val" id="statStatus">—</div><div class="lbl">Status</div></div>
          </div>
          <div class="tabs">
            <button type="button" class="tab active" data-tab="results">Results</button>
            <button type="button" class="tab" data-tab="logs">Logs</button>
          </div>
          <div id="tabResults"><div id="resultsPanel" class="results-panel"></div></div>
          <div id="tabLogs" class="hidden"><div id="logPanel" class="log-panel"></div></div>
        </div>
      </main>
    </div>
  </div>

  <div id="historyBackdrop" class="history-backdrop hidden"></div>
  <aside id="historyPanel" class="history-panel hidden" aria-hidden="true">
    <div class="history-panel-header">
      <h2>Past jobs</h2>
      <button type="button" id="historyClose" class="history-panel-close">×</button>
    </div>
    <div id="historyList" class="history-list"></div>
  </aside>

  <script src="/app.js"></script>
</body>
</html>
```

## Core CSS (public/styles.css)

Copy this block as the foundation. Extend with project-specific results table or gallery.

```css
:root {
  --bg: #08080c;
  --bg-mesh-1: rgba(99, 102, 241, 0.12);
  --bg-mesh-2: rgba(16, 185, 129, 0.06);
  --surface: rgba(18, 18, 24, 0.82);
  --surface-solid: #121218;
  --surface-raised: #1a1a22;
  --surface-hover: #22222c;
  --border: rgba(255, 255, 255, 0.07);
  --border-strong: rgba(255, 255, 255, 0.12);
  --text: #f4f4f5;
  --text-secondary: #a1a1aa;
  --muted: #71717a;
  --accent: #6366f1;
  --accent-hover: #818cf8;
  --accent-soft: rgba(99, 102, 241, 0.14);
  --accent-glow: rgba(99, 102, 241, 0.35);
  --accent2: #34d399;
  --accent2-soft: rgba(52, 211, 153, 0.12);
  --warn: #fbbf24;
  --error: #f87171;
  --radius: 16px;
  --radius-sm: 10px;
  --radius-xs: 8px;
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.25);
  --shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
  --shadow-lg: 0 20px 50px rgba(0, 0, 0, 0.55);
  --font: "Plus Jakarta Sans", system-ui, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, monospace;
  --transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100vh;
  font-family: var(--font);
  background: var(--bg);
  background-image:
    radial-gradient(ellipse 90% 60% at 50% -30%, var(--bg-mesh-1), transparent 55%),
    radial-gradient(ellipse 50% 40% at 100% 0%, var(--bg-mesh-2), transparent 50%);
  color: var(--text);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

.app { max-width: 1480px; margin: 0 auto; padding: 28px 24px 56px; }

header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 32px; flex-wrap: wrap; }
.logo { display: flex; align-items: center; gap: 14px; }
.logo-icon {
  width: 48px; height: 48px; border-radius: 14px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%);
  display: grid; place-items: center; font-size: 22px;
  box-shadow: 0 4px 20px var(--accent-glow);
}
h1 { margin: 0; font-size: 1.4rem; font-weight: 700; letter-spacing: -0.02em; }
.subtitle { margin: 3px 0 0; font-size: 0.84rem; color: var(--muted); }

.header-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.header-btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 14px; border-radius: 999px;
  border: 1px solid var(--border); background: var(--surface-raised);
  color: var(--text-secondary); font-family: inherit; font-size: 0.8rem; font-weight: 600;
  cursor: pointer; transition: background var(--transition), color var(--transition);
}
.header-btn:hover { color: var(--text); background: var(--surface-hover); }

.route-toggle {
  display: inline-flex; padding: 4px; border-radius: 999px;
  background: var(--surface-raised); border: 1px solid var(--border);
}
.route-btn {
  padding: 7px 16px; border: none; border-radius: 999px; background: transparent;
  color: var(--muted); font-family: inherit; font-size: 0.8rem; font-weight: 600; cursor: pointer;
}
.route-btn.active { background: var(--accent-soft); color: var(--accent-hover); }
.route-btn:disabled { opacity: 0.35; cursor: not-allowed; }

.status-pill {
  padding: 7px 14px; border-radius: 999px; font-size: 0.78rem; font-weight: 500;
  background: var(--surface-raised); border: 1px solid var(--border); color: var(--muted);
}
.status-pill.online { color: var(--accent2); border-color: rgba(52, 211, 153, 0.25); background: var(--accent2-soft); }
.status-pill.online::before {
  content: ""; display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  background: var(--accent2); margin-right: 7px; box-shadow: 0 0 8px var(--accent2); vertical-align: middle;
}

.grid { display: grid; grid-template-columns: 380px 1fr; gap: 24px; align-items: start; }
@media (max-width: 1024px) { .grid { grid-template-columns: 1fr; } }
.grid > aside { position: sticky; top: 24px; max-height: calc(100vh - 120px); }

.sidebar-card { display: flex; flex-direction: column; padding: 0; overflow: hidden; max-height: calc(100vh - 120px); }
.sidebar-fixed { flex-shrink: 0; padding: 22px 22px 16px; border-bottom: 1px solid var(--border); }
.sidebar-scroll { flex: 1; overflow-y: auto; padding: 16px 22px 22px; }

.card {
  background: var(--surface); backdrop-filter: blur(16px);
  border: 1px solid var(--border); border-radius: var(--radius);
  padding: 22px; box-shadow: var(--shadow);
}
.card-main { min-height: 520px; }
.card h2 { margin: 0 0 18px; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }

label { display: block; font-size: 0.82rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px; }
input[type="text"] {
  width: 100%; padding: 13px 16px; border-radius: var(--radius-sm);
  border: 1px solid var(--border); background: var(--surface-raised); color: var(--text);
  font-family: inherit; font-size: 0.95rem; outline: none;
}
input[type="text"]:focus { border-color: rgba(99, 102, 241, 0.5); box-shadow: 0 0 0 3px var(--accent-soft); }

.toggle-row { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; font-size: 0.82rem; font-weight: 600; color: var(--text-secondary); }
.toggle-row input { position: absolute; opacity: 0; width: 0; height: 0; }
.toggle-track {
  width: 42px; height: 24px; border-radius: 999px; background: var(--surface-hover);
  border: 1px solid var(--border); position: relative; flex-shrink: 0;
}
.toggle-track::after {
  content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; transition: transform var(--transition);
}
.toggle-row input:checked + .toggle-track { background: var(--accent); border-color: var(--accent); }
.toggle-row input:checked + .toggle-track::after { transform: translateX(18px); }

.count-badge { font-size: 1.15rem; font-weight: 700; color: var(--accent-hover); }
.slider-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
input[type="range"] { width: 100%; height: 6px; appearance: none; background: var(--surface-hover); border-radius: 999px; }

.btn-primary {
  width: 100%; margin-top: 22px; padding: 14px 20px; border: none; border-radius: var(--radius-sm);
  background: linear-gradient(135deg, #6366f1 0%, #7c3aed 100%); color: white;
  font-family: inherit; font-size: 0.92rem; font-weight: 600; cursor: pointer;
  box-shadow: 0 4px 20px var(--accent-glow);
}
.btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }

.history-backdrop { position: fixed; inset: 0; z-index: 900; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px); }
.history-panel {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 901;
  width: min(380px, 92vw); background: var(--surface-solid);
  border-left: 1px solid var(--border); box-shadow: var(--shadow-lg);
  display: flex; flex-direction: column; animation: slideInRight 0.22s ease;
}
@keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
.history-panel-header { display: flex; align-items: center; justify-content: space-between; padding: 20px; border-bottom: 1px solid var(--border); }
.history-list { flex: 1; overflow-y: auto; padding: 12px 14px 20px; }
.history-item { padding: 12px 14px; border-radius: var(--radius-sm); cursor: pointer; margin-bottom: 4px; }
.history-item:hover { background: var(--surface-raised); }
.history-item.active { background: var(--accent-soft); border: 1px solid rgba(99,102,241,0.25); }

.badge { display: inline-flex; padding: 3px 9px; border-radius: 999px; font-size: 0.68rem; font-weight: 600; }
.badge.completed { background: var(--accent2-soft); color: var(--accent2); }
.badge.failed { background: rgba(248,113,113,0.12); color: var(--error); }
.badge.running, .badge.pending { background: var(--accent-soft); color: var(--accent-hover); }
.badge.cancelled { background: rgba(161,161,170,0.1); color: var(--muted); }

.stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
.stat { background: var(--surface-raised); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 16px; text-align: center; }
.stat .val { font-size: 1.6rem; font-weight: 700; }
.stat .lbl { font-size: 0.7rem; color: var(--muted); margin-top: 6px; text-transform: uppercase; }
.stat-stat-failed .val { color: var(--error); }

.tabs { display: flex; gap: 4px; margin-bottom: 20px; padding: 4px; background: var(--surface-raised); border-radius: var(--radius-sm); border: 1px solid var(--border); width: fit-content; }
.tab { padding: 9px 18px; border: none; background: transparent; color: var(--muted); font-family: inherit; font-size: 0.82rem; font-weight: 600; cursor: pointer; border-radius: var(--radius-xs); }
.tab.active { background: var(--accent-soft); color: var(--accent-hover); }

.log-panel {
  background: #060608; border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: 14px; min-height: 320px; max-height: 400px; overflow-y: auto;
  font-family: var(--mono); font-size: 0.78rem; line-height: 1.6;
}
.log-line.error { color: var(--error); }
.log-line.warn { color: var(--warn); }
.log-line.success { color: var(--accent2); }
.log-line .time { color: var(--muted); margin-right: 8px; }

.btn-stop {
  padding: 9px 16px; border-radius: var(--radius-xs);
  border: 1px solid rgba(248,113,113,0.3); background: rgba(248,113,113,0.08);
  color: #fca5a5; font-family: inherit; font-size: 0.8rem; font-weight: 600; cursor: pointer;
}
.failure-banner {
  background: rgba(248,113,113,0.08); border: 1px solid rgba(248,113,113,0.25);
  color: #fca5a5; padding: 12px 16px; border-radius: var(--radius-sm); margin-bottom: 20px;
}

.empty { text-align: center; padding: 60px 24px; color: var(--muted); }
.empty-icon { font-size: 3rem; margin-bottom: 16px; }
.welcome-features { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 20px; }
.welcome-chip { padding: 6px 12px; border-radius: 999px; border: 1px solid var(--border); font-size: 0.76rem; color: var(--text-secondary); }

.hidden { display: none !important; }
.mode-section { margin-top: 20px; }
.form-divider { height: 1px; background: var(--border); margin: 20px 0; }
```

## JS skeleton (public/app.js)

```js
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let activeJobId = null;
let eventSource = null;
let proxyConfigured = false;
let routeMode = "local";

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function statusBadge(status) {
  const labels = { completed: "Completed", running: "Running", failed: "Failed", pending: "Pending", cancelled: "Cancelled" };
  return `<span class="badge ${status}">${escapeHtml(labels[status] || status)}</span>`;
}

async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    if (res.ok) {
      const data = await res.json();
      proxyConfigured = Boolean(data.proxy?.configured);
      if (routeMode === "proxy" && !proxyConfigured) routeMode = "local";
      syncRouteUI();
      $("#serverStatus").textContent = proxyConfigured ? "Server online · NodeMaven ready" : "Server online";
      $("#serverStatus").classList.add("online");
    }
  } catch {
    $("#serverStatus").textContent = "Server offline";
    $("#serverStatus").classList.remove("online");
  }
}

function syncRouteUI() {
  $$("#routeToggle .route-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === routeMode);
    btn.disabled = btn.dataset.mode === "proxy" && !proxyConfigured;
  });
}

$$("#routeToggle .route-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.mode === "proxy" && !proxyConfigured) {
      alert("Set NODEMAVEN_API_KEY in .env to enable proxy.");
      return;
    }
    routeMode = btn.dataset.mode;
    syncRouteUI();
  });
});

function openHistoryPanel() {
  $("#historyPanel").classList.remove("hidden");
  $("#historyBackdrop").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeHistoryPanel() {
  $("#historyPanel").classList.add("hidden");
  $("#historyBackdrop").classList.add("hidden");
  document.body.style.overflow = "";
}

$("#historyBtn")?.addEventListener("click", () => { openHistoryPanel(); loadHistory(); });
$("#historyClose")?.addEventListener("click", closeHistoryPanel);
$("#historyBackdrop")?.addEventListener("click", closeHistoryPanel);

async function loadHistory() {
  const res = await fetch("/api/jobs");
  const jobs = await res.json();
  const list = $("#historyList");
  list.innerHTML = jobs.map((j) => `
    <div class="history-item${j.id === activeJobId ? " active" : ""}" data-id="${j.id}">
      <div class="q">${escapeHtml(j.query)}</div>
      <div class="meta">${statusBadge(j.status)} · ${formatTime(j.created_at)}</div>
    </div>
  `).join("");
  list.querySelectorAll(".history-item").forEach((el) => {
    el.addEventListener("click", () => selectJob(el.dataset.id));
  });
}

function switchTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $("#tabResults").classList.toggle("hidden", name !== "results");
  $("#tabLogs").classList.toggle("hidden", name !== "logs");
}

$$(".tab").forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));

function appendLog(log) {
  const panel = $("#logPanel");
  const line = document.createElement("div");
  line.className = `log-line ${log.level}`;
  line.innerHTML = `<span class="time">${new Date(log.created_at).toLocaleTimeString()}</span> [${log.level.toUpperCase()}] ${escapeHtml(log.message)}`;
  panel.appendChild(line);
  panel.scrollTop = panel.scrollHeight;
}

function connectStream(id) {
  if (eventSource) eventSource.close();
  eventSource = new EventSource(`/api/jobs/${id}/stream`);
  eventSource.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    if (data.type === "log") appendLog(data.log);
    if (data.type === "progress") {
      $("#statTotal").textContent = data.collected ?? 0;
    }
    if (data.type === "done") {
      eventSource.close();
      selectJob(id);
    }
  };
}

function renderJob(job) {
  $("#welcomeView").classList.add("hidden");
  $("#jobView").classList.remove("hidden");
  $("#jobTitle").textContent = job.query;
  $("#jobMeta").innerHTML = `${statusBadge(job.status)} · ${formatTime(job.created_at)}`;
  $("#statTotal").textContent = job.collected_count ?? 0;
  $("#statStatus").textContent = job.status;
  $("#logPanel").innerHTML = "";
  (job.logs || []).forEach(appendLog);
  const running = job.status === "running" || job.status === "pending";
  $("#stopBtn").classList.toggle("hidden", !running);
  $("#exportBtn").classList.toggle("hidden", job.status !== "completed");
  if (job.status === "completed") $("#exportBtn").href = `/api/jobs/${job.id}/export.csv`;
  if (running) connectStream(job.id);
}

async function selectJob(id) {
  activeJobId = id;
  const res = await fetch(`/api/jobs/${id}`);
  renderJob(await res.json());
  loadHistory();
}

$("#searchForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = $("#query").value.trim();
  const count = Number($("#count").value);
  const proxyMode = routeMode === "proxy";
  $("#submitBtn").disabled = true;
  try {
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, count, proxyMode }),
    });
    const job = await res.json();
    if (!res.ok) { alert(job.reason || job.error); return; }
    await selectJob(job.id);
    closeHistoryPanel();
  } finally {
    $("#submitBtn").disabled = false;
  }
});

$("#count")?.addEventListener("input", () => { $("#countLabel").textContent = $("#count").value; });

checkHealth();
loadHistory();
```

## Component checklist

When building a new dashboard, include:

- [ ] Header with logo gradient icon + subtitle
- [ ] History button → right drawer (not inline sidebar)
- [ ] Local/Proxy `.route-toggle` in header
- [ ] `#serverStatus.status-pill.online` on health check
- [ ] Sidebar: `.sidebar-fixed` + `.sidebar-scroll`
- [ ] Primary CTA: `.btn-primary` full width
- [ ] Welcome state: `.empty` + `.welcome-chip` features
- [ ] Job view: stats row (4 cards) + tabs + log panel
- [ ] Status badges for job history items
- [ ] SSE via `EventSource` on `/api/jobs/:id/stream`

## Override: light spreadsheet theme

Only when user explicitly asks for HR/export-heavy UX:
- `--bg: #f0f4f9`, `--surface: #ffffff`, `--accent: #1a73e8`
- Font: DM Sans
- History inline in sidebar (no right drawer)
- Green sticky table header for sheet view
