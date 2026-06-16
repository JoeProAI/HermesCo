"use client";

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

interface AgentCardProps {
  agent: Agent;
  onRun: () => void;
  onStop: () => void;
  onSelect: () => void;
}

export function AgentCard({ agent, onRun, onStop, onSelect }: AgentCardProps) {
  const isRunning = agent.status === "running";

  return (
    <div
      onClick={onSelect}
      className={`agent-card ${isRunning ? "agent-card-running" : ""}`}
    >
      <div className="agent-card-glow" />

      <div className="agent-card-content">
        <div className="agent-card-header">
          <div className="agent-card-identity">
            <AgentStatusRing status={agent.status} size="sm" />
            <div>
              <h3 className="agent-card-name">{agent.name}</h3>
              <p className="agent-card-meta">
                {isRunning ? "Running now" : `Last run: ${agent.lastRun}`}
              </p>
            </div>
          </div>

          <button
            onClick={(e) => { e.stopPropagation(); isRunning ? onStop() : onRun(); }}
            className={`agent-card-action ${isRunning ? "agent-card-action-stop" : "agent-card-action-run"}`}
          >
            {isRunning ? "Stop" : "Run"}
          </button>
        </div>

        <p className="agent-card-desc">{agent.description}</p>

        <div className="agent-card-models">
          {agent.models.map((model) => (
            <span key={model} className="agent-card-model-tag">{model}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
