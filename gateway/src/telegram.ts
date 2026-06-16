import { Telegraf, Context } from "telegraf";
import { Firestore, FieldValue } from "firebase-admin/firestore";

interface BotSession {
  bot: Telegraf;
  connected: boolean;
  userId: string;
  botToken: string;
}

type MessageHandler = (
  agentId: string,
  message: string,
  sender: string,
  chatId: string
) => Promise<string>;

export class TelegramManager {
  private sessions: Map<string, BotSession> = new Map();
  private db: Firestore;
  private messageHandler: MessageHandler | null = null;

  constructor(db: Firestore) {
    this.db = db;
  }

  onMessage(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  async connect(agentId: string, userId: string, botToken: string, persist: boolean = true): Promise<string> {
    console.log(`[Telegram] Starting connection for agent ${agentId}`);

    // Close existing session if any
    if (this.sessions.has(agentId)) {
      console.log(`[Telegram] Closing existing session for ${agentId}`);
      await this.disconnect(agentId, false);
    }

    // Store token in Firestore for persistence
    if (persist) {
      await this.db.collection("agents").doc(agentId).update({
        telegramBotToken: botToken,
      });
    }

    const bot = new Telegraf(botToken);

    const session: BotSession = {
      bot,
      connected: false,
      userId,
      botToken,
    };

    this.sessions.set(agentId, session);

    // Handle incoming messages
    bot.on("text", async (ctx: Context) => {
      if (!ctx.message || !("text" in ctx.message)) return;
      
      const message = ctx.message.text;
      const sender = ctx.from?.username || ctx.from?.first_name || "Unknown";
      const chatId = ctx.chat?.id.toString() || "";

      console.log(`[Telegram] Message from ${sender}: ${message.substring(0, 50)}...`);

      if (this.messageHandler) {
        try {
          await ctx.sendChatAction("typing");
          const response = await this.messageHandler(agentId, message, sender, chatId);
          await ctx.reply(response);
        } catch (error) {
          console.error(`[Telegram] Error handling message:`, error);
          await ctx.reply("Sorry, I encountered an error processing your message.");
        }
      }
    });

    // Launch bot with dropPendingUpdates to avoid stuck state
    try {
      await bot.launch({ dropPendingUpdates: true });
      session.connected = true;
      
      const botInfo = await bot.telegram.getMe();
      console.log(`[Telegram] Bot connected as @${botInfo.username} for agent ${agentId}`);
      
      await this.updateAgentStatus(agentId, "telegram", "active");
      
      return botInfo.username || "Bot";
    } catch (error: unknown) {
      this.sessions.delete(agentId);
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[Telegram] Launch failed for ${agentId}:`, message);
      throw new Error(`Telegram bot launch failed: ${message}`);
    }
  }

  async disconnect(agentId: string, clearToken: boolean = true): Promise<void> {
    const session = this.sessions.get(agentId);
    if (session?.bot) {
      session.bot.stop();
      this.sessions.delete(agentId);
    }
    if (clearToken) {
      await this.updateAgentStatus(agentId, "none", "inactive");
      await this.db.collection("agents").doc(agentId).update({
        telegramBotToken: null,
      });
    }
    console.log(`[Telegram] Disconnected agent ${agentId}`);
  }

  getStatus(agentId: string): { connected: boolean; botUsername: string | null } {
    const session = this.sessions.get(agentId);
    return {
      connected: session?.connected || false,
      botUsername: null,
    };
  }

  private async updateAgentStatus(
    agentId: string,
    channel: string,
    status: string
  ): Promise<void> {
    try {
      await this.db.collection("agents").doc(agentId).update({
        channel,
        status,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error(`[Telegram] Failed to update agent status:`, error);
    }
  }

  async reconnectAll(): Promise<void> {
    console.log("[Telegram] Reconnecting all Telegram bots...");
    try {
      const snapshot = await this.db
        .collection("agents")
        .where("channel", "==", "telegram")
        .get();

      for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.telegramBotToken) {
          try {
            await this.connect(doc.id, data.userId, data.telegramBotToken, false);
            console.log(`[Telegram] Reconnected agent ${doc.id}`);
          } catch (error) {
            console.error(`[Telegram] Failed to reconnect ${doc.id}:`, error);
            await this.updateAgentStatus(doc.id, "telegram", "inactive");
          }
        }
      }
      console.log(`[Telegram] Reconnection complete. ${snapshot.size} agents processed.`);
    } catch (error) {
      console.error("[Telegram] Failed to reconnect bots:", error);
    }
  }
}
