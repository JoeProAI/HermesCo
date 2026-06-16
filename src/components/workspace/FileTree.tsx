"use client";

import { useState, useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  Image,
  Film,
  Settings,
  RefreshCw,
} from "lucide-react";

interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
}

interface FileTreeProps {
  userId?: string;
  onFileSelect?: (file: { path: string; name: string }) => void;
}

const FILE_ICONS: Record<string, { icon: typeof File; color: string }> = {
  ".md": { icon: FileText, color: "#3b82f6" },
  ".json": { icon: FileCode, color: "#F59E0B" },
  ".ts": { icon: FileCode, color: "#3b82f6" },
  ".tsx": { icon: FileCode, color: "#3b82f6" },
  ".js": { icon: FileCode, color: "#F59E0B" },
  ".jsx": { icon: FileCode, color: "#F59E0B" },
  ".py": { icon: FileCode, color: "#22c55e" },
  ".css": { icon: FileCode, color: "#a855f7" },
  ".html": { icon: FileCode, color: "#ef4444" },
  ".png": { icon: Image, color: "#22c55e" },
  ".jpg": { icon: Image, color: "#22c55e" },
  ".jpeg": { icon: Image, color: "#22c55e" },
  ".gif": { icon: Image, color: "#22c55e" },
  ".webp": { icon: Image, color: "#22c55e" },
  ".svg": { icon: Image, color: "#F59E0B" },
  ".mp4": { icon: Film, color: "#a855f7" },
  ".webm": { icon: Film, color: "#a855f7" },
  ".yml": { icon: Settings, color: "#ef4444" },
  ".yaml": { icon: Settings, color: "#ef4444" },
  ".toml": { icon: Settings, color: "#ef4444" },
};

function getFileIcon(name: string) {
  const ext = name.slice(name.lastIndexOf("."));
  return FILE_ICONS[ext] || { icon: File, color: "#71717a" };
}

function TreeNode({
  node,
  depth,
  onFileSelect,
}: {
  node: FileNode;
  depth: number;
  onFileSelect?: (file: { path: string; name: string }) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);

  if (node.type === "directory") {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-1.5 py-1 px-2 text-xs font-mono hover:bg-white/5 rounded transition-colors group"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {expanded ? (
            <ChevronDown className="w-3 h-3 shrink-0 text-muted" />
          ) : (
            <ChevronRight className="w-3 h-3 shrink-0 text-muted" />
          )}
          {expanded ? (
            <FolderOpen className="w-3.5 h-3.5 shrink-0 text-accent" />
          ) : (
            <Folder className="w-3.5 h-3.5 shrink-0 text-accent" />
          )}
          <span className="text-default truncate">
            {node.name}
          </span>
        </button>
        {expanded && node.children && (
          <div>
            {node.children
              .sort((a, b) => {
                if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
                return a.name.localeCompare(b.name);
              })
              .map((child) => (
                <TreeNode key={child.path} node={child} depth={depth + 1} onFileSelect={onFileSelect} />
              ))}
          </div>
        )}
      </div>
    );
  }

  const { icon: Icon, color } = getFileIcon(node.name);

  return (
    <button
      onClick={() => onFileSelect?.({ path: node.path, name: node.name })}
      className="w-full flex items-center gap-1.5 py-1 px-2 text-xs font-mono hover:bg-white/5 rounded transition-colors"
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color }} />
      <span className="text-default truncate">
        {node.name}
      </span>
    </button>
  );
}

export function FileTree({ userId, onFileSelect }: FileTreeProps) {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFiles = async () => {
    if (!userId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(`/api/sandbox/list?userId=${userId}&tree=true`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data.tree || data.files || []);
      } else {
        setError("Unable to load files");
      }
    } catch {
      setError("Connection error");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchFiles();
  }, [userId]);

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 text-xs select-none shrink-0 border-b-default"
      >
        <span className="font-mono uppercase tracking-wider text-muted">
          Files
        </span>
        <button
          onClick={fetchFiles}
          className="p-1 rounded transition-colors hover:bg-white/5 text-muted"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs font-mono text-muted">Loading...</p>
          </div>
        ) : error ? (
          <div className="p-3">
            <p className="text-xs font-mono text-muted">{error}</p>
          </div>
        ) : files.length === 0 ? (
          <div className="p-4 text-center">
            <Folder className="w-6 h-6 mx-auto mb-2 text-muted-light" />
            <p className="text-xs text-muted">
              No sandbox files yet
            </p>
            <p className="text-xs mt-1 text-muted-light">
              Persistent storage is enabled by invite
            </p>
          </div>
        ) : (
          files.map((node) => (
            <TreeNode key={node.path} node={node} depth={0} onFileSelect={onFileSelect} />
          ))
        )}
      </div>
    </div>
  );
}
