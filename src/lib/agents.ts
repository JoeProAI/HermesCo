import { 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  getDocs, 
  query, 
  where, 
  onSnapshot,
  increment,
  serverTimestamp,
  Timestamp
} from "firebase/firestore";
import { db } from "./firebase";

export interface Agent {
  id: string;
  userId: string;
  type?: "main" | "sub" | "external";
  name: string;
  systemPrompt: string;
  model: string;
  channel: "discord" | "telegram" | "whatsapp" | "none";
  status: "active" | "inactive" | "connecting";
  executionsThisMonth: number;
  totalExecutions: number;
  createdAt: Date;
  updatedAt: Date;
  // Main agent extras (bridged from clawdbot_instance)
  botName?: string;
  gatewayStatus?: string;
  channels?: string[];
  instanceId?: string;
  // Vault
  latestTxId?: string | null;
  latestTxAt?: string | null;
  plan?: string;
}

export interface CreateAgentInput {
  name: string;
  systemPrompt: string;
  model?: string;
}

const AGENTS_COLLECTION = "agents";

export async function createAgent(userId: string, input: CreateAgentInput): Promise<Agent> {
  const agentData = {
    userId,
    name: input.name,
    systemPrompt: input.systemPrompt,
    model: input.model || "gpt-4.1",
    channel: "none",
    status: "inactive",
    executionsThisMonth: 0,
    totalExecutions: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const docRef = await addDoc(collection(db, AGENTS_COLLECTION), agentData);
  
  return {
    id: docRef.id,
    ...agentData,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Agent;
}

export async function updateAgent(agentId: string, updates: Partial<Omit<Agent, "id" | "userId" | "createdAt">>): Promise<void> {
  const agentRef = doc(db, AGENTS_COLLECTION, agentId);
  await updateDoc(agentRef, {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteAgent(agentId: string): Promise<void> {
  const agentRef = doc(db, AGENTS_COLLECTION, agentId);
  await deleteDoc(agentRef);
}

// Safely convert a Firestore field that may be a Timestamp OR an ISO string
function toDate(v: unknown): Date {
  if (!v) return new Date();
  if (typeof (v as Timestamp).toDate === "function") return (v as Timestamp).toDate();
  if (typeof v === "string" || typeof v === "number") return new Date(v);
  return new Date();
}

export async function getUserAgents(userId: string): Promise<Agent[]> {
  // Note: where + orderBy requires a composite Firestore index on (userId, createdAt).
  // If the index doesn't exist, Firestore throws. Fetch all + sort client-side as fallback.
  const q = query(
    collection(db, AGENTS_COLLECTION),
    where("userId", "==", userId),
  );
  
  const snapshot = await getDocs(q);
  const agents = snapshot.docs.map(d => ({
    id: d.id,
    ...d.data(),
    createdAt: toDate(d.data().createdAt),
    updatedAt: toDate(d.data().updatedAt),
  })) as Agent[];

  // Sort client-side: main first, then newest first
  return agents.sort((a, b) => {
    if (a.type === "main") return -1;
    if (b.type === "main") return 1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

export function subscribeToUserAgents(
  userId: string, 
  callback: (agents: Agent[]) => void
): () => void {
  // Avoid compound query that needs a composite index (where + orderBy).
  // Sort client-side instead.
  const q = query(
    collection(db, AGENTS_COLLECTION),
    where("userId", "==", userId),
  );
  
  return onSnapshot(q, (snapshot) => {
    const agents = snapshot.docs.map(d => ({
      id: d.id,
      ...d.data(),
      createdAt: toDate(d.data().createdAt),
      updatedAt: toDate(d.data().updatedAt),
    })) as Agent[];

    // Sort: main first, then newest first
    agents.sort((a, b) => {
      if (a.type === "main") return -1;
      if (b.type === "main") return 1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    callback(agents);
  });
}

export async function incrementAgentExecutions(agentId: string): Promise<void> {
  // Atomic counter increment — no read, no race condition, one write instead of two.
  const agentRef = doc(db, AGENTS_COLLECTION, agentId);
  await updateDoc(agentRef, {
    executionsThisMonth: increment(1),
    totalExecutions: increment(1),
    updatedAt: serverTimestamp(),
  });
}
