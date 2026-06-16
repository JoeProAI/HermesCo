import { db, auth } from "./firebase";
import { doc, setDoc, getDoc, collection, addDoc, serverTimestamp } from "firebase/firestore";

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
  execute: (params: Record<string, unknown>, context: AgentContext) => Promise<string>;
}

export interface AgentConfig {
  id: string;
  name: string;
  model: string;
  description: string;
  instruction: string;
  tools: string[];
  subAgents?: string[];
}

export interface AgentContext {
  userId: string;
  sessionId: string;
  agentId: string;
  memory: Map<string, string>;
}

export interface AgentMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  toolResult?: string;
  timestamp: Date;
}

const webSearchTool: Tool = {
  name: "web_search",
  description: "Search the web for current information. Use this for news, trends, prices, facts.",
  parameters: {
    query: { type: "string", description: "The search query", required: true },
  },
  execute: async (params) => {
    const query = params.query as string;
    try {
      const response = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`);
      const data = await response.json();
      
      if (data.Abstract) {
        return `Search result for "${query}":\n${data.Abstract}\nSource: ${data.AbstractSource}`;
      }
      
      if (data.RelatedTopics && data.RelatedTopics.length > 0) {
        const results = data.RelatedTopics.slice(0, 5).map((t: { Text?: string }) => t.Text).filter(Boolean).join("\n");
        return `Search results for "${query}":\n${results}`;
      }
      
      return `No direct results found for "${query}". Try a more specific query.`;
    } catch (error) {
      return `Search failed: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
};

const fetchUrlTool: Tool = {
  name: "fetch_url",
  description: "Fetch and read content from a URL. Use for articles, documentation, web pages.",
  parameters: {
    url: { type: "string", description: "The URL to fetch", required: true },
  },
  execute: async (params) => {
    const url = params.url as string;
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; cagent/1.0)" },
      });
      const html = await response.text();
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 4000);
      return `Content from ${url}:\n${text}`;
    } catch (error) {
      return `Failed to fetch URL: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
};

const codeExecuteTool: Tool = {
  name: "execute_code",
  description: "Execute JavaScript code to perform calculations, data processing, or logic.",
  parameters: {
    code: { type: "string", description: "JavaScript code to execute", required: true },
  },
  execute: async (params) => {
    const code = params.code as string;
    try {
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      const fn = new AsyncFunction("return (async () => { " + code + " })()");
      const result = await fn();
      return `Code executed successfully. Result: ${JSON.stringify(result, null, 2)}`;
    } catch (error) {
      return `Code execution failed: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
};

const memoryStoreTool: Tool = {
  name: "memory_store",
  description: "Store information for later recall. Use for important facts, user preferences, context.",
  parameters: {
    key: { type: "string", description: "A descriptive key for the memory", required: true },
    value: { type: "string", description: "The information to remember", required: true },
  },
  execute: async (params, context) => {
    const key = params.key as string;
    const value = params.value as string;
    context.memory.set(key, value);
    
    if (context.userId) {
      try {
        await setDoc(doc(db, "users", context.userId, "memory", key), {
          value,
          agentId: context.agentId,
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        console.error("Failed to persist memory:", e);
      }
    }
    
    return `Stored: "${key}" = "${value}"`;
  },
};

const memoryRecallTool: Tool = {
  name: "memory_recall",
  description: "Recall previously stored information.",
  parameters: {
    key: { type: "string", description: "The key to recall, or 'all' for everything", required: true },
  },
  execute: async (params, context) => {
    const key = params.key as string;
    
    if (key === "all") {
      const entries = Array.from(context.memory.entries());
      if (entries.length === 0) return "No memories stored yet.";
      return "Stored memories:\n" + entries.map(([k, v]) => `- ${k}: ${v}`).join("\n");
    }
    
    const value = context.memory.get(key);
    return value ? `Recalled "${key}": ${value}` : `No memory found for "${key}"`;
  },
};

const imageGenerateTool: Tool = {
  name: "generate_image",
  description: "Generate an image using GPT Image 1.5. Returns the image URL.",
  parameters: {
    prompt: { type: "string", description: "Detailed image description", required: true },
    size: { type: "string", description: "Image size: 1024x1024, 1792x1024, or 1024x1792", required: false },
  },
  execute: async (params) => {
    const prompt = params.prompt as string;
    const size = (params.size as string) || "1024x1024";
    
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch("/api/tools/image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ prompt, size }),
      });
      const data = await response.json();
      if (data.url) {
        return `Image generated: ${data.url}`;
      }
      return `Image generation failed: ${data.error || "Unknown error"}`;
    } catch (error) {
      return `Image generation failed: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
};

const stockPriceTool: Tool = {
  name: "get_stock_price",
  description: "Get current stock price and basic info for a ticker symbol.",
  parameters: {
    symbol: { type: "string", description: "Stock ticker symbol (e.g., AAPL, NVDA)", required: true },
  },
  execute: async (params) => {
    const symbol = params.symbol as string;
    try {
      const response = await fetch(`/api/tools/stock?symbol=${encodeURIComponent(symbol)}`);
      const data = await response.json();
      if (data.error) return `Stock lookup failed: ${data.error}`;
      return `${symbol.toUpperCase()}: $${data.price} (${data.change > 0 ? "+" : ""}${data.change}%) - ${data.name}`;
    } catch (error) {
      return `Stock lookup failed: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
};

export const availableTools: Record<string, Tool> = {
  web_search: webSearchTool,
  fetch_url: fetchUrlTool,
  execute_code: codeExecuteTool,
  memory_store: memoryStoreTool,
  memory_recall: memoryRecallTool,
  generate_image: imageGenerateTool,
  get_stock_price: stockPriceTool,
};

export function getToolsForAgent(toolNames: string[]): Tool[] {
  return toolNames.map(name => availableTools[name]).filter(Boolean);
}

export function formatToolsForLLM(tools: Tool[]): string {
  return tools.map(t => 
    `### ${t.name}\n${t.description}\nParameters: ${JSON.stringify(t.parameters, null, 2)}`
  ).join("\n\n");
}

export function parseToolCall(content: string): { name: string; params: Record<string, unknown> } | null {
  const toolCallMatch = content.match(/<tool_call>\s*(\w+)\s*\(([\s\S]*?)\)\s*<\/tool_call>/);
  if (!toolCallMatch) return null;
  
  const name = toolCallMatch[1];
  const paramsStr = toolCallMatch[2].trim();
  
  try {
    const params = paramsStr ? JSON.parse(paramsStr) : {};
    return { name, params };
  } catch {
    const params: Record<string, string> = {};
    const paramMatches = paramsStr.matchAll(/(\w+)\s*[:=]\s*["']([^"']+)["']/g);
    for (const match of paramMatches) {
      params[match[1]] = match[2];
    }
    return { name, params };
  }
}

export async function loadUserMemory(userId: string): Promise<Map<string, string>> {
  const memory = new Map<string, string>();
  
  try {
    const memoryRef = collection(db, "users", userId, "memory");
    const snapshot = await getDoc(doc(memoryRef.parent!, userId));
    if (snapshot.exists()) {
      const data = snapshot.data();
      Object.entries(data).forEach(([key, value]) => {
        if (typeof value === "string") memory.set(key, value);
      });
    }
  } catch (e) {
    console.error("Failed to load memory:", e);
  }
  
  return memory;
}

export async function saveConversation(
  userId: string,
  agentId: string,
  messages: AgentMessage[]
): Promise<string> {
  try {
    const conversationRef = await addDoc(collection(db, "users", userId, "conversations"), {
      agentId,
      messages: messages.map(m => ({
        ...m,
        timestamp: m.timestamp.toISOString(),
      })),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return conversationRef.id;
  } catch (e) {
    console.error("Failed to save conversation:", e);
    return "";
  }
}
