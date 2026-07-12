import { chromium } from "playwright";
import { GoogleGenAI } from "@google/genai";
import { join } from "path";
import { ROOT_DIR, config } from "./config.js";
import {
  getJob,
  updateJobStatus,
  incrementJobStats,
  addChatMessage,
  addActivityLog
} from "./db.js";
import {
  isProxyConfigured,
  resolveNodeMavenCredentials,
  createProxySessionManager
} from "./nodemaven-proxy.js";

// Keep track of active Playwright instances
const activeRuns = new Map();

// Helper to broadcast logs to SSE streams
let logBroadcaster = () => {};
export function setLogBroadcaster(fn) {
  logBroadcaster = fn;
}

function broadcastLog(jobId, type, data) {
  logBroadcaster(jobId, { type, ...data });
}

export async function startBigoAgent(jobId) {
  const job = getJob(jobId);
  if (!job) return;

  const runContext = {
    browser: null,
    context: null,
    page: null,
    stopped: false
  };
  activeRuns.set(jobId, runContext);

  // Run in background
  (async () => {
    try {
      addActivityLog({ jobId, message: `Starting agent loop for Room ID/URL: ${job.room_id}`, level: "info" });
      broadcastLog(jobId, "system", { message: "Launching Playwright browser..." });

      // Determine browser options
      const userDataDir = join(ROOT_DIR, "data", "bigo-user-data");
      const launchOptions = {
        headless: false, // Must be visible so the user can log in
        slowMo: 50,
      };

      // Set up proxy if configured and requested
      if (job.proxy_mode === 1) {
        if (!isProxyConfigured()) {
          throw new Error("Proxy mode requested but NodeMaven not configured in .env");
        }
        broadcastLog(jobId, "system", { message: "Resolving NodeMaven credentials..." });
        const credentials = await resolveNodeMavenCredentials();
        const manager = createProxySessionManager({ credentials });
        const rot = manager.rotateForSite("bigo.tv");
        launchOptions.proxy = {
          server: rot.proxyServer,
          username: rot.username,
          password: rot.password
        };
        broadcastLog(jobId, "system", { message: `Using proxy egress server: ${rot.proxyServer}` });
      }

      // Launch persistent context so logins stay saved
      const browserContext = await chromium.launchPersistentContext(userDataDir, launchOptions);
      runContext.context = browserContext;
      
      const page = await browserContext.newPage();
      runContext.page = page;

      // Navigate to Bigo Room
      const targetUrl = job.room_id.startsWith("http") 
        ? job.room_id 
        : `https://www.bigo.tv/${job.room_id}`;

      broadcastLog(jobId, "system", { message: `Navigating to: ${targetUrl}` });
      await page.goto(targetUrl, { timeout: 60000 });

      // Handle overlays or cookies if any
      try {
        broadcastLog(jobId, "system", { message: "Looking for cookie consent/promo overlays..." });
        await page.waitForTimeout(3000);
        // Accept cookies
        const cookieBtn = page.locator('text=Accept all');
        if (await cookieBtn.isVisible()) {
          await cookieBtn.click();
          broadcastLog(jobId, "system", { message: "Cookie consent accepted." });
        }
      } catch (err) {
        // Ignore overlay errors
      }

      broadcastLog(jobId, "system", { message: "Bigo Live Room loaded. Monitoring chat room..." });
      addActivityLog({ jobId, message: "Live stream room connected successfully.", level: "info" });

      // Initialize Gemini Client
      const geminiKey = config.geminiApiKey;
      if (!geminiKey) {
        throw new Error("GEMINI_API_KEY is not set. Please add it to your Settings or .env file.");
      }
      const ai = new GoogleGenAI({ apiKey: geminiKey });

      // Set of seen messages to avoid duplicate responses
      const processedMessages = new Set();
      let lastScannedCount = -1;
      let zeroCountIterations = 0;

      // Main polling loop
      while (!runContext.stopped) {
        try {
          // Verify if page is still alive
          if (page.isClosed()) {
            throw new Error("Bigo Live browser page was closed.");
          }

          // Read all chat items
          const chatItems = await page.locator('.chat-item').all();
          
          if (chatItems.length !== lastScannedCount) {
            lastScannedCount = chatItems.length;
            broadcastLog(jobId, "system", { message: `Scanner: Detected ${chatItems.length} total messages in the room.` });
          }

          if (chatItems.length === 0) {
            zeroCountIterations++;
            if (zeroCountIterations === 6) { // ~15 seconds of no messages
              broadcastLog(jobId, "system", { message: "⚠️ Warning: No chat messages found yet. Make sure you are logged in and the stream is actively receiving chat comments." });
            }
          } else {
            zeroCountIterations = 0;
          }
          
          for (const item of chatItems) {
            if (runContext.stopped) break;

            // Get sender and text contents
            let sender = "";
            let messageText = "";

            try {
              const nameEl = item.locator('.user-name');
              const textEl = item.locator('.user-text-content');

              if (await nameEl.count() > 0) sender = (await nameEl.innerText()).replace(":", "").trim();
              if (await textEl.count() > 0) messageText = (await textEl.innerText()).trim();
            } catch (elErr) {
              continue; // Skip malformed item
            }

            if (!sender || !messageText) continue;

            const msgSignature = `${sender}:${messageText}`;
            if (processedMessages.has(msgSignature)) continue;

            // Mark as processed
            processedMessages.add(msgSignature);
            incrementJobStats(jobId, false);
            broadcastLog(jobId, "chat_received", { sender, message: messageText });

            // Run Gemini Live Assistant response
            addActivityLog({ jobId, message: `New message from ${sender}: "${messageText}"`, level: "info" });
            broadcastLog(jobId, "system", { message: `Generating response for ${sender}...` });

            let reply = "";
            try {
              const prompt = `You are a live chatbot assistant in a Bigo Live room. 
Respond directly to the user in 1-2 very short sentences. 
CRITICAL: Respond in the EXACT same language as the message (e.g. if it is in Arabic, reply in Arabic; if in English, reply in English; if in Spanish, reply in Spanish).
No markdown, no links, and no emojis.
Commenter Name: ${sender}
Message: ${messageText}`;

              const response = await ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: prompt,
              });

              reply = response.text?.trim() || "";
            } catch (gemErr) {
              broadcastLog(jobId, "system", { message: `Gemini Error: ${gemErr.message}` });
              addActivityLog({ jobId, message: `Failed to generate AI reply: ${gemErr.message}`, level: "warn" });
              continue;
            }

            if (!reply) continue;

            // Attempt to type and send reply in browser
            try {
              const inputArea = page.locator('.user_sent_msg textarea');
              const sendBtn = page.locator('.user_sent_msg .send_btn');

              if (await inputArea.isVisible()) {
                await inputArea.click();
                await inputArea.fill(reply);
                await page.waitForTimeout(200);

                if (await sendBtn.isVisible()) {
                  await sendBtn.click();
                  broadcastLog(jobId, "chat_sent", { sender, message: messageText, reply });
                  addChatMessage({ jobId, sender, message: messageText, reply });
                  incrementJobStats(jobId, true);
                  addActivityLog({ jobId, message: `Replied to ${sender}: "${reply}"`, level: "info" });
                } else {
                  throw new Error("Send button not interactable. Are you logged in?");
                }
              } else {
                throw new Error("Chat input textarea not visible. Stream might be offline or login is required.");
              }
            } catch (sendErr) {
              broadcastLog(jobId, "system", { message: `Send Failure: ${sendErr.message}. Make sure you log in manually in the browser window.` });
              addActivityLog({ jobId, message: `Could not send message: ${sendErr.message}`, level: "warn" });
              // Save to database anyway as unresolved
              addChatMessage({ jobId, sender, message: messageText, reply: `[Failed: ${sendErr.message}]` });
            }
          }
        } catch (pollErr) {
          broadcastLog(jobId, "system", { message: `Error in active monitor loop: ${pollErr.message}` });
          await page.waitForTimeout(5000);
        }

        await page.waitForTimeout(2500); // Poll interval
      }

      // Cleanup context
      await browserContext.close();
      updateJobStatus(jobId, "completed");
      broadcastLog(jobId, "system", { message: "Job finished. Browser closed." });
      addActivityLog({ jobId, message: "Job finished successfully.", level: "info" });

    } catch (err) {
      console.error(err);
      updateJobStatus(jobId, "failed");
      broadcastLog(jobId, "system", { message: `CRITICAL ERROR: ${err.message}` });
      addActivityLog({ jobId, message: `Agent loop crashed: ${err.message}`, level: "error" });
      
      if (runContext.context) {
        try { await runContext.context.close(); } catch {}
      }
    } finally {
      activeRuns.delete(jobId);
    }
  })();
}

export async function stopBigoAgent(jobId) {
  const runContext = activeRuns.get(jobId);
  if (runContext) {
    runContext.stopped = true;
    updateJobStatus(jobId, "completed");
    addActivityLog({ jobId, message: "Agent stopped by user request.", level: "info" });
    broadcastLog(jobId, "system", { message: "Stopping agent..." });
  }
}
