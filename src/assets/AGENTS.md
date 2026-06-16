# Clawd Agent Instructions

## Sub-Agent Delegation

Spawn a sub-agent (via sessions_spawn) when ANY condition applies:

| Condition | Example |
|-----------|---------|
| >5 files to read | "Read all .ts files in src/ and list exported functions" |
| >2 URLs to fetch | "Search for X and summarize top 3 results" |
| Directory inventory | "List all packages in node_modules with versions" |
| >200 lines to analyze | "Review this codebase and identify security issues" |
| Long-running task | "Monitor this URL and report when it changes" |

### Syntax
```
sessions_spawn({ task: "Specific task with expected output format" })
```

Model defaults to gemini-flash (cheap, configured in openclaw.json).
Override with `model: "provider/model"` if needed.

### Anti-Patterns
- Reading many files yourself instead of delegating
- Fetching multiple URLs sequentially
- Running broad recursive searches in main context

### Cost Awareness
- Main agent (grok-4-fast): $$$ - use for reasoning and user interaction
- Sub-agents (gemini-flash): $ - use for research and data gathering

**Principle:** Gather information via sub-agents. Make decisions yourself.

### Session Commands
- /compact - Compress context (automatic pruning enabled)
- /new - Fresh session
- /subagents list - View running sub-agents
- /subagents stop <id> - Stop a sub-agent
