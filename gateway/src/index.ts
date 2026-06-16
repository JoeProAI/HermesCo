import express from "express";
import cors from "cors";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { DiscordManager } from "./discord";
import { TelegramManager } from "./telegram";
import { WhatsAppManager } from "./whatsapp";
import { executeAgent } from "./agent-executor";
import { MemoryManager } from "./memory";
import { getClawdbotManager } from "./clawdbot";

const app = express();
app.use(cors({ 
  origin: ["https://www.clawd.run", "https://clawd.run", "http://localhost:3000"],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json());

// Initialize Firebase Admin
const firebaseApp = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  }),
});
const db = getFirestore(firebaseApp);

// Session managers
const discord = new DiscordManager(db);
const telegram = new TelegramManager(db);
const whatsapp = new WhatsAppManager(db);
const memory = new MemoryManager(db);
const clawdbot = getClawdbotManager(db);

// Health check
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    clawdbot: clawdbot.isReady() ? "ready" : "starting",
  });
});

// Clawdbot chat endpoint - REAL Clawdbot, not fake
app.post("/api/clawdbot/chat", async (req, res) => {
  try {
    const { message, userId, conversationId, modelTier = "grok" } = req.body;
    
    if (!message || !userId) {
      return res.status(400).json({ error: "Missing message or userId" });
    }

    // Check user credits/limits
    const userDoc = await db.collection("users").doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : null;
    const tier = userData?.plan || "free";
    
    // Daily limit check
    const today = new Date().toISOString().split("T")[0];
    const usageDoc = await db.collection("daily_usage").doc(`${userId}_${today}`).get();
    const dailyUsage = usageDoc.exists ? usageDoc.data()?.count || 0 : 0;
    
    const limits: Record<string, number> = { free: 50, starter: 500, pro: -1, scale: -1 };
    const limit = limits[tier] || 50;
    
    if (limit > 0 && dailyUsage >= limit) {
      return res.status(429).json({ 
        error: `Daily limit reached (${limit} messages). Upgrade for more.`,
        limitReached: true,
        tier,
      });
    }

    // Call real Clawdbot with model tier
    const result = await clawdbot.chat(message, conversationId || userId, modelTier);

    // Increment daily usage
    await db.collection("daily_usage").doc(`${userId}_${today}`).set({
      userId,
      date: today,
      count: dailyUsage + 1,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // Store conversation in Firestore for persistence
    const convRef = db.collection("conversations").doc(conversationId || userId);
    await convRef.set({
      userId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    
    await convRef.collection("messages").add({
      role: "user",
      content: message,
      timestamp: FieldValue.serverTimestamp(),
    });
    
    await convRef.collection("messages").add({
      role: "assistant", 
      content: result.response,
      toolsUsed: result.toolsUsed || [],
      timestamp: FieldValue.serverTimestamp(),
    });

    res.json({
      response: result.response,
      toolsUsed: result.toolsUsed,
      source: "clawdbot-gateway",
      tier,
      remaining: limit < 0 ? "unlimited" : limit - dailyUsage - 1,
    });
  } catch (error) {
    console.error("Clawdbot chat error:", error);
    res.status(500).json({ error: "Failed to process message" });
  }
});

// Clawdbot status
app.get("/api/clawdbot/status", (req, res) => {
  res.json({
    ready: clawdbot.isReady(),
    version: "shared",
  });
});

// Connect Discord bot
app.post("/api/discord/connect", async (req, res) => {
  try {
    const { agentId, userId, botToken } = req.body;
    
    if (!agentId || !userId || !botToken) {
      return res.status(400).json({ error: "Missing agentId, userId, or botToken" });
    }

    // Verify agent belongs to user
    const agentDoc = await db.collection("agents").doc(agentId).get();
    if (!agentDoc.exists || agentDoc.data()?.userId !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    await discord.connect(agentId, userId, botToken);
    
    const status = discord.getStatus(agentId);
    res.json({ success: true, botUsername: status.botUsername });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Discord connect error:", message);
    res.status(500).json({ error: message });
  }
});

// Get connection status
app.get("/api/discord/status/:agentId", async (req, res) => {
  try {
    const { agentId } = req.params;
    const status = discord.getStatus(agentId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: "Failed to get status" });
  }
});

// Disconnect Discord
app.post("/api/discord/disconnect", async (req, res) => {
  try {
    const { agentId, userId } = req.body;
    
    const agentDoc = await db.collection("agents").doc(agentId).get();
    if (!agentDoc.exists || agentDoc.data()?.userId !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    await discord.disconnect(agentId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to disconnect" });
  }
});

// Telegram routes
app.post("/api/telegram/connect", async (req, res) => {
  try {
    const { agentId, userId, botToken } = req.body;
    
    if (!agentId || !userId || !botToken) {
      return res.status(400).json({ error: "Missing agentId, userId, or botToken" });
    }

    const agentDoc = await db.collection("agents").doc(agentId).get();
    if (!agentDoc.exists || agentDoc.data()?.userId !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const botUsername = await telegram.connect(agentId, userId, botToken);
    res.json({ success: true, botUsername });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Telegram connect error:", message);
    res.status(500).json({ error: message });
  }
});

app.get("/api/telegram/status/:agentId", async (req, res) => {
  try {
    const { agentId } = req.params;
    const status = telegram.getStatus(agentId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: "Failed to get status" });
  }
});

app.post("/api/telegram/disconnect", async (req, res) => {
  try {
    const { agentId, userId } = req.body;
    
    const agentDoc = await db.collection("agents").doc(agentId).get();
    if (!agentDoc.exists || agentDoc.data()?.userId !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    await telegram.disconnect(agentId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to disconnect" });
  }
});

// WhatsApp routes
app.post("/api/whatsapp/connect", async (req, res) => {
  try {
    const { agentId, userId, botToken } = req.body;
    
    if (!agentId || !userId || !botToken) {
      return res.status(400).json({ error: "Missing agentId, userId, or botToken" });
    }

    const agentDoc = await db.collection("agents").doc(agentId).get();
    if (!agentDoc.exists || agentDoc.data()?.userId !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const phoneNumber = await whatsapp.connect(agentId, userId, botToken);
    res.json({ success: true, phoneNumber });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("WhatsApp connect error:", message);
    res.status(500).json({ error: message });
  }
});

app.get("/api/whatsapp/status/:agentId", async (req, res) => {
  try {
    const { agentId } = req.params;
    const status = whatsapp.getStatus(agentId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: "Failed to get status" });
  }
});

app.post("/api/whatsapp/disconnect", async (req, res) => {
  try {
    const { agentId, userId } = req.body;
    
    const agentDoc = await db.collection("agents").doc(agentId).get();
    if (!agentDoc.exists || agentDoc.data()?.userId !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    await whatsapp.disconnect(agentId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to disconnect" });
  }
});

// WhatsApp webhook for incoming messages
app.post("/api/whatsapp/webhook", async (req, res) => {
  try {
    const { agentId, from, text, messageId } = req.body;
    
    if (!agentId || !from || !text) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const response = await whatsapp.handleWebhook(agentId, { from, text, messageId });
    res.json({ success: true, response });
  } catch (error) {
    console.error("WhatsApp webhook error:", error);
    res.status(500).json({ error: "Failed to process webhook" });
  }
});

// Shared message handler
async function handleAgentMessage(agentId: string, message: string, sender: string, channelId: string, channel: string): Promise<string> {
  try {
    const agentDoc = await db.collection("agents").doc(agentId).get();
    if (!agentDoc.exists) return "Agent not found";
    
    const agent = agentDoc.data()!;
    const userId = agent.userId;

    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) return "User not found";
    
    const userData = userDoc.data()!;
    if (userData.credits < 1) {
      return "⚠️ Out of credits. Please top up at clawd.run/pricing";
    }

    // Get conversation history
    const history = await memory.getHistory(agentId, channelId);
    const historyContext = memory.formatHistoryForPrompt(history);
    
    // Save user message
    await memory.addMessage(agentId, channelId, "user", message);

    const response = await executeAgent(
      { 
        name: agent.name, 
        systemPrompt: agent.systemPrompt + historyContext, 
        model: agent.model 
      }, 
      message
    );
    
    // Save assistant response
    await memory.addMessage(agentId, channelId, "assistant", response);

    await db.collection("users").doc(userId).update({
      credits: FieldValue.increment(-1),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await db.collection("agents").doc(agentId).update({
      executionsThisMonth: FieldValue.increment(1),
      totalExecutions: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await db.collection("executions").add({
      userId,
      agentId,
      channel,
      sender,
      channelId,
      prompt: message,
      result: response,
      creditsUsed: 1,
      createdAt: FieldValue.serverTimestamp(),
    });

    return response;
  } catch (error) {
    console.error("Message handling error:", error);
    return "Sorry, I encountered an error.";
  }
}

// Wire up message handlers
discord.onMessage((agentId, message, sender, channelId) => 
  handleAgentMessage(agentId, message, sender, channelId, "discord")
);

telegram.onMessage((agentId, message, sender, chatId) => 
  handleAgentMessage(agentId, message, sender, chatId, "telegram")
);

whatsapp.onMessage((agentId, message, sender, chatId) => 
  handleAgentMessage(agentId, message, sender, chatId, "whatsapp")
);

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`Clawd Gateway running on port ${PORT}`);
  
  // Start Clawdbot gateway
  console.log("Starting Clawdbot...");
  clawdbot.start().catch((err) => {
    console.error("Failed to start Clawdbot:", err);
  });
  
  // Reconnect all bots on startup
  await discord.reconnectAll();
  await telegram.reconnectAll();
  await whatsapp.reconnectAll();
});
