"use client";

import { useState, useRef, useEffect } from "react";
import { AgentStatusRing } from "./AgentStatusRing";

type AgentStatus = "idle" | "running" | "error";

interface Agent {
  id: string;
  name: string;
  description: string;
  status: AgentStatus;
  models: string[];
  lastRun: string;
  configPath?: string;
}

interface ToolResult { name: string; result: string; }
interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: Date;
  agentName?: string;
  toolResults?: ToolResult[];
}

interface ChatViewProps {
  agent: Agent;
  onClose: () => void;
  onStatusChange: (status: AgentStatus) => void;
}

export function ChatView({ agent, onClose, onStatusChange }: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([
    { id: "welcome", role: "system", content: `Connected to ${agent.name}. Type a message to start the conversation.`, timestamp: new Date() },
  ]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: input.trim(), timestamp: new Date() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsProcessing(true);
    onStatusChange("running");

    try {
      const history = messages.filter(m => m.role === "user" || m.role === "assistant").map(m => ({ role: m.role, content: m.content }));
      const response = await fetch("/api/agent", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage.content, agentId: agent.id, history }),
      });
      if (!response.ok) { const errorData = await response.json(); throw new Error(errorData.error || "Failed to get response"); }
      const data = await response.json();

      if (data.toolResults?.length > 0) {
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(), role: "tool",
          content: data.toolResults.map((t: ToolResult) => `🔧 ${t.name}: ${t.result}`).join("\n\n"),
          timestamp: new Date(), toolResults: data.toolResults,
        }]);
      }

      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: data.response, timestamp: new Date(), agentName: agent.name }]);
    } catch (error) {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "system", content: `Error: ${error instanceof Error ? error.message : "Unknown error"}. Make sure the cagent API is running.`, timestamp: new Date() }]);
      onStatusChange("error");
    } finally {
      setIsProcessing(false);
      onStatusChange("idle");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(e); } };

  const getMsgClass = (role: string) => {
    if (role === "user") return "chat-bubble-user";
    if (role === "system") return "chat-bubble-system";
    if (role === "tool") return "chat-bubble-tool";
    return "chat-bubble-assistant";
  };

  return (
    <div className="chat-fullscreen">
      <div className="grain-overlay" />

      <div className="chat-container">
        <header className="chat-header">
          <div className="chat-header-left">
            <AgentStatusRing status={isProcessing ? "running" : agent.status} size="sm" />
            <div>
              <h1 className="chat-agent-name">{agent.name}</h1>
              <p className="chat-agent-status">{isProcessing ? "Processing..." : "Ready"}</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-secondary">← Back</button>
        </header>

        <div className="chat-messages">
          {messages.map((message) => (
            <div key={message.id} className={`chat-msg-row ${message.role === "user" ? "chat-msg-row-right" : ""}`}>
              <div className={`chat-bubble ${getMsgClass(message.role)}`}>
                {message.agentName && <p className="chat-bubble-author">{message.agentName}</p>}
                <p className="chat-bubble-text">{message.content}</p>
                <p className={`chat-bubble-time ${message.role === "user" ? "chat-bubble-time-user" : ""}`}>
                  {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSubmit} className="chat-input-form">
          <div className="chat-input-wrap">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${agent.name}...`}
              rows={1}
              disabled={isProcessing}
              className="chat-textarea"
            />
            <button type="submit" disabled={!input.trim() || isProcessing} className="btn-primary pricing-btn-disabled">
              {isProcessing ? "..." : "Send"}
            </button>
          </div>
          <p className="dash-input-hint">Press Enter to send, Shift+Enter for new line</p>
        </form>
      </div>
    </div>
  );
}
