#!/bin/bash
set -e
SRC=/mnt/c/Projects/AI_Projects/cagent-studio
DST=/home/joseph/projects/cagent-studio
FILES=(
  src/lib/memory.ts
  src/lib/cache.ts
  src/lib/platform-context.ts
  src/lib/agents.ts
  src/app/api/tasks/route.ts
  src/app/api/stripe/webhook/route.ts
  src/app/api/admin/route.ts
  firestore.indexes.json
)
for f in "${FILES[@]}"; do
  mkdir -p "$DST/$(dirname "$f")"
  cp "$SRC/$f" "$DST/$f"
  echo "ok $f"
done
