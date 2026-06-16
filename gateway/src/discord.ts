import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  TextChannel,
} from "discord.js";
import { Firestore, FieldValue } from "firebase-admin/firestore";

interface BotSession {
  client: Client;
  connected: boolean;
  userId: string;
  botToken: string;
}

type MessageHandler = (
  agentId: string,
  message: string,
  sender: string,
  channelId: string
) => Promise<string>;

export class DiscordManager {
  private sessions: Map<string, BotSession> = new Map();
  private db: Firestore;
  private messageHandler: MessageHandler | null = null;

  constructor(db: Firestore) {
    this.db = db;
  }

  onMessage(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  async connect(agentId: string, userId: string, botToken: string, persist: boolean = true): Promise<void> {
    console.log(`[Discord] Starting connection for agent ${agentId}`);

    // Close existing session if any
    if (this.sessions.has(agentId)) {
      console.log(`[Discord] Closing existing session for ${agentId}`);
      await this.disconnect(agentId, false);
    }

    // Store token in Firestore for persistence
    if (persist) {
      await this.db.collection("agents").doc(agentId).update({
        discordBotToken: botToken,
      });
    }

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    const session: BotSession = {
      client,
      connected: false,
      userId,
      botToken,
    };

    this.sessions.set(agentId, session);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error(`[Discord] Connection timeout for ${agentId}`);
        reject(new Error("Discord connection timeout"));
      }, 30000);

      client.once(Events.ClientReady, async (readyClient) => {
        clearTimeout(timeout);
        session.connected = true;
        console.log(`[Discord] Bot connected as ${readyClient.user.tag} for agent ${agentId}`);
        
        await this.updateAgentStatus(agentId, "discord", "active");
        resolve();
      });

      client.on(Events.MessageCreate, async (message: Message) => {
        // Ignore bot messages
        if (message.author.bot) return;

        // Check if bot is mentioned or it's a DM
        const isMentioned = message.mentions.has(client.user!);
        const isDM = !message.guild;

        if (!isMentioned && !isDM) return;

        // Remove bot mention from message
        let content = message.content;
        if (isMentioned && client.user) {
          content = content.replace(`<@${client.user.id}>`, "").trim();
        }

        if (!content) return;

        const sender = `${message.author.username}#${message.author.discriminator}`;
        const channelId = message.channelId;

        console.log(`[Discord] Message from ${sender}: ${content.substring(0, 50)}...`);

        // Handle /history command
        if (content.toLowerCase().startsWith("/history")) {
          try {
            const history = await this.getChannelHistory(userId, `discord:${channelId}`, 10);
            if (history.length === 0) {
              await message.reply("No conversation history found for this channel.");
            } else {
              const historyText = history
                .map((m: { role: string; content: string; timestamp: string }) => 
                  `**${m.role === "user" ? "You" : "Bot"}** (${new Date(m.timestamp).toLocaleTimeString()}): ${m.content.slice(0, 100)}${m.content.length > 100 ? "..." : ""}`
                )
                .join("\n");
              await message.reply(`**Recent History:**\n${historyText}`);
            }
          } catch (error) {
            console.error("[Discord] History fetch error:", error);
            await message.reply("Failed to fetch history.");
          }
          return;
        }

        // Handle /clearhistory command
        if (content.toLowerCase().startsWith("/clearhistory")) {
          try {
            await this.clearChannelHistory(userId, `discord:${channelId}`);
            await message.reply("Conversation history cleared for this channel.");
          } catch (error) {
            console.error("[Discord] Clear history error:", error);
            await message.reply("Failed to clear history.");
          }
          return;
        }

        if (this.messageHandler) {
          try {
            // Show typing indicator
            if (message.channel instanceof TextChannel) {
              await message.channel.sendTyping();
            }

            const response = await this.messageHandler(agentId, content, sender, channelId);
            await message.reply(response);
            
            // Save to conversation history (non-blocking)
            const channel = `discord:${channelId}`;
            this.saveToHistory(userId, channel, "user", content).catch(() => {});
            this.saveToHistory(userId, channel, "assistant", response).catch(() => {});
          } catch (error) {
            console.error(`[Discord] Error handling message:`, error);
            await message.reply("Sorry, I encountered an error processing your message.");
          }
        }
      });

      client.on(Events.Error, (error) => {
        console.error(`[Discord] Client error for ${agentId}:`, error);
      });

      client.login(botToken).catch((error) => {
        clearTimeout(timeout);
        console.error(`[Discord] Login failed for ${agentId}:`, error);
        this.sessions.delete(agentId);
        reject(new Error(`Discord login failed: ${error.message}`));
      });
    });
  }

  async disconnect(agentId: string, clearToken: boolean = true): Promise<void> {
    const session = this.sessions.get(agentId);
    if (session?.client) {
      session.client.destroy();
      this.sessions.delete(agentId);
    }
    if (clearToken) {
      await this.updateAgentStatus(agentId, "none", "inactive");
      await this.db.collection("agents").doc(agentId).update({
        discordBotToken: null,
      });
    }
    console.log(`[Discord] Disconnected agent ${agentId}`);
  }

  getStatus(agentId: string): { connected: boolean; botUsername: string | null } {
    const session = this.sessions.get(agentId);
    return {
      connected: session?.connected || false,
      botUsername: session?.client.user?.tag || null,
    };
  }

  async sendMessage(agentId: string, channelId: string, text: string): Promise<void> {
    const session = this.sessions.get(agentId);
    if (!session?.client || !session.connected) {
      throw new Error("Discord not connected");
    }

    const channel = await session.client.channels.fetch(channelId);
    if (channel instanceof TextChannel) {
      await channel.send(text);
    }
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
      console.error(`[Discord] Failed to update agent status:`, error);
    }
  }

  // Get conversation history for a channel
  async getChannelHistory(userId: string, channel: string, limit: number = 10): Promise<Array<{ role: string; content: string; timestamp: string }>> {
    try {
      const historyRef = this.db
        .collection("conversation_history")
        .doc(userId)
        .collection("channels")
        .doc(channel);
      
      const historyDoc = await historyRef.get();
      
      if (!historyDoc.exists) {
        return [];
      }
      
      const data = historyDoc.data() || {};
      return (data.messages || []).slice(-limit);
    } catch (error) {
      console.error("[Discord] Error fetching history:", error);
      return [];
    }
  }

  // Clear conversation history for a channel
  async clearChannelHistory(userId: string, channel: string): Promise<void> {
    try {
      const historyRef = this.db
        .collection("conversation_history")
        .doc(userId)
        .collection("channels")
        .doc(channel);
      
      await historyRef.delete();
    } catch (error) {
      console.error("[Discord] Error clearing history:", error);
      throw error;
    }
  }

  // Save a message to conversation history
  async saveToHistory(userId: string, channel: string, role: "user" | "assistant", content: string): Promise<void> {
    try {
      const historyRef = this.db
        .collection("conversation_history")
        .doc(userId)
        .collection("channels")
        .doc(channel);

      const message = {
        role,
        content,
        timestamp: new Date().toISOString(),
      };

      const historyDoc = await historyRef.get();

      if (!historyDoc.exists) {
        await historyRef.set({
          messages: [message],
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } else {
        const data = historyDoc.data() || {};
        const messages = data.messages || [];
        const updatedMessages = [...messages, message].slice(-100);
        await historyRef.update({
          messages: updatedMessages,
          updatedAt: new Date(),
        });
      }
    } catch (error) {
      console.error("[Discord] Error saving to history:", error);
    }
  }

  async reconnectAll(): Promise<void> {
    console.log("[Discord] Reconnecting all Discord bots...");
    try {
      const snapshot = await this.db
        .collection("agents")
        .where("channel", "==", "discord")
        .get();

      for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.discordBotToken) {
          try {
            await this.connect(doc.id, data.userId, data.discordBotToken, false);
            console.log(`[Discord] Reconnected agent ${doc.id}`);
          } catch (error) {
            console.error(`[Discord] Failed to reconnect ${doc.id}:`, error);
            await this.updateAgentStatus(doc.id, "discord", "inactive");
          }
        }
      }
      console.log(`[Discord] Reconnection complete. ${snapshot.size} agents processed.`);
    } catch (error) {
      console.error("[Discord] Failed to reconnect bots:", error);
    }
  }
}
