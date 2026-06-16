"use client";

import { useEffect } from "react";
import { AgentStatusRing } from "./AgentStatusRing";

type Status = "idle" | "running" | "error";

interface Agent {
  id: string;
  name: string;
  description: string;
  status: Status;
  models: string[];
  lastRun: string;
  configPath?: string;
}

interface AgentModalProps {
  agent: Agent;
  onClose: () => void;
  onRun: () => void;
  onStop: () => void;
  onChat: () => void;
}

export function AgentModal({ agent, onClose, onRun, onStop, onChat }: AgentModalProps) {
  const isRunning = agent.status === "running";

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <div className="dash-modal-backdrop" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="modal-panel modal-panel-lg">
        <div className="modal-header">
          <div className="modal-header-left">
            <AgentStatusRing status={agent.status} size="md" />
            <div>
              <h2 className="modal-title-lg">{agent.name}</h2>
              <p className="body-small">{isRunning ? "Currently running" : `Last run: ${agent.lastRun}`}</p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close-btn">✕</button>
        </div>

        <div className="modal-body">
          <div>
            <h3 className="modal-section-label">Description</h3>
            <p className="body-small leading-relaxed">{agent.description}</p>
          </div>

          <div>
            <h3 className="modal-section-label">Models</h3>
            <div className="modal-tags">
              {agent.models.map((model) => (
                <span key={model} className="modal-tag">{model}</span>
              ))}
            </div>
          </div>

          {agent.configPath && (
            <div>
              <h3 className="modal-section-label">Config Path</h3>
              <code className="modal-code-block">{agent.configPath}</code>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary">Edit Config</button>
          <div className="modal-footer-actions">
            <button onClick={onClose} className="btn-ghost">Close</button>
            <button onClick={onChat} className="btn-success">Chat</button>
            <button
              onClick={isRunning ? onStop : onRun}
              className={isRunning ? "btn-danger" : "btn-primary"}
            >
              {isRunning ? "Stop Agent" : "Run Agent"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
