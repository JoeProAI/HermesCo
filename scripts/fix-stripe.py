import re, sys

path = "/home/joseph/projects/cagent-studio/src/lib/stripe.ts"
with open(path) as f:
    src = f.read()

# Fix 1: TIER_MODELS — all tiers currently use grok-fast, wire proper models per tier
old = (
    '  free:      { primary: "clawd-xai/grok-4-1-fast-non-reasoning",  fallbacks: [] },\n'
    '  gifted:    { primary: "clawd-xai/grok-4-1-fast-non-reasoning",  fallbacks: [] },\n'
    '  starter:   { primary: "clawd-xai/grok-4-1-fast-non-reasoning",  fallbacks: [] },\n'
    '  agent:     { primary: "clawd-xai/grok-4-1-fast-non-reasoning",  fallbacks: [] },\n'
    '  trial:     { primary: "clawd-xai/grok-4-1-fast-non-reasoning",  fallbacks: [] },\n'
    '  pro:       { primary: "clawd-xai/grok-4-1-fast-non-reasoning",  fallbacks: [] },\n'
    '  network:   { primary: "clawd-xai/grok-4-1-fast-non-reasoning",  fallbacks: [] },\n'
    '  scale:     { primary: "clawd-anthropic/claude-sonnet-4-6",  fallbacks: ["clawd-xai/grok-4-1-fast-non-reasoning"] },\n'
    '  permanent: { primary: "clawd-anthropic/claude-sonnet-4-6",  fallbacks: ["clawd-xai/grok-4-1-fast-non-reasoning"] },\n'
)
new = (
    '  free:      { primary: "clawd-xai/grok-4-1-fast-non-reasoning",  fallbacks: [] },\n'
    '  gifted:    { primary: "clawd-xai/grok-4-1-fast-non-reasoning",  fallbacks: ["clawd-anthropic/claude-sonnet-4-6"] },\n'
    '  trial:     { primary: "clawd-xai/grok-4-1-fast-non-reasoning",  fallbacks: ["clawd-anthropic/claude-sonnet-4-6"] },\n'
    '  starter:   { primary: "clawd-xai/grok-4-1-fast-non-reasoning",  fallbacks: ["clawd-anthropic/claude-sonnet-4-6"] },\n'
    '  agent:     { primary: "clawd-xai/grok-4-1-fast-non-reasoning",  fallbacks: ["clawd-anthropic/claude-sonnet-4-6"] },\n'
    '  pro:       { primary: "clawd-anthropic/claude-sonnet-4-6",       fallbacks: ["clawd-xai/grok-4-1-fast-non-reasoning"] },\n'
    '  network:   { primary: "clawd-anthropic/claude-sonnet-4-6",       fallbacks: ["clawd-xai/grok-4-1-fast-non-reasoning"] },\n'
    '  scale:     { primary: "clawd-anthropic/claude-opus-4-6",         fallbacks: ["clawd-anthropic/claude-sonnet-4-6", "clawd-xai/grok-4-1-fast-non-reasoning"] },\n'
    '  permanent: { primary: "clawd-anthropic/claude-opus-4-6",         fallbacks: ["clawd-anthropic/claude-sonnet-4-6", "clawd-xai/grok-4-1-fast-non-reasoning"] },\n'
)
if old in src:
    src = src.replace(old, new)
    print("TIER_MODELS: patched")
else:
    print("TIER_MODELS: pattern not found - check manually")

# Fix 2: Large top-up loses money (5000 credits * $0.01 = $50 API cost, selling at $49)
# Drop to 4000 credits at $49 -> $40 API cost, $9 margin
old2 = '    name: "5,000 credits",\n    credits: 5000,\n    price: 49,'
new2 = '    name: "4,000 credits",\n    credits: 4000,\n    price: 49,'
if old2 in src:
    src = src.replace(old2, new2)
    print("TOPUPS large: patched (5000->4000 credits, keeping $49 price)")
else:
    print("TOPUPS large: pattern not found - check manually")

with open(path, "w") as f:
    f.write(src)
print("Done.")
