import { WebSocketServer } from "ws";
import { GoogleGenAI } from "@google/genai";
import { genaiTools, systemPrompt, runTool } from "./ai/assistant.js";

// Maps tool names to actual functions for easy lookup
const LIVE_MODEL = "gemini-2.0-flash-exp";

export function setupLiveApiWs(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    if (request.url === '/live') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on("connection", async (ws) => {
    console.log("[LiveAPI] Client connected to /live WebSocket");

    if (!process.env.GEMINI_API_KEY) {
      ws.send(JSON.stringify({ type: "error", message: "GEMINI_API_KEY is not set." }));
      ws.close();
      return;
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    let geminiWs = null;

    try {
      // Create BidiConnect session
      geminiWs = await ai.clients.createWebSocketClient({
        model: LIVE_MODEL,
        config: {
          responseModalities: ["AUDIO"],
          systemInstruction: { parts: [{ text: systemPrompt() }] },
          tools: [{ functionDeclarations: genaiTools.map(t => t.function) }],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Charon" }
            }
          }
        }
      });
    } catch (e) {
      console.error("[LiveAPI] Error connecting to Gemini:", e);
      ws.send(JSON.stringify({ type: "error", message: "Failed to connect to Gemini Live API." }));
      ws.close();
      return;
    }

    geminiWs.connect();

    geminiWs.on("open", () => {
      console.log("[LiveAPI] Connected to Gemini");
      ws.send(JSON.stringify({ type: "state", state: "listening", label: "Listening..." }));
    });

    geminiWs.on("message", async (data) => {
      if (data instanceof Buffer || data instanceof ArrayBuffer) {
        // Forward binary audio directly to client
        if (ws.readyState === 1) ws.send(data);
        return;
      }

      // Handle JSON data from Gemini
      try {
        const msg = typeof data === "string" ? JSON.parse(data) : data;
        
        // Handle tool calls
        if (msg.serverContent?.modelTurn?.parts) {
          for (const part of msg.serverContent.modelTurn.parts) {
            if (part.functionCall) {
              const name = part.functionCall.name;
              const args = part.functionCall.args || {};
              console.log(`[LiveAPI] Tool call: ${name}`, args);
              ws.send(JSON.stringify({ type: "state", state: "thinking", label: `Working (${name})...` }));
              
              let result;
              try {
                result = await runTool(name, args);
              } catch (err) {
                result = { error: err.message };
              }
              
              ws.send(JSON.stringify({ type: "actions", actions: [name], ...result }));
              
              // Send the tool response back to Gemini
              if (geminiWs.readyState === 1) { // 1 = OPEN
                geminiWs.send(JSON.stringify({
                  clientContent: {
                    turnComplete: true,
                    turns: [{
                      role: "user",
                      parts: [{
                        functionResponse: {
                          name,
                          response: result
                        }
                      }]
                    }]
                  }
                }));
              }
            }
          }
        }
      } catch (err) {
        console.error("[LiveAPI] Error parsing message from Gemini:", err);
      }
    });

    geminiWs.on("close", () => {
      console.log("[LiveAPI] Gemini connection closed");
      if (ws.readyState === 1) ws.close();
    });

    geminiWs.on("error", (err) => {
      console.error("[LiveAPI] Gemini connection error:", err);
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: "error", message: "Gemini connection error" }));
    });

    // Handle messages from the browser (raw PCM audio or JSON commands)
    ws.on("message", (message) => {
      if (geminiWs && geminiWs.readyState === 1) { // 1 = OPEN
        if (Buffer.isBuffer(message) || message instanceof ArrayBuffer) {
          // It's raw PCM 16kHz audio from the browser, send to Gemini as realtimeInput
          geminiWs.send(JSON.stringify({
            realtimeInput: {
              mediaChunks: [{
                mimeType: "audio/pcm;rate=16000",
                data: Buffer.from(message).toString("base64")
              }]
            }
          }));
        } else {
          // Typed messages
          geminiWs.send(message);
        }
      }
    });

    ws.on("close", () => {
      console.log("[LiveAPI] Client disconnected");
      if (geminiWs && geminiWs.readyState === 1) geminiWs.close();
    });
  });
}
