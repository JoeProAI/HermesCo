"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Save, X } from "lucide-react";

interface EditorFile {
  path: string;
  name: string;
  content: string;
  language: string;
  dirty?: boolean;
}

interface EditorProps {
  userId?: string;
  initialFile?: EditorFile;
  onSave?: (file: EditorFile) => void;
}

const LANGUAGE_MAP: Record<string, string> = {
  ".md": "markdown",
  ".json": "json",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".sh": "shell",
  ".bash": "shell",
  ".toml": "toml",
  ".css": "css",
  ".html": "html",
};

function getLanguage(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf("."));
  return LANGUAGE_MAP[ext] || "plaintext";
}

export function Editor({ userId, initialFile, onSave }: EditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const monacoRef = useRef<any>(null);
  const [file, setFile] = useState<EditorFile | null>(initialFile || null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cleanup = false;

    const initEditor = async () => {
      if (!editorRef.current || cleanup) return;

      try {
        const monaco = await import("@monaco-editor/react");
        // Monaco is loaded via the react component, so we just set the ref
        setLoading(false);
      } catch (err) {
        setError("Failed to load editor");
        setLoading(false);
      }
    };

    initEditor();

    return () => {
      cleanup = true;
    };
  }, []);

  const handleSave = async () => {
    if (!file || !userId) return;
    setSaving(true);

    try {
      const res = await fetch("/api/sandbox/files", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          path: file.path,
          content: file.content,
        }),
      });

      if (res.ok) {
        setFile({ ...file, dirty: false });
        onSave?.(file);
      } else {
        setError("Failed to save file");
      }
    } catch {
      setError("Failed to save file");
    }

    setSaving(false);
  };

  // Handle keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [file, userId]);

  return (
    <div className="flex flex-col h-full bg-base">
      {/* Editor Header */}
      <div
        className="flex items-center justify-between px-3 py-2 text-xs select-none shrink-0 border-b-default bg-surface"
      >
        <div className="flex items-center gap-2">
          <FileText className="w-3.5 h-3.5 text-accent" />
          <span className="font-mono" style={{ color: file ? "var(--color-text)" : "var(--color-muted)" }}>
            {file ? file.name : "no file open"}
            {file?.dirty && <span className="text-accent"> ●</span>}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {file && (
            <>
              <button
                onClick={handleSave}
                disabled={saving || !file.dirty}
                className="flex items-center gap-1.5 px-2 py-1 rounded font-mono transition-colors disabled:opacity-30 text-muted"
                title="Save (Ctrl+S)"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? "saving..." : "save"}
              </button>
              <button
                onClick={() => setFile(null)}
                className="p-1 rounded transition-colors text-muted"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Editor Content */}
      <div ref={editorRef} className="flex-1 overflow-hidden">
        {error ? (
          <div className="flex items-center justify-center h-full p-6">
            <p className="text-sm font-mono text-danger">{error}</p>
          </div>
        ) : !file ? (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <FileText className="w-8 h-8 mb-3 text-muted-light" />
            <p className="text-sm font-medium mb-1 text-muted">
              No file open
            </p>
            <p className="text-xs text-muted-light">
              Select a file from the sidebar to edit
            </p>
          </div>
        ) : (
          <MonacoWrapper
            value={file.content}
            language={file.language}
            onChange={(value) => {
              if (value !== undefined) {
                setFile({ ...file, content: value, dirty: true });
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

// Separate component to avoid SSR issues with Monaco
function MonacoWrapper({
  value,
  language,
  onChange,
}: {
  value: string;
  language: string;
  onChange: (value: string | undefined) => void;
}) {
  const [MonacoEditor, setMonacoEditor] = useState<any>(null);

  useEffect(() => {
    import("@monaco-editor/react").then((mod) => {
      setMonacoEditor(() => mod.default);
    });
  }, []);

  if (!MonacoEditor) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm font-mono text-muted">Loading editor...</p>
      </div>
    );
  }

  return (
    <MonacoEditor
      height="100%"
      language={language}
      value={value}
      onChange={onChange}
      theme="clawd-dark"
      beforeMount={(monaco: any) => {
        monaco.editor.defineTheme("clawd-dark", {
          base: "vs-dark",
          inherit: true,
          rules: [
            { token: "comment", foreground: "71717a", fontStyle: "italic" },
            { token: "keyword", foreground: "F59E0B" },
            { token: "string", foreground: "22c55e" },
            { token: "number", foreground: "FBBF24" },
            { token: "type", foreground: "3b82f6" },
            { token: "variable", foreground: "d4d4d8" },
          ],
          colors: {
            "editor.background": "#09090b",
            "editor.foreground": "#d4d4d8",
            "editorCursor.foreground": "#F59E0B",
            "editor.selectionBackground": "#F59E0B33",
            "editor.lineHighlightBackground": "#111113",
            "editorLineNumber.foreground": "#52525b",
            "editorLineNumber.activeForeground": "#F59E0B",
            "editorWidget.background": "#111113",
            "editorWidget.border": "#27272a",
            "editorSuggestWidget.background": "#111113",
            "editorSuggestWidget.border": "#27272a",
            "editorSuggestWidget.selectedBackground": "#18181b",
            "input.background": "#111113",
            "input.border": "#27272a",
            "scrollbarSlider.background": "#27272a80",
            "scrollbarSlider.hoverBackground": "#3f3f46",
          },
        });
      }}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        lineHeight: 22,
        padding: { top: 12, bottom: 12 },
        scrollBeyondLastLine: false,
        wordWrap: "on",
        tabSize: 2,
        renderWhitespace: "selection",
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: true },
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
      }}
    />
  );
}
