## Approach

Three sub-modules with clean separation: `reflector.ts` owns prompt construction and output parsing; `extractor.ts` owns signal detection and extraction for correction/retry triggers; `store.ts` owns all file I/O for knowledge persistence. The Stop hook script is a thin shell wrapper that calls into the reflector. All three triggers produce the same `KnowledgeEntry` type and write through the same `store.ts` API.

## Architecture

**`KnowledgeEntry` interface** (canonical type used by all three modules and by p3-knowledge-retrieval):

```typescript
interface KnowledgeEntry {
  id: string;               // "k-NNN", sequential
  type: 'coupling' | 'gotcha' | 'decision' | 'preference';
  summary: string;          // one-sentence
  detail: string;           // 2-3 sentences
  related_files: string[];  // paths relative to projectRoot
  tags: string[];           // derived from type + related_files basenames
  confidence: number;       // 60-100
  source: 'reflection' | 'correction' | 'retry' | 'manual';
  created: string;          // ISO date
  last_validated: string;   // ISO date, same as created initially
  injection_outcomes: { success: number; failure: number };
  file: string;             // filename of the markdown file, e.g. "coupling-auth-webhook.md"
  scope?: string;           // "global" | "directory:path" | "file:path"
  trigger_pattern?: string; // for gotcha entries
}
```

**`src/knowledge/reflector.ts`**

```typescript
const REFLECTION_PROMPT = `
You just completed the task: <task_description>

Answer only the questions where you have substantive content. Skip the rest.

1. [coupling] What non-obvious module coupling or shared state did you discover?
   (Modifying A broke B, A and B share some hidden state)

2. [gotcha] What traps did you fall into? What dead ends did you take?
   (Why the first attempt failed, unexpected behavior)

3. [decision] What non-trivial technical decisions did you make, and why?
   (Why you chose approach A over B, what you traded off)

4. [heuristic] If you did a similar task again, what would you want to know upfront?
   (Key information that would make next time faster)

Output each answer as a YAML block:
---
type: coupling | gotcha | decision | preference
summary: "one-sentence summary"
detail: "2-3 sentence explanation"
related_files:
  - "path/to/file.ts"
confidence: 60-100
---
`;

function buildReflectionPrompt(taskDescription: string): string
function parseReflectionOutput(raw: string): Partial<KnowledgeEntry>[]
```

- `parseReflectionOutput` extracts all `---...\n---` YAML blocks from the LLM output
- Each block is validated: must have `type`, `summary`, `detail`; missing fields are filled with defaults
- Returns an array because one reflection can produce multiple entries (one per question answered)

**`src/knowledge/extractor.ts`**

```typescript
const CORRECTION_PROMPT = `
The user just corrected your approach. Analyze:

1. What did you do? (briefly describe original approach)
2. What does the user expect? (briefly describe the correction)
3. What is the transferable principle?
   — Not "user said X", but "why the user is right"
   — Extract a principle that applies beyond this specific case
4. In what scope does this principle apply? (global | directory:path | file:path)

Output format:
---
type: preference | gotcha | decision
summary: "one-sentence principle statement"
detail: "background and reasoning"
scope: "global | directory:path | file:path"
related_files: [...]
confidence: 70-95
---
`;

const RETRY_PROMPT = `
You just experienced a failed retry:
- First attempt: <first_attempt_summary>
- Failure reason: <error_or_hook_message>
- Successful approach: <successful_approach_summary>

Analyze:
1. Is this failure project-specific or general?
2. What is the root cause? (not the surface error, but why the first approach was chosen)
3. How to avoid this detour next time?

Output format:
---
type: gotcha
summary: "one sentence"
detail: "root cause analysis"
related_files: [...]
confidence: 60-85
trigger_pattern: "what scenario should recall this knowledge"
---
`;

function detectCorrectionSignal(userMessage: string): boolean
function buildCorrectionPrompt(originalApproach: string, correction: string): string
function buildRetryPrompt(firstAttempt: string, failureReason: string, successfulApproach: string): string
function parseExtractorOutput(raw: string): Partial<KnowledgeEntry> | null
```

- `detectCorrectionSignal` checks for negation keywords: "不对", "别这样", "换个方式", "no", "don't", "stop", "wrong", "instead"
- Correction/retry prompts produce a single entry (not an array)

**`src/knowledge/store.ts`**

```typescript
function generateId(projectRoot: string): string              // reads index, returns next "k-NNN"
function generateFilename(entry: KnowledgeEntry): string      // "coupling-auth-webhook.md"
function saveEntry(projectRoot: string, entry: KnowledgeEntry): void
function loadIndex(projectRoot: string): KnowledgeIndex
function saveIndex(projectRoot: string, index: KnowledgeIndex): void
function loadEntry(projectRoot: string, id: string): KnowledgeEntry | null
```

Write flow:
1. `generateId` reads current `index.yaml` and increments the max id
2. `generateFilename` constructs `<type>-<slug-of-summary>.md`
3. Write markdown file to `.reins/knowledge/<filename>`
4. Append entry metadata to `index.yaml` entries array and rewrite the file
5. All writes are synchronous to avoid partial state

**`index.yaml` format**:

```yaml
version: 1
entries:
  - id: "k-001"
    type: "coupling"
    summary: "..."
    related_files: [...]
    tags: [...]
    confidence: 85
    source: "reflection"
    created: "2026-03-28"
    last_validated: "2026-03-28"
    last_injected: null
    injection_outcomes: { success: 0, failure: 0 }
    file: "coupling-auth-webhook.md"
```

**Stop hook script** (`.reins/hooks/knowledge-reflect.sh`):

```bash
#!/bin/bash
# Called after Stop hook passes
TASK_DESC=$(jq -r '.task_description // empty' <<< "$CLAUDE_HOOK_DATA")
[ -z "$TASK_DESC" ] && exit 0
node .reins/bin/reflect.js "$TASK_DESC"
exit 0
```

The script invokes a small Node.js CLI (`reflect.js`) that calls `reflector.ts` → LLM → `store.ts`.

## Key Decisions

- **Structured prompts, not free-form**: Four specific questions produce denser information than "what did you learn?". Each question targets a distinct knowledge type.
- **Extract principles, not facts for corrections**: "User prefers Result pattern" is a fact. "Error handling philosophy: let callers decide how to handle failure" is a principle that transfers to all new code. The correction prompt is designed to elicit the latter.
- **Single `KnowledgeEntry` type for all three triggers**: Uniformity in the type makes `store.ts` simple and `retriever.ts` (p3-knowledge-retrieval) independent of the capture mechanism.
- **Tags are derived, not prompted**: Asking the agent to provide tags produces inconsistent results. Tags are computed from `type` + basename of `related_files` in `store.ts`, ensuring consistency.
- **LLM model for reflection is configurable, defaults to haiku**: Reflection happens at the end of every task. Cost matters. Haiku is sufficient for structured extraction from a short context window.

## File Structure

```
src/knowledge/reflector.ts            # Reflection prompt + output parser
src/knowledge/extractor.ts            # Correction/retry signal detection + prompts + parser
src/knowledge/store.ts                # index.yaml + markdown file I/O
.reins/hooks/knowledge-reflect.sh     # Stop hook script (template, written during init)
.reins/bin/reflect.js                 # Node CLI invoked by hook script (template)
```
