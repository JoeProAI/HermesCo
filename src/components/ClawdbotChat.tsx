"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MediaItem {
  type: "image" | "video" | "html";
  url?: string;
  html?: string;
  alt?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  source?: "dedicated-gateway" | "shared-gateway";
  durationMs?: number;
  model?: string;
  cost?: number;
  media?: MediaItem[];
}

// Regex patterns for media detection
const IMAGE_URL_REGEX = /(https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp|svg|bmp)(?:\?[^\s]*)?)/gi;
const VIDEO_URL_REGEX = /(https?:\/\/[^\s]+\.(?:mp4|webm|ogg|mov)(?:\?[^\s]*)?)/gi;
const YOUTUBE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/gi;
const HTML_BLOCK_REGEX = /```html\n([\s\S]*?)\n```/gi;
// Markdown image syntax: ![alt](path)
const MARKDOWN_IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+\.(?:png|jpg|jpeg|gif|webp|svg))\)/gi;
// Sandbox file paths (e.g., /home/node/clawd/... or `/path/to/file.png`)
const SANDBOX_IMAGE_REGEX = /(?:`)?(\/?(?:home|root|tmp|var)\/[^\s`]+\.(?:png|jpg|jpeg|gif|webp|svg))(?:`)?/gi;
const SANDBOX_VIDEO_REGEX = /(?:`)?(\/?(?:home|root|tmp|var)\/[^\s`]+\.(?:mp4|webm|mov))(?:`)?/gi;

// Parse content for embedded media
function parseMediaFromContent(content: string, userId?: string): { text: string; media: MediaItem[] } {
  const media: MediaItem[] = [];
  let text = content;

  // Extract HTML blocks
  const htmlMatches = [...content.matchAll(HTML_BLOCK_REGEX)];
  for (const match of htmlMatches) {
    media.push({ type: "html", html: match[1] });
    text = text.replace(match[0], "");
  }

  // Extract YouTube videos
  const youtubeMatches = [...content.matchAll(YOUTUBE_REGEX)];
  for (const match of youtubeMatches) {
    media.push({ type: "video", url: `https://www.youtube.com/embed/${match[1]}` });
  }

  // Extract Markdown images: ![alt](path)
  const markdownMatches = [...content.matchAll(MARKDOWN_IMAGE_REGEX)];
  for (const match of markdownMatches) {
    const alt = match[1];
    const path = match[2];
    // Check if it's a sandbox path or HTTP URL
    if (path.startsWith("/") && userId) {
      const apiUrl = `/api/sandbox/files?userId=${userId}&path=${encodeURIComponent(path)}`;
      if (!media.some(m => m.url === apiUrl)) {
        media.push({ type: "image", url: apiUrl, alt: alt || path.split("/").pop() });
      }
    } else if (path.startsWith("http")) {
      if (!media.some(m => m.url === path)) {
        media.push({ type: "image", url: path, alt });
      }
    }
    text = text.replace(match[0], ""); // Remove markdown syntax from display text
  }

  // Extract sandbox file paths and convert to API URLs
  if (userId) {
    const sandboxImageMatches = [...content.matchAll(SANDBOX_IMAGE_REGEX)];
    for (const match of sandboxImageMatches) {
      const apiUrl = `/api/sandbox/files?userId=${userId}&path=${encodeURIComponent(match[1])}`;
      if (!media.some(m => m.url === apiUrl)) {
        media.push({ type: "image", url: apiUrl, alt: match[1].split("/").pop() });
      }
    }
    const sandboxVideoMatches = [...content.matchAll(SANDBOX_VIDEO_REGEX)];
    for (const match of sandboxVideoMatches) {
      const apiUrl = `/api/sandbox/files?userId=${userId}&path=${encodeURIComponent(match[1])}`;
      if (!media.some(m => m.url === apiUrl)) {
        media.push({ type: "video", url: apiUrl });
      }
    }
  }

  // Extract video URLs (http/https)
  const videoMatches = [...content.matchAll(VIDEO_URL_REGEX)];
  for (const match of videoMatches) {
    if (!media.some(m => m.url === match[1])) {
      media.push({ type: "video", url: match[1] });
    }
  }

  // Extract image URLs (http/https)
  const imageMatches = [...content.matchAll(IMAGE_URL_REGEX)];
  for (const match of imageMatches) {
    if (!media.some(m => m.url === match[1])) {
      media.push({ type: "image", url: match[1] });
    }
  }

  return { text: text.trim(), media };
}

interface ConversationSession {
  date: string;
  messageCount: number;
  preview: string;
}

// LocalStorage keys for message persistence
const LS_MESSAGES_KEY = "clawd_chat_messages";
const LS_CONVID_KEY = "clawd_chat_convid";
const LS_PENDING_KEY = "clawd_chat_pending"; // Tracks if we're waiting for a response

function saveMessagesToStorage(msgs: Message[]) {
  try {
    // Only keep last 50 messages in localStorage to avoid quota issues
    const toSave = msgs.slice(-50).map(m => ({
      ...m,
      timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
    }));
    localStorage.setItem(LS_MESSAGES_KEY, JSON.stringify(toSave));
  } catch { /* quota exceeded - ignore */ }
}

function loadMessagesFromStorage(): Message[] {
  try {
    const raw = localStorage.getItem(LS_MESSAGES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return parsed.map((m: Record<string, unknown>) => ({
      ...m,
      timestamp: new Date(m.timestamp as string),
    }));
  } catch { return []; }
}

export function MoltbotChat() {
  const { user, userData } = useAuth();
  const [messages, setMessages] = useState<Message[]>(() => loadMessagesFromStorage());
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasInstance, setHasInstance] = useState(false);
  const [instanceStatus, setInstanceStatus] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | string | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [lastSource, setLastSource] = useState<string | null>(null);
  const [modelTier] = useState<"standard" | "premium">("standard"); // Auto-routing with fallbacks
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [viewMode, setViewMode] = useState<"chat" | "history">("chat");
  const [conversationId, setConversationId] = useState<string>(() => {
    try { return localStorage.getItem(LS_CONVID_KEY) || crypto.randomUUID(); }
    catch { return crypto.randomUUID(); }
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shouldScrollRef = useRef(false);
  const pendingMessageIdRef = useRef<string | null>(null);

  // Everyone gets real Moltbot now (shared instance on Railway) - v2
  const isPro = !!(userData?.plan && ["starter","agent","pro","network","scale","permanent","gifted"].includes(userData.plan));
  const chatName = "Moltbot";
  const chatIcon = "/favicon.ico";

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    if (messages.length > 0) {
      saveMessagesToStorage(messages);
    }
  }, [messages]);

  // Persist conversationId
  useEffect(() => {
    try { localStorage.setItem(LS_CONVID_KEY, conversationId); } catch {}
  }, [conversationId]);

  // Recovery: when page becomes visible again, check if we have a pending empty response
  // This handles phone sleep, tab switching, and returning from other pages
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== "visible" || !user) return;

      // Check if there's a pending assistant message with empty content
      const pendingId = pendingMessageIdRef.current;
      if (!pendingId) {
        // Also check for any empty assistant message at the end (from interrupted fetch)
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.role === "assistant" && !lastMsg.content) {
          // We have an empty response - try to recover from history
        } else {
          return; // No recovery needed
        }
      }

      console.log("[Chat] Page visible again, checking for missed response...");
      try {
        const res = await fetch(`/api/chat/history?userId=${user.uid}&channel=web&limit=2`);
        const data = await res.json();
        if (data.messages && data.messages.length > 0) {
          // Get the most recent assistant message from history
          const lastAssistant = [...data.messages].reverse().find(
            (m: { role: string }) => m.role === "assistant"
          );
          if (lastAssistant && lastAssistant.content) {
            // Update the pending/empty message with recovered content
            setMessages(prev => {
              const updated = prev.map(msg => {
                if (
                  msg.role === "assistant" &&
                  !msg.content &&
                  msg.id === (pendingId || prev[prev.length - 1]?.id)
                ) {
                  return { ...msg, content: lastAssistant.content };
                }
                return msg;
              });
              return updated;
            });
            pendingMessageIdRef.current = null;
            setIsLoading(false);
            console.log("[Chat] Recovered response from history");
          }
        }
      } catch (err) {
        console.error("[Chat] Recovery fetch failed:", err);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    // Also run once on mount in case we're returning to the page
    if (document.visibilityState === "visible") {
      handleVisibilityChange();
    }
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [user, messages]);

  // Render message content with media support
  const renderMessageContent = (message: Message) => {
    const { text, media: parsedMedia } = parseMediaFromContent(message.content, user?.uid);
    const allMedia = [...(message.media || []), ...parsedMedia];

    return (
      <div className="space-y-2">
        {text && (
          <div className="text-sm leading-relaxed prose prose-invert prose-sm max-w-none 
            prose-p:my-2 prose-p:leading-relaxed
            prose-headings:my-3 prose-headings:font-semibold prose-headings:text-[var(--color-accent)]
            prose-h1:text-lg prose-h2:text-base prose-h3:text-sm
            prose-ul:my-2 prose-ul:pl-4 prose-ol:my-2 prose-ol:pl-4
            prose-li:my-1 prose-li:leading-relaxed
            prose-pre:my-3 prose-pre:p-3 prose-pre:rounded-lg prose-pre:bg-black/40 prose-pre:border prose-pre:border-white/10 prose-pre:overflow-x-auto
            prose-code:bg-white/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[var(--color-accent)] prose-code:text-xs prose-code:font-mono
            prose-blockquote:border-l-2 prose-blockquote:border-[var(--color-accent)] prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:my-3 prose-blockquote:text-white/80
            prose-strong:text-white prose-strong:font-semibold
            prose-em:text-white/90
            prose-hr:my-4 prose-hr:border-white/20
            prose-a:text-[var(--color-accent)] prose-a:underline prose-a:underline-offset-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        )}
        {allMedia.map((item, i) => {
          if (item.type === "image" && item.url) {
            return (
              <div key={i} className="mt-2">
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  <img
                    src={item.url}
                    alt={item.alt || "Image"}
                    className="rounded-lg max-w-full max-h-[300px] object-contain cursor-pointer hover:opacity-90 transition-opacity"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </a>
              </div>
            );
          }
          if (item.type === "video" && item.url) {
            // YouTube embed
            if (item.url.includes("youtube.com/embed")) {
              return (
                <div key={i} className="mt-2 aspect-video max-w-full">
                  <iframe
                    src={item.url}
                    className="w-full h-full rounded-lg"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              );
            }
            // Direct video
            return (
              <div key={i} className="mt-2">
                <video
                  src={item.url}
                  controls
                  className="rounded-lg max-w-full max-h-[300px]"
                >
                  Your browser does not support video.
                </video>
              </div>
            );
          }
          if (item.type === "html" && item.html) {
            return (
              <div
                key={i}
                className="mt-2 p-3 rounded-lg bg-white/5 border border-white/10 overflow-auto max-h-[400px]"
                dangerouslySetInnerHTML={{ __html: item.html }}
              />
            );
          }
          return null;
        })}
      </div>
    );
  };

  // Load conversation sessions on mount
  useEffect(() => {
    if (user && !historyLoaded) {
      fetch(`/api/chat/history?userId=${user.uid}&channel=web&limit=100`)
        .then((res) => res.json())
        .then((data) => {
          if (data.messages && data.messages.length > 0) {
            // Group messages by date
            const grouped: Record<string, { messages: Message[]; preview: string }> = {};
            for (const msg of data.messages) {
              const date = new Date(msg.timestamp).toLocaleDateString();
              if (!grouped[date]) {
                grouped[date] = { messages: [], preview: "" };
              }
              grouped[date].messages.push({
                id: crypto.randomUUID(),
                role: msg.role,
                content: msg.content,
                timestamp: new Date(msg.timestamp),
              });
              if (msg.role === "user" && !grouped[date].preview) {
                grouped[date].preview = msg.content.slice(0, 50) + (msg.content.length > 50 ? "..." : "");
              }
            }
            const sessionList = Object.entries(grouped).map(([date, data]) => ({
              date,
              messageCount: data.messages.length,
              preview: data.preview || "Conversation",
            })).reverse();
            setSessions(sessionList);
          }
          setHistoryLoaded(true);
        })
        .catch(() => setHistoryLoaded(true));
    }
  }, [user, historyLoaded]);

  // Load a specific session's messages
  const loadSession = async (date: string) => {
    if (!user) return;
    const res = await fetch(`/api/chat/history?userId=${user.uid}&channel=web&limit=100`);
    const data = await res.json();
    if (data.messages) {
      const filtered = data.messages.filter((msg: { timestamp: string }) => 
        new Date(msg.timestamp).toLocaleDateString() === date
      ).map((msg: { role: "user" | "assistant"; content: string; timestamp: string }) => ({
        id: crypto.randomUUID(),
        role: msg.role,
        content: msg.content,
        timestamp: new Date(msg.timestamp),
      }));
      setMessages(filtered);
    }
    setShowHistory(false);
  };

  // Start a new conversation - completely fresh with new session ID
  const startNewChat = () => {
    setMessages([]);
    try { localStorage.removeItem(LS_MESSAGES_KEY); } catch {}
    setConversationId(crypto.randomUUID()); // New conversation ID for Moltbot session
    setShowHistory(false);
    setViewMode("chat");
  };

  useEffect(() => {
    if (shouldScrollRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      shouldScrollRef.current = false;
    }
  }, [messages]);

  useEffect(() => {
    if (user && isPro) {
      fetch("/api/clawdbot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", userId: user.uid }),
      })
        .then((res) => res.json())
        .then((data) => {
          setHasInstance(data.hasInstance && data.instance?.status === "running");
          setInstanceStatus(data.instance?.status || null);
        })
        .catch(() => setHasInstance(false));
    }
  }, [user, isPro]);

  const sendMessage = async () => {
    if (!input.trim() || !user || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    const assistantMessageId = crypto.randomUUID();
    pendingMessageIdRef.current = assistantMessageId;

    shouldScrollRef.current = true;
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    // Add empty assistant message that will be updated with streaming content
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
      },
    ]);

    // Safety net: if fetch takes too long (phone sleep, connection drop),
    // poll history after 30s to recover the response
    const recoveryTimer = setTimeout(async () => {
      if (!pendingMessageIdRef.current || !user) return;
      console.log("[Chat] Recovery timer fired, polling history...");
      try {
        const res = await fetch(`/api/chat/history?userId=${user.uid}&channel=web&limit=2`);
        const data = await res.json();
        if (data.messages) {
          const lastAssistant = [...data.messages].reverse().find(
            (m: { role: string }) => m.role === "assistant"
          );
          if (lastAssistant?.content) {
            setMessages(prev =>
              prev.map(msg =>
                msg.id === assistantMessageId && !msg.content
                  ? { ...msg, content: lastAssistant.content }
                  : msg
              )
            );
            pendingMessageIdRef.current = null;
            setIsLoading(false);
          }
        }
      } catch {}
    }, 30000);

    try {
      const idToken = await user.getIdToken();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          message: userMessage.content,
          userId: user.uid,
          source: "webchat",
          modelTier,
          conversationId, // Pass conversation ID for Moltbot session tracking
        }),
      });

      // Check if response is streaming (SSE) or JSON
      const contentType = response.headers.get("content-type") || "";
      
      if (contentType.includes("text/event-stream")) {
        // Handle streaming response
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No reader");
        
        const decoder = new TextDecoder();
        let fullContent = "";
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                
                if (data.content) {
                  fullContent += data.content;
                  // Update message with new content
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId
                        ? { ...msg, content: fullContent }
                        : msg
                    )
                  );
                }
                
                if (data.done) {
                  // Update with final metadata
                  if (data.remaining !== undefined) setRemaining(data.remaining);
                  if (data.source) {
                    setLastSource(data.source);
                    setHasInstance(data.source === "dedicated-gateway");
                  }
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId
                        ? { ...msg, source: data.source, model: data.model }
                        : msg
                    )
                  );
                }
              } catch {
                // Skip invalid JSON
              }
            }
          }
        }
      } else {
        // Handle regular JSON response (fallback for shared gateway)
        const data = await response.json();

        if (data.remaining !== undefined) setRemaining(data.remaining);

        if (data.limitReached) {
          setLimitReached(true);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, content: `⚠️ ${data.error}\n\nUpgrade your plan for more messages.` }
                : msg
            )
          );
          return;
        }

        if (data.source) {
          setLastSource(data.source);
          setHasInstance(data.source === "dedicated-gateway");
        }

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: data.response || data.error || "No response",
                  source: data.source,
                  durationMs: data.durationMs,
                  model: data.model,
                  cost: data.usage?.cost,
                }
              : msg
          )
        );
      }
    } catch (error) {
      console.error("Chat error:", error);
      // Don't overwrite if recovery already filled in the response
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId && !msg.content
            ? { ...msg, content: "Connection interrupted. Recovering response..." }
            : msg
        )
      );
      // Try immediate recovery from history
      if (user) {
        try {
          await new Promise(r => setTimeout(r, 3000)); // Wait for backend to save
          const res = await fetch(`/api/chat/history?userId=${user.uid}&channel=web&limit=2`);
          const data = await res.json();
          if (data.messages) {
            const lastAssistant = [...data.messages].reverse().find(
              (m: { role: string }) => m.role === "assistant"
            );
            if (lastAssistant?.content) {
              setMessages(prev =>
                prev.map(msg =>
                  msg.id === assistantMessageId
                    ? { ...msg, content: lastAssistant.content }
                    : msg
                )
              );
            }
          }
        } catch { /* recovery failed, message already shows error */ }
      }
    }

    clearTimeout(recoveryTimer);
    pendingMessageIdRef.current = null;
    setIsLoading(false);
  };

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-full bg-[var(--color-surface-elevated)] border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-all shadow-lg group"
      >
        <div className="relative">
          <div className="w-10 h-10 rounded-full bg-[var(--color-accent)]/10 flex items-center justify-center">
            <img src={chatIcon} alt="" className="w-8 h-8" />
          </div>
          <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-[var(--color-accent)] animate-pulse" />
        </div>
        <div className="text-left">
          <div className="text-sm font-medium text-[var(--color-text)]">{chatName}</div>
          <div className="text-xs text-[var(--color-muted)]">Chat with Moltbot</div>
        </div>
      </button>
    );
  }

  return (
    <div className="fixed bottom-0 right-0 md:bottom-6 md:right-6 z-50 w-full md:w-[480px] h-[100dvh] md:h-[600px] md:rounded-xl bg-[var(--color-surface)] border-t md:border border-[var(--color-border)] shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface-elevated)]">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-[var(--color-accent)]/10 flex items-center justify-center">
              <img src={chatIcon} alt="" className="w-6 h-6" />
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[var(--color-success)] border-2 border-[var(--color-surface-elevated)]" />
          </div>
          <div>
            <div className="text-sm font-medium text-[var(--color-text)]">{chatName}</div>
            <div className="text-xs flex items-center gap-1.5">
              {hasInstance ? (
                <>
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500"></span>
                  <span className="text-green-500">Dedicated Instance</span>
                </>
              ) : isPro && instanceStatus === "stopped" ? (
                <>
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-500"></span>
                  <span className="text-yellow-500">Instance Stopped</span>
                </>
              ) : (
                <>
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]"></span>
                  <span className="text-[var(--color-accent)]">Shared Instance</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Auto-routing indicator */}
          <span className="text-xs text-[var(--color-muted)] bg-[var(--color-surface)] px-2 py-1 rounded border border-[var(--color-border)]">
            🤖 Auto (Grok → Gemini → Sonnet)
          </span>
          <button
            onClick={() => setIsExpanded(false)}
            className="p-1.5 rounded-lg hover:bg-[var(--color-border)] transition-colors"
          >
            <svg className="w-5 h-5 text-[var(--color-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <button
          onClick={() => setViewMode("chat")}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${viewMode === "chat" ? "text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]" : "text-[var(--color-muted)] hover:text-[var(--color-text)]"}`}
        >
          💬 Chat
        </button>
        <button
          onClick={() => setViewMode("history")}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${viewMode === "history" ? "text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]" : "text-[var(--color-muted)] hover:text-[var(--color-text)]"}`}
        >
          📜 History
        </button>
      </div>

      {/* History View */}
      {viewMode === "history" && (
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <button
            onClick={() => { startNewChat(); setViewMode("chat"); }}
            className="w-full p-3 rounded-lg bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 text-[var(--color-accent)] text-sm font-medium hover:bg-[var(--color-accent)]/20 transition-colors"
          >
            + Start New Chat
          </button>
          {sessions.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)] text-center py-8">No past conversations</p>
          ) : (
            sessions.map((session) => (
              <button
                key={session.date}
                onClick={() => { loadSession(session.date); setViewMode("chat"); }}
                className="w-full text-left p-3 rounded-lg bg-[var(--color-surface-elevated)] border border-[var(--color-border)] hover:border-[var(--color-accent)]/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-[var(--color-text)]">{session.date}</span>
                  <span className="text-xs text-[var(--color-muted)]">{session.messageCount} messages</span>
                </div>
                <p className="text-xs text-[var(--color-muted)] truncate">{session.preview}</p>
              </button>
            ))
          )}
        </div>
      )}

      {/* Messages */}
      <div className={`flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-[var(--color-border)] scrollbar-track-transparent ${viewMode === "history" ? "hidden" : ""}`}>
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="text-4xl mb-3">{chatIcon}</div>
            <h3 className="text-sm font-medium text-[var(--color-text)] mb-1">
              Welcome to Moltbot
            </h3>
            <p className="text-xs text-[var(--color-muted)] max-w-[200px] mx-auto">
              Your AI assistant with tools, memory, and web search.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {["What can you do?", "Search the web", "Help me code"].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => setInput(suggestion)}
                  className="text-xs px-3 py-1.5 rounded-full bg-[var(--color-surface-elevated)] border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors text-[var(--color-muted)]"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                message.role === "user"
                  ? "bg-[var(--color-accent)] text-[var(--color-bg)]"
                  : "bg-[var(--color-surface-elevated)] text-[var(--color-text)] border border-[var(--color-border)]"
              }`}
            >
              {renderMessageContent(message)}
              {message.role === "assistant" && (
                <div className="text-[10px] mt-1.5 opacity-60 flex items-center gap-2 flex-wrap">
                  {message.source === "dedicated-gateway" ? (
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-1 h-1 rounded-full bg-green-500"></span> Dedicated
                    </span>
                  ) : message.source && (
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-1 h-1 rounded-full bg-[var(--color-accent)]"></span> Shared
                    </span>
                  )}
                  {message.model && (
                    <span className="text-[var(--color-muted)]">
                      {message.model.includes("grok") ? "⚡ Grok" : 
                       message.model.includes("sonnet") ? "🧠 Sonnet" : 
                       message.model.includes("opus") ? "🧠 Opus" : message.model}
                    </span>
                  )}
                  {message.durationMs && (
                    <span className="text-[var(--color-muted)]">
                      {(message.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                  {message.cost !== undefined && (
                    <span className="text-yellow-500/70">
                      ${message.cost.toFixed(4)}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-[var(--color-surface-elevated)] border border-[var(--color-border)] rounded-2xl px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input - hidden when viewing history */}
      {viewMode === "chat" && (
        <div className="p-4 pb-20 md:pb-4 border-t border-[var(--color-border)] bg-[var(--color-surface-elevated)]">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
              placeholder={`Message ${chatName}...`}
              className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)]"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isLoading}
              className="px-4 py-2.5 rounded-xl bg-[var(--color-accent)] text-[var(--color-bg)] font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              Send
            </button>
          </div>
          <p className="text-[10px] text-[var(--color-muted)] text-center mt-2">
            {remaining !== null && remaining !== "unlimited" && (
              <span className="mr-2">{remaining} msgs left today •</span>
            )}
            {lastSource === "dedicated-gateway" ? (
              <span className="text-green-500">Your Dedicated Moltbot</span>
            ) : (
              <span>Shared Moltbot</span>
            )}
            {limitReached && <span className="text-[var(--color-danger)]"> • Limit reached</span>}
          </p>
        </div>
      )}
    </div>
  );
}
