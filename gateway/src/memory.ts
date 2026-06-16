import { Firestore, FieldValue } from "firebase-admin/firestore";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface Conversation {
  agentId: string;
  chatId: string;
  messages: Message[];
  updatedAt: Date;
}

const MAX_MESSAGES = 20; // Keep last 20 messages per conversation

export class MemoryManager {
  private db: Firestore;

  constructor(db: Firestore) {
    this.db = db;
  }

  private getConversationId(agentId: string, chatId: string): string {
    return `${agentId}_${chatId}`;
  }

  async getHistory(agentId: string, chatId: string): Promise<Message[]> {
    try {
      const docId = this.getConversationId(agentId, chatId);
      const doc = await this.db.collection("conversations").doc(docId).get();
      
      if (!doc.exists) {
        return [];
      }

      const data = doc.data() as Conversation;
      return data.messages || [];
    } catch (error) {
      console.error("[Memory] Failed to get history:", error);
      return [];
    }
  }

  async addMessage(agentId: string, chatId: string, role: "user" | "assistant", content: string): Promise<void> {
    try {
      const docId = this.getConversationId(agentId, chatId);
      const docRef = this.db.collection("conversations").doc(docId);
      const doc = await docRef.get();

      const newMessage: Message = {
        role,
        content,
        timestamp: new Date(),
      };

      if (!doc.exists) {
        await docRef.set({
          agentId,
          chatId,
          messages: [newMessage],
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        const data = doc.data() as Conversation;
        const messages = [...(data.messages || []), newMessage].slice(-MAX_MESSAGES);
        
        await docRef.update({
          messages,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    } catch (error) {
      console.error("[Memory] Failed to add message:", error);
    }
  }

  async clearHistory(agentId: string, chatId: string): Promise<void> {
    try {
      const docId = this.getConversationId(agentId, chatId);
      await this.db.collection("conversations").doc(docId).delete();
    } catch (error) {
      console.error("[Memory] Failed to clear history:", error);
    }
  }

  formatHistoryForPrompt(messages: Message[]): string {
    if (messages.length === 0) return "";
    
    return "\n\nPrevious conversation:\n" + 
      messages.map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
  }
}
