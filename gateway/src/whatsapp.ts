import { Firestore, FieldValue } from "firebase-admin/firestore";

interface WhatsAppSession {
  connected: boolean;
  userId: string;
  botToken: string;
  phoneNumber?: string;
}

type MessageHandler = (
  agentId: string,
  message: string,
  sender: string,
  chatId: string
) => Promise<string>;

export class WhatsAppManager {
  private sessions: Map<string, WhatsAppSession> = new Map();
  private db: Firestore;
  private messageHandler: MessageHandler | null = null;

  constructor(db: Firestore) {
    this.db = db;
  }

  onMessage(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  async connect(agentId: string, userId: string, botToken: string, persist: boolean = true): Promise<string> {
    console.log(`[WhatsApp] Starting connection for agent ${agentId}`);

    // Close existing session if any
    if (this.sessions.has(agentId)) {
      console.log(`[WhatsApp] Closing existing session for ${agentId}`);
      await this.disconnect(agentId, false);
    }

    // Store token in Firestore for persistence
    if (persist) {
      await this.db.collection("agents").doc(agentId).update({
        whatsappBotToken: botToken,
      });
    }

    // WhatsApp Business API connection
    // The token should be a WhatsApp Business API access token
    // For now, we'll use a webhook-based approach where WhatsApp sends messages to our endpoint
    
    const session: WhatsAppSession = {
      connected: false,
      userId,
      botToken,
    };

    this.sessions.set(agentId, session);

    try {
      // Verify the token by making a test API call
      const response = await fetch(
        `https://graph.facebook.com/v18.0/me?access_token=${botToken}`
      );

      if (!response.ok) {
        throw new Error("Invalid WhatsApp Business API token");
      }

      const data = await response.json() as { id?: string };
      session.connected = true;
      session.phoneNumber = data.id;

      console.log(`[WhatsApp] Connected for agent ${agentId}`);
      await this.updateAgentStatus(agentId, "whatsapp", "active");

      return session.phoneNumber || "WhatsApp Connected";
    } catch (error: unknown) {
      this.sessions.delete(agentId);
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[WhatsApp] Connection failed for ${agentId}:`, message);
      throw new Error(`WhatsApp connection failed: ${message}`);
    }
  }

  async disconnect(agentId: string, clearToken: boolean = true): Promise<void> {
    this.sessions.delete(agentId);
    if (clearToken) {
      await this.updateAgentStatus(agentId, "none", "inactive");
      await this.db.collection("agents").doc(agentId).update({
        whatsappBotToken: null,
      });
    }
    console.log(`[WhatsApp] Disconnected agent ${agentId}`);
  }

  getStatus(agentId: string): { connected: boolean; phoneNumber: string | null } {
    const session = this.sessions.get(agentId);
    return {
      connected: session?.connected || false,
      phoneNumber: session?.phoneNumber || null,
    };
  }

  // Handle incoming webhook messages from WhatsApp
  async handleWebhook(agentId: string, payload: {
    from: string;
    text: string;
    messageId: string;
  }): Promise<string | null> {
    const session = this.sessions.get(agentId);
    if (!session?.connected || !this.messageHandler) {
      return null;
    }

    try {
      const response = await this.messageHandler(
        agentId,
        payload.text,
        payload.from,
        payload.from // Use phone number as chat ID
      );

      // Send response back via WhatsApp API
      await this.sendMessage(session.botToken, payload.from, response);
      return response;
    } catch (error) {
      console.error(`[WhatsApp] Error handling message:`, error);
      return null;
    }
  }

  private async sendMessage(token: string, to: string, text: string): Promise<void> {
    // WhatsApp Business API send message
    // This would need the phone number ID from the WhatsApp Business account
    console.log(`[WhatsApp] Would send to ${to}: ${text.substring(0, 50)}...`);
    
    // Actual implementation would use:
    // POST https://graph.facebook.com/v18.0/{phone-number-id}/messages
    // with the access token and message payload
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
      console.error(`[WhatsApp] Failed to update agent status:`, error);
    }
  }

  async reconnectAll(): Promise<void> {
    console.log("[WhatsApp] Reconnecting all WhatsApp connections...");
    try {
      const snapshot = await this.db
        .collection("agents")
        .where("channel", "==", "whatsapp")
        .get();

      for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.whatsappBotToken) {
          try {
            await this.connect(doc.id, data.userId, data.whatsappBotToken, false);
            console.log(`[WhatsApp] Reconnected agent ${doc.id}`);
          } catch (error) {
            console.error(`[WhatsApp] Failed to reconnect ${doc.id}:`, error);
            await this.updateAgentStatus(doc.id, "whatsapp", "inactive");
          }
        }
      }
      console.log(`[WhatsApp] Reconnection complete. ${snapshot.size} agents processed.`);
    } catch (error) {
      console.error("[WhatsApp] Failed to reconnect:", error);
    }
  }
}
