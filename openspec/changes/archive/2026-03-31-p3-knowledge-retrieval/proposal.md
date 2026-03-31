## Why

Captured knowledge is only valuable if it reaches the agent at the right moment. Without retrieval, `.reins/knowledge/` is a write-only archive. File-affinity retrieval — matching knowledge entries to the files a task is likely to touch — delivers relevant context at prompt time with no semantic embedding infrastructure.

## What Changes

- Add file-affinity retrieval: estimate involved files from prompt keywords → exact path match → directory match → tag match → rank → top-N
- Ranking formula: `file_match*0.4 + tag_match*0.2 + confidence*0.2 + recency*0.1 + success_rate*0.1`
- Add injection via `UserPromptSubmit` hook: format top-5 entries as summary lines with file paths, max ~200 tokens
- Add `.reins/bin/retrieve-knowledge.sh` lightweight retrieval script called by the hook
- Add `src/knowledge/retriever.ts` implementing the ranking logic over `index.yaml`
- Add `src/knowledge/injector.ts` formatting retrieved entries into the injection text block

## Capabilities

### New Capabilities

- `file-affinity-retrieval`: Given a prompt string and optionally a list of recently edited files, return ranked `KnowledgeEntry` references from `index.yaml` using path + tag + confidence + recency + success-rate scoring
- `knowledge-inject`: Format top-N retrieved entries into a compact injection block (`[Reins Knowledge] ...`) suitable for prepending to a UserPromptSubmit hook response
- `retrieve-knowledge-sh`: Shell script entry point for the UserPromptSubmit hook; reads prompt from stdin via `jq`, calls retriever, outputs injection text or exits silently if nothing relevant

### Modified Capabilities

- `UserPromptSubmit` hook pipeline: Gains a new `knowledge-inject.sh` hook that runs before the agent sees the prompt; outputs injection text when relevant entries exist

## Impact

- New source files: `src/knowledge/retriever.ts`, `src/knowledge/injector.ts`
- New runtime file: `.reins/bin/retrieve-knowledge.sh` (shell script)
- New hook script: `.reins/hooks/knowledge-inject.sh` (UserPromptSubmit hook)
- Depends on p3-knowledge-capture for `index.yaml` schema and `KnowledgeEntry` type
- Depends on p2-hook-system for `UserPromptSubmit` hook registration
- `index.yaml` is read-only from retrieval's perspective; no writes happen during retrieval
