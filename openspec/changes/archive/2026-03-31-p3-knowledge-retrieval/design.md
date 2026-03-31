## Approach

Retrieval is a read-only operation over `index.yaml` — no LLM, no heavy dependencies. The ranking algorithm is a weighted sum over five signals, all computable from `index.yaml` fields without reading the markdown files. The injection formatter produces a fixed-format text block that the UserPromptSubmit hook writes to stdout. The shell script is the integration point: it is invoked by Claude Code's hook system and has no knowledge of TypeScript internals.

## Architecture

**`src/knowledge/retriever.ts`**

```typescript
interface RetrievalQuery {
  prompt: string;
  recentFiles?: string[];    // files edited in recent turns
  planFiles?: string[];      // files mentioned in task plan (if available)
  maxResults?: number;       // default 5
  minConfidence?: number;    // default 40
}

interface RankedEntry {
  entry: KnowledgeEntry;
  score: number;
  matchReasons: string[];    // ["file:lib/auth/session.ts", "tag:auth"]
}

function retrieveKnowledge(projectRoot: string, query: RetrievalQuery): RankedEntry[]
```

**Scoring formula**:

```
score = file_match   * 0.4
      + tag_match    * 0.2
      + confidence   * 0.2   // normalized: entry.confidence / 100
      + recency      * 0.1   // normalized: days since created, capped at 90d → 0.0
      + success_rate * 0.1   // injection_outcomes.success / (success + failure), default 1.0 if no data
```

**File match** (0–1):
- Any `entry.related_files` is an exact match for a query file → 1.0
- Any `entry.related_files` shares the same directory as a query file → 0.6
- No file overlap but entry has no `related_files` (global scope) → 0.3

**Tag match** (0–1):
- Extract candidate tags from prompt: lowercase words ≥4 chars that are not stop words
- `matched_tags / entry.tags.length`, capped at 1.0
- If entry has no tags → 0.0

**Recency** (0–1):
- `max(0, 1 - days_since_created / 90)`
- Entries older than 90 days score 0 on recency (other signals still count)

**Implementation notes**:
- Reads `index.yaml` once, scores all entries, sorts descending, returns top `maxResults`
- Entries below `minConfidence` are excluded before scoring
- File path extraction from prompt: simple heuristic — words matching `[a-z]+/[a-z./-]+` pattern, plus `recentFiles` and `planFiles` inputs

**`src/knowledge/injector.ts`**

```typescript
function formatInjection(entries: RankedEntry[], options?: { maxTokens?: number }): string
```

Output format:

```
[Reins Knowledge] N relevant experience(s) for this task:

1. [coupling] lib/auth/session.ts ↔ app/api/webhooks/handler.ts share session store
   → Modifying auth session format requires syncing webhook parser
   → Details: .reins/knowledge/coupling-auth-webhook.md

2. [gotcha] Prisma is incompatible with Edge Runtime, use @prisma/client/edge
   → Details: .reins/knowledge/gotcha-prisma-edge.md
```

- Each entry: type tag, one-line summary, one-line implication (from `detail` first sentence), path reference
- Total budget: ~200 tokens / ~15 lines; entries are truncated if over budget
- If `entries` is empty, `formatInjection` returns an empty string (hook outputs nothing)

**`.reins/bin/retrieve-knowledge.sh`**

```bash
#!/bin/bash
# retrieve-knowledge.sh <prompt>
# Outputs injection text to stdout, or nothing if no relevant knowledge
PROMPT="$1"
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
KNOWLEDGE_DIR="$PROJECT_ROOT/.reins/knowledge"

[ ! -f "$KNOWLEDGE_DIR/index.yaml" ] && exit 0

node "$PROJECT_ROOT/.reins/bin/retrieve.js" "$PROMPT" "$PROJECT_ROOT"
exit 0
```

**`.reins/hooks/knowledge-inject.sh`** (UserPromptSubmit hook):

```bash
#!/bin/bash
PROMPT=$(echo "$CLAUDE_HOOK_INPUT" | jq -r '.prompt // empty' 2>/dev/null)
[ -z "$PROMPT" ] && exit 0

RESULT=$(bash "$(dirname "$0")/../bin/retrieve-knowledge.sh" "$PROMPT")
[ -n "$RESULT" ] && printf '%s\n' "$RESULT"
exit 0
```

**Data flow**:

```
UserPromptSubmit fires
  → knowledge-inject.sh reads prompt from hook input
  → calls retrieve-knowledge.sh <prompt>
  → retrieve.js reads index.yaml
  → scores all entries against prompt + recent files
  → top-5 entries passed to formatInjection
  → injection text printed to stdout
  → Claude Code prepends text to user prompt
```

## Key Decisions

- **No LLM in the retrieval path**: Retrieval runs on every user prompt. Even a haiku call adds latency and cost. Path + tag matching over `index.yaml` is fast enough and sufficiently accurate for Phase 3.
- **Shell script as hook entry point, Node.js for logic**: The hook system calls shell scripts. Heavy logic lives in `retrieve.js` (compiled from `retriever.ts` + `injector.ts`). The shell script is a thin dispatcher.
- **`recentFiles` is a stronger signal than prompt keywords**: Files the agent edited in the last few turns are a reliable proxy for what the current task involves. The hook should pass these when available (from Claude Code's hook context).
- **Empty injection = silent exit**: If no entries score above the threshold, the hook exits with no output and no visible effect on the prompt. This keeps the common case (new project, no knowledge yet) noise-free.
- **Injection is summary + path, not full content**: Dumping full knowledge entries would consume context budget and reduce signal-to-noise. The agent reads the full file only if it decides the entry is relevant. This mirrors the L0/L1/L2 progressive context design.
- **success_rate defaults to 1.0 when no injection data exists**: New entries have no track record. Penalizing them would suppress all newly captured knowledge. They start with full benefit of the doubt and are penalized only after confirmed failures.

## File Structure

```
src/knowledge/retriever.ts            # RetrievalQuery, RankedEntry, retrieveKnowledge()
src/knowledge/injector.ts             # formatInjection()
.reins/bin/retrieve-knowledge.sh      # Shell entry point (template, written during init)
.reins/bin/retrieve.js                # Compiled Node CLI (built artifact)
.reins/hooks/knowledge-inject.sh      # UserPromptSubmit hook (template, written during init)
```
