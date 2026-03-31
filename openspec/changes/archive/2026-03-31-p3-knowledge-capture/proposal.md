## Why

Agents accumulate valuable implicit knowledge during task execution — module coupling surprises, dead ends, architectural rationale — but this knowledge evaporates at session end. Capturing it in structured form turns one-time discoveries into reusable project context for all future sessions.

## What Changes

- Add three capture triggers: task-completion reflection (Stop hook), user-correction extraction, and failure-retry extraction
- Each trigger uses a structured prompt (not free-form) to elicit one of four typed knowledge entries: `coupling`, `gotcha`, `decision`, `preference`
- Reflection prompt guides the agent through four specific questions; correction prompt extracts transferable principles (not facts); retry prompt captures negative knowledge (what not to do)
- Storage: each entry is a tagged markdown file in `.reins/knowledge/` plus a central `index.yaml` for fast retrieval
- Add `KnowledgeEntry` interface covering: id, type, summary, detail, related_files, tags, confidence, source, created, last_validated

## Capabilities

### New Capabilities

- `task-reflection`: After Stop hook passes, present a structured 4-question reflection prompt to the agent and parse YAML-block output into `KnowledgeEntry` objects
- `correction-extract`: Detect user correction signals in conversation, present a principle-extraction prompt, parse result into a `preference` or `gotcha` entry
- `retry-extract`: After a hook block or test failure followed by a revised approach, present a root-cause prompt and parse result into a `gotcha` entry
- `knowledge-store-write`: Write a parsed `KnowledgeEntry` to a tagged markdown file and update `index.yaml` atomically

### Modified Capabilities

- Stop hook (`p2-hook-system`): Extended to call the reflection script after passing evaluation; no change to its blocking behavior

## Impact

- New source files: `src/knowledge/reflector.ts`, `src/knowledge/extractor.ts`, `src/knowledge/store.ts`
- New runtime artifact: `.reins/knowledge/index.yaml` and `.reins/knowledge/*.md` files (team-shared, committed to git)
- `.reins/hooks/knowledge-reflect.sh`: New Stop hook script that invokes the reflection flow
- Depends on p2-hook-system for the Stop hook trigger point
- `index.yaml` schema must remain stable for p3-knowledge-retrieval to read it
