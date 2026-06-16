import { getAdminDb } from "./firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  toolsUsed?: string[];
}

// Parent conversation doc is lightweight metadata only.
// Actual messages live in the `messages` subcollection: conversations/{userId}/messages/{autoId}
export interface Conversation {
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
}

// Memory retention by tier (in days)
const MEMORY_RETENTION: Record<string, number> = {
  free: 7,
  starter: 30,
  pro: -1, // Forever
  scale: -1,
};

// Daily message limits by tier
export const DAILY_LIMITS: Record<string, number> = {
  free: 50,
  starter: 500,
  pro: -1, // Unlimited
  scale: -1,
};

// Tools available by tier
export const TIER_TOOLS: Record<string, string[]> = {
  free: [],
  starter: ["web_search", "calculator"],
  pro: ["web_search", "calculator", "code_execution", "file_ops", "image_gen"],
  scale: ["web_search", "calculator", "code_execution", "file_ops", "image_gen"],
};

export class MemoryManager {
  private db: FirebaseFirestore.Firestore;

  constructor() {
    this.db = getAdminDb();
  }

  // Get conversation history for a user.
  // Reads the messages subcollection ordered by timestamp desc, then reverses to chat order.
  // Scales to unlimited history (no 1MB doc limit like the old arrayUnion implementation).
  async getConversation(userId: string, limit: number = 20): Promise<ConversationMessage[]> {
    const snapshot = await this.db
      .collection("conversations").doc(userId)
      .collection("messages")
      .orderBy("timestamp", "desc")
      .limit(limit)
      .get();

    if (snapshot.empty) return [];

    // Map + reverse to ascending chat order
    const messages = snapshot.docs.map(d => {
      const data = d.data();
      return {
        role: data.role,
        content: data.content,
        timestamp: data.timestamp?.toDate?.() ?? new Date(data.timestamp),
        toolsUsed: data.toolsUsed,
      } as ConversationMessage;
    });
    return messages.reverse();
  }

  // Add a single message as its own subcollection doc.
  // Parent doc carries only lightweight metadata.
  async addMessage(userId: string, message: ConversationMessage): Promise<void> {
    const parentRef = this.db.collection("conversations").doc(userId);
    const messagesRef = parentRef.collection("messages");

    const payload = {
      role: message.role,
      content: message.content,
      timestamp: message.timestamp instanceof Date ? message.timestamp : new Date(message.timestamp),
      ...(message.toolsUsed ? { toolsUsed: message.toolsUsed } : {}),
    };

    const batch = this.db.batch();
    batch.create(messagesRef.doc(), payload);
    batch.set(parentRef, {
      userId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      messageCount: FieldValue.increment(1),
    }, { merge: true });
    await batch.commit();
  }

  // Add user+assistant exchange atomically in one batch write.
  async addExchange(
    userId: string, 
    userMessage: string, 
    assistantMessage: string,
    toolsUsed?: string[]
  ): Promise<void> {
    const now = new Date();
    const parentRef = this.db.collection("conversations").doc(userId);
    const messagesRef = parentRef.collection("messages");

    const batch = this.db.batch();
    batch.create(messagesRef.doc(), {
      role: "user",
      content: userMessage,
      timestamp: now,
    });
    batch.create(messagesRef.doc(), {
      role: "assistant",
      content: assistantMessage,
      timestamp: new Date(now.getTime() + 1),
      ...(toolsUsed ? { toolsUsed } : {}),
    });
    batch.set(parentRef, {
      userId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      messageCount: FieldValue.increment(2),
    }, { merge: true });
    await batch.commit();
  }

  // Delete messages older than retention cutoff, in 500-doc batches.
  // Pro/Scale tiers with negative retentionDays keep everything.
  async cleanupOldMessages(userId: string, tier: string): Promise<void> {
    const retentionDays = MEMORY_RETENTION[tier] || 7;
    if (retentionDays < 0) return;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    const messagesRef = this.db
      .collection("conversations").doc(userId)
      .collection("messages");

    // Batch delete up to 500 docs per call; loop until no old docs remain.
    let deletedTotal = 0;
    while (true) {
      const oldSnap = await messagesRef
        .where("timestamp", "<", cutoff)
        .limit(500)
        .get();
      if (oldSnap.empty) break;

      const batch = this.db.batch();
      oldSnap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      deletedTotal += oldSnap.size;
      if (oldSnap.size < 500) break;
    }

    if (deletedTotal > 0) {
      await this.db.collection("conversations").doc(userId).set({
        messageCount: FieldValue.increment(-deletedTotal),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }

  // Check daily usage
  async getDailyUsage(userId: string): Promise<number> {
    const today = new Date().toISOString().split("T")[0];
    const doc = await this.db.collection("daily_usage").doc(`${userId}_${today}`).get();
    
    if (!doc.exists) return 0;
    return doc.data()?.count || 0;
  }

  // Increment daily usage
  async incrementDailyUsage(userId: string): Promise<number> {
    const today = new Date().toISOString().split("T")[0];
    const docRef = this.db.collection("daily_usage").doc(`${userId}_${today}`);
    
    const doc = await docRef.get();
    const newCount = (doc.exists ? doc.data()?.count || 0 : 0) + 1;

    await docRef.set({
      userId,
      date: today,
      count: newCount,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return newCount;
  }

  // Check if user can send message
  async canSendMessage(userId: string, tier: string): Promise<{ allowed: boolean; reason?: string; remaining?: number }> {
    const limit = DAILY_LIMITS[tier] || 50;
    
    // Unlimited for pro/scale
    if (limit < 0) {
      return { allowed: true, remaining: -1 };
    }

    const usage = await this.getDailyUsage(userId);
    
    if (usage >= limit) {
      return { 
        allowed: false, 
        reason: `Daily limit reached (${limit} messages). Upgrade for more.`,
        remaining: 0,
      };
    }

    return { allowed: true, remaining: limit - usage };
  }

  // Get tools available for tier
  getAvailableTools(tier: string): string[] {
    return TIER_TOOLS[tier] || [];
  }

  // Format conversation for LLM context
  formatForContext(messages: ConversationMessage[]): { role: string; content: string }[] {
    return messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }
}

// Singleton instance
let memoryManager: MemoryManager | null = null;

export function getMemoryManager(): MemoryManager {
  if (!memoryManager) {
    memoryManager = new MemoryManager();
  }
  return memoryManager;
}
