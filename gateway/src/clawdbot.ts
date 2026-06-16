import { execSync, spawn } from "child_process";
import { Firestore } from "firebase-admin/firestore";

// Clawdbot system prompt - the personality and capabilities of the assistant
const CLAWDBOT_SYSTEM_PROMPT = `You are Moltbot, the user's personal AI assistant powered by clawd.run.

Your personality:
- Friendly but concise - you don't ramble
- Helpful and proactive - you anticipate what users might need
- Technically capable - you can explain complex topics simply
- Honest about limitations - if you don't know something, say so

FIRST MESSAGE: If this appears to be the user's first message or greeting (like "hi", "hello", "hey"), give a brief, warm welcome. Don't over-explain your capabilities - just say hi and ask how you can help. Keep it to 1-2 sentences max.

You have access to web search for current information. Use it when:
- Asked about recent events, news, or trends
- Need current prices, statistics, or data
- Researching topics that may have changed since your training

IMAGE DISPLAY: The chat interface CAN render images inline! When sharing images:
- Use Markdown format: ![description](/path/to/image.png)
- Sandbox paths like /home/node/... will be served automatically
- HTTP URLs also work: ![alt](https://example.com/image.png)
- Just provide the image reference - no need for lengthy explanations about how to access files
- Keep image descriptions brief - the user will see the actual image

Remember: You're the user's dedicated AI assistant. Be helpful, be brief, be accurate.`;

// In-memory cache for fast access (backed by Firebase)
const historyCache: Map<string, Array<{ role: "user" | "assistant"; content: string }>> = new Map();
const MAX_HISTORY = 20; // Keep last 20 messages per conversation

// Firestore reference (set by init)
let db: Firestore | null = null;

export class ClawdbotManager {
  private ready: boolean = true;

  constructor(firestore?: Firestore) {
    if (firestore) {
      db = firestore;
    }
  }

  async start(): Promise<void> {
    console.log("[Clawdbot] Ready (using openclaw CLI)");
    this.ready = true;
  }

  // Load history from Firebase
  private async loadHistory(userId: string): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
    // Check cache first
    if (historyCache.has(userId)) {
      return historyCache.get(userId)!;
    }

    // Load from Firebase if available
    if (db) {
      try {
        const historyRef = db
          .collection("conversation_history")
          .doc(userId)
          .collection("channels")
          .doc("web");
        
        const historyDoc = await historyRef.get();
        
        if (historyDoc.exists) {
          const data = historyDoc.data() || {};
          const messages = (data.messages || []).slice(-MAX_HISTORY).map((m: { role: string; content: string }) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));
          historyCache.set(userId, messages);
          return messages;
        }
      } catch (error) {
        console.error("[Clawdbot] Error loading history:", error);
      }
    }

    return [];
  }

  // Save history to Firebase
  private async saveHistory(userId: string, history: Array<{ role: "user" | "assistant"; content: string }>): Promise<void> {
    // Update cache
    historyCache.set(userId, history);

    // Persist to Firebase
    if (db) {
      try {
        const historyRef = db
          .collection("conversation_history")
          .doc(userId)
          .collection("channels")
          .doc("web");

        const messages = history.map(m => ({
          ...m,
          timestamp: new Date().toISOString(),
        }));

        await historyRef.set({
          messages,
          updatedAt: new Date(),
        });
      } catch (error) {
        console.error("[Clawdbot] Error saving history:", error);
      }
    }
  }

  async chat(message: string, conversationId: string, modelTier: string = "grok"): Promise<{ response: string; toolsUsed?: string[]; model?: string }> {
    try {
      // Load history from Firebase/cache
      let history = await this.loadHistory(conversationId);

      // Select model based on tier - maps to openclaw model refs
      const MODEL_MAP: Record<string, string> = {
        grok: "xai/grok-4-fast",
        fast: "google/gemini-2.0-flash",
        balanced: "anthropic/claude-sonnet-4-20250514",
        quality: "anthropic/claude-opus-4-20250514",
        kimi: "moonshot/kimi-k2.5",
        minimax: "minimax/abab6.5",
      };
      const modelRef = MODEL_MAP[modelTier] || "xai/grok-4-fast";
      console.log(`[Clawdbot] Using model: ${modelRef} for tier: ${modelTier}`);

      // Build message with model switch command
      const escapedMessage = message.replace(/'/g, "'\\''").replace(/\n/g, '\\n');
      const combinedMessage = `/model ${modelRef}\\n${escapedMessage}`;
      
      // Execute openclaw agent CLI
      const response = await this.executeOpenclawAgent(combinedMessage, conversationId);

      // Update history
      history.push({ role: "user", content: message });
      history.push({ role: "assistant", content: response });
      
      // Trim history if too long
      if (history.length > MAX_HISTORY) {
        history = history.slice(-MAX_HISTORY);
      }

      // Save to Firebase (non-blocking)
      this.saveHistory(conversationId, history).catch(err => 
        console.error("[Clawdbot] Background save error:", err)
      );

      return {
        response,
        toolsUsed: response.includes("search") ? ["web_search"] : undefined,
        model: modelRef,
      };
    } catch (error) {
      console.error("[Clawdbot] Chat error:", error);
      throw new Error("Failed to process message. Please try again.");
    }
  }

  private executeOpenclawAgent(message: string, sessionId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = 180000; // 3 minute timeout
      let output = "";
      let errorOutput = "";

      const proc = spawn("openclaw", ["agent", "-m", message, "--session-id", sessionId], {
        env: { ...process.env, HOME: process.env.HOME || "/root" },
        timeout,
      });

      proc.stdout.on("data", (data) => {
        output += data.toString();
      });

      proc.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0 || output.trim()) {
          // Parse response - openclaw outputs the response directly
          const response = this.parseOpenclawOutput(output);
          resolve(response || "I processed your request but didn't generate a response.");
        } else {
          console.error("[Clawdbot] openclaw error:", errorOutput);
          reject(new Error(`openclaw failed: ${errorOutput || "Unknown error"}`));
        }
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to spawn openclaw: ${err.message}`));
      });
    });
  }

  private parseOpenclawOutput(output: string): string {
    // openclaw agent outputs response directly, may include ANSI codes
    // Strip ANSI escape codes
    const cleaned = output.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "").trim();
    
    // Try to find JSON response if present
    const jsonMatch = cleaned.match(/\{[\s\S]*"response"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.response || cleaned;
      } catch {
        // Not valid JSON, return cleaned output
      }
    }
    
    return cleaned;
  }

  isReady(): boolean {
    return this.ready;
  }

  stop(): void {
    this.ready = false;
  }
}

// Singleton instance
let clawdbotManager: ClawdbotManager | null = null;

export function getClawdbotManager(firestore?: Firestore): ClawdbotManager {
  if (!clawdbotManager) {
    clawdbotManager = new ClawdbotManager(firestore);
  }
  return clawdbotManager;
}
