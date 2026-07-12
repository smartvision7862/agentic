import { chromium } from "playwright";
import { GoogleGenAI } from "@google/genai";
import { join } from "path";
import { ROOT_DIR, config } from "./config.js";
import {
  getBigoJob,
  updateBigoJobStatus,
  incrementBigoJobStats,
  addBigoChatMessage,
  addBigoActivityLog
} from "./db.js";
import {
  isProxyConfigured,
  resolveNodeMavenCredentials,
  createProxySessionManager
} from "./nodemaven-proxy.js";

const activeRuns = new Map();

let logBroadcaster = () => {};
export function setBigoLogBroadcaster(fn) {
  logBroadcaster = fn;
}

function broadcastLog(jobId, type, data) {
  logBroadcaster(jobId, { type, ...data });
}

export async function startBigoAgent(jobId) {
  const job = getBigoJob(jobId);
  if (!job) return;

  const runContext = {
    browser: null,
    context: null,
    page: null,
    stopped: false
  };
  activeRuns.set(jobId, runContext);

  (async () => {
    try {
      addBigoActivityLog({ jobId, message: `Starting agent loop for Room ID/URL: ${job.room_id}`, level: "info" });
      broadcastLog(jobId, "system", { message: "Launching Playwright browser..." });

      const userDataDir = join(ROOT_DIR, "data", "bigo-user-data");
      const launchOptions = {
        headless: false,
        slowMo: 50,
      };

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

      const browserContext = await chromium.launchPersistentContext(userDataDir, launchOptions);
      runContext.context = browserContext;
      
      const page = await browserContext.newPage();
      runContext.page = page;

      const targetUrl = job.room_id.startsWith("http") 
        ? job.room_id 
        : `https://www.bigo.tv/${job.room_id}`;

      broadcastLog(jobId, "system", { message: `Navigating to: ${targetUrl}` });
      await page.goto(targetUrl, { timeout: 60000 });

      try {
        broadcastLog(jobId, "system", { message: "Looking for cookie consent/promo overlays..." });
        await page.waitForTimeout(3000);
        const cookieBtn = page.locator('text=Accept all');
        if (await cookieBtn.isVisible()) {
          await cookieBtn.click();
          broadcastLog(jobId, "system", { message: "Cookie consent accepted." });
        }
      } catch (err) {}

      broadcastLog(jobId, "system", { message: "Bigo Live Room loaded. Monitoring chat room..." });
      addBigoActivityLog({ jobId, message: "Live stream room connected successfully.", level: "info" });

      // Fallback key lookup: first try config, then check ENV
      const geminiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
      if (!geminiKey) {
        throw new Error("GEMINI_API_KEY is not set. Please add it to your Settings or .env file.");
      }
      const ai = new GoogleGenAI({ apiKey: geminiKey });

      const processedMessages = new Set();
      let lastScannedCount = -1;
      let zeroCountIterations = 0;

      while (!runContext.stopped) {
        try {
          if (page.isClosed()) {
            throw new Error("Bigo Live browser page was closed.");
          }

          const chatItems = await page.locator('.chat-item').all();
          
          if (chatItems.length !== lastScannedCount) {
            lastScannedCount = chatItems.length;
            broadcastLog(jobId, "system", { message: `Scanner: Detected ${chatItems.length} total messages in the room.` });
          }

          if (chatItems.length === 0) {
            zeroCountIterations++;
            if (zeroCountIterations === 6) {
              broadcastLog(jobId, "system", { message: "⚠️ Warning: No chat messages found yet. Make sure you are logged in and the stream is actively receiving chat comments." });
            }
          } else {
            zeroCountIterations = 0;
          }

          for (const item of chatItems) {
            if (runContext.stopped) break;

            let sender = "";
            let messageText = "";

            try {
              const nameEl = item.locator('.user-name');
              const textEl = item.locator('.user-text-content');

              if (await nameEl.count() > 0) sender = (await nameEl.innerText()).replace(":", "").trim();
              if (await textEl.count() > 0) messageText = (await textEl.innerText()).trim();
            } catch (elErr) {
              continue;
            }

            if (!sender || !messageText) continue;

            const msgSignature = `${sender}:${messageText}`;
            if (processedMessages.has(msgSignature)) continue;

            processedMessages.add(msgSignature);
            incrementBigoJobStats(jobId, false);
            broadcastLog(jobId, "chat_received", { sender, message: messageText });

            addBigoActivityLog({ jobId, message: `New message from ${sender}: "${messageText}"`, level: "info" });
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
              addBigoActivityLog({ jobId, message: `Failed to generate AI reply: ${gemErr.message}`, level: "warn" });
              continue;
            }

            if (!reply) continue;

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
                  addBigoChatMessage({ jobId, sender, message: messageText, reply });
                  incrementBigoJobStats(jobId, true);
                  addBigoActivityLog({ jobId, message: `Replied to ${sender}: "${reply}"`, level: "info" });
                } else {
                  throw new Error("Send button not interactable. Are you logged in?");
                }
              } else {
                throw new Error("Chat input textarea not visible. Stream might be offline or login is required.");
              }
            } catch (sendErr) {
              broadcastLog(jobId, "system", { message: `Send Failure: ${sendErr.message}. Make sure you log in manually in the browser window.` });
              addBigoActivityLog({ jobId, message: `Could not send message: ${sendErr.message}`, level: "warn" });
              addBigoChatMessage({ jobId, sender, message: messageText, reply: `[Failed: ${sendErr.message}]` });
            }
          }
        } catch (pollErr) {
          broadcastLog(jobId, "system", { message: `Error in monitor loop: ${pollErr.message}` });
          await page.waitForTimeout(5000);
        }

        await page.waitForTimeout(2500);
      }

      await browserContext.close();
      updateBigoJobStatus(jobId, "completed");
      broadcastLog(jobId, "system", { message: "Job finished. Browser closed." });
      addBigoActivityLog({ jobId, message: "Job finished successfully.", level: "info" });

    } catch (err) {
      console.error(err);
      updateBigoJobStatus(jobId, "failed");
      broadcastLog(jobId, "system", { message: `CRITICAL ERROR: ${err.message}` });
      addBigoActivityLog({ jobId, message: `Agent loop crashed: ${err.message}`, level: "error" });
      
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
    updateBigoJobStatus(jobId, "completed");
    addBigoActivityLog({ jobId, message: "Agent stopped by user request.", level: "info" });
    broadcastLog(jobId, "system", { message: "Stopping agent..." });
  }
}
