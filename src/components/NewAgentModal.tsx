"use client";

import { useState, useEffect } from "react";

interface NewAgentData {
  name: string;
  description: string;
  models: string[];
  configPath: string;
}

interface NewAgentModalProps {
  onClose: () => void;
  onAdd: (agent: NewAgentData) => void;
}

const availableModels = [
  "Claude Sonnet 4.5", "Claude Opus 4", "GPT-4.1", "GPT-5",
  "Grok 3", "Grok 4", "Gemini 3 Flash", "Gemini 3 Pro",
];

export function NewAgentModal({ onClose, onAdd }: NewAgentModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const toggleModel = (model: string) => {
    setSelectedModels((prev) => prev.includes(model) ? prev.filter((m) => m !== model) : [...prev, model]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || selectedModels.length === 0) return;
    onAdd({
      name: name.trim(),
      description: description.trim() || "Custom agent configuration",
      models: selectedModels,
      configPath: `C:\\Projects\\AI_Projects\\cagents\\${name.toLowerCase().replace(/\s+/g, "-")}.yaml`,
    });
  };

  const isValid = name.trim() && selectedModels.length > 0;

  return (
    <div className="dash-modal-backdrop" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="modal-panel">
        <div className="modal-header">
          <h2 className="modal-title">Create New Agent</h2>
          <button onClick={onClose} className="modal-close-btn">✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="input-group">
              <label className="input-label">Agent Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Custom Agent" className="input" />
            </div>

            <div className="input-group">
              <label className="input-label">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this agent do?" rows={3} className="input modal-textarea" />
            </div>

            <div className="input-group">
              <label className="input-label">Select Models</label>
              <div className="modal-tags">
                {availableModels.map((model) => {
                  const isSelected = selectedModels.includes(model);
                  return (
                    <button
                      key={model}
                      type="button"
                      onClick={() => toggleModel(model)}
                      className={`modal-model-tag ${isSelected ? "modal-model-tag-selected" : ""}`}
                    >
                      {model}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="modal-footer modal-footer-end">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={!isValid} className="btn-primary pricing-btn-disabled">Create Agent</button>
          </div>
        </form>
      </div>
    </div>
  );
}
