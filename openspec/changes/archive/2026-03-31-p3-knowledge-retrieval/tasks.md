## Tasks

- [ ] **Task 1: Implement retriever.ts**
  - Description: Define `RetrievalQuery` and `RankedEntry` interfaces. Implement `retrieveKnowledge(projectRoot, query)`. Load `index.yaml` once. For each entry above `minConfidence`: compute file_match (1.0 exact, 0.6 directory, 0.3 global), tag_match (prompt keyword overlap / entry tag count), confidence (entry.confidence / 100), recency (1 - days_since_created/90, floor 0), success_rate (success/(success+failure), default 1.0). Sum with weights. Sort descending. Return top `maxResults`. Implement `extractFilesFromPrompt(prompt)` heuristic: words matching path-like patterns plus any `recentFiles`/`planFiles` inputs.
  - Files: `src/knowledge/retriever.ts`
  - Tests: Unit test file_match = 1.0 for exact path overlap; test file_match = 0.6 for same-directory match; test file_match = 0.3 for global-scope entry; test entries below minConfidence are excluded; test recency = 0 for entries older than 90 days; test success_rate defaults to 1.0 for entries with no injection data; test top-N limit is respected.
  - Done when: `retrieveKnowledge` exported and passing all unit tests; returns empty array (not error) when `index.yaml` does not exist.

- [ ] **Task 2: Implement injector.ts**
  - Description: Implement `formatInjection(entries, options)`. For each `RankedEntry`: output a numbered line with type tag, summary, first sentence of detail as implication, and the `.reins/knowledge/<file>` path. Prepend the `[Reins Knowledge]` header. Track approximate token count (4 chars ≈ 1 token); stop adding entries once `maxTokens` (default 200) is reached. Return empty string if `entries` is empty.
  - Files: `src/knowledge/injector.ts`
  - Tests: Unit test output format matches the expected template exactly; test empty entries returns empty string; test token budget truncates entries correctly (5 entries over budget → fewer emitted); test each entry includes type, summary, implication, and file path.
  - Done when: `formatInjection` exported and passing tests; output is deterministic for the same inputs; never exceeds `maxTokens` budget.

- [ ] **Task 3: Create retrieve-knowledge.sh and retrieve.js CLI**
  - Description: Create `.reins/bin/retrieve-knowledge.sh` template: reads `$1` as the prompt, resolves `PROJECT_ROOT` via `git rev-parse` fallback `pwd`, checks for `index.yaml` existence, calls `node .reins/bin/retrieve.js "$PROMPT" "$PROJECT_ROOT"`. Create `retrieve.js` CLI entry point: reads prompt and projectRoot from argv, calls `retrieveKnowledge`, calls `formatInjection`, prints to stdout. Both files are templates written to the target project during `reins init`.
  - Files: `src/templates/bin/retrieve-knowledge.sh`, `src/templates/bin/retrieve.js`
  - Tests: Integration test that `retrieve-knowledge.sh` with a prompt matching a fixture `index.yaml` entry produces non-empty stdout; test that a prompt with no matches produces empty stdout; test that the script handles a missing `index.yaml` by silently exiting 0.
  - Done when: Shell script is executable and exits 0 in all cases; `retrieve.js` correctly pipes through retriever + injector.

- [ ] **Task 4: Create UserPromptSubmit hook and register during init**
  - Description: Create `.reins/hooks/knowledge-inject.sh` template: reads prompt from `$CLAUDE_HOOK_INPUT` via `jq` (field `.prompt`), exits silently if empty, calls `retrieve-knowledge.sh` with the prompt, prints result to stdout if non-empty, exits 0. Register this hook as a `UserPromptSubmit` hook in the hooks configuration during `reins init`. Ensure the hook is non-blocking — any failure exits 0 with no output rather than propagating an error.
  - Files: `src/templates/hooks/knowledge-inject.sh`, `src/cli.ts` (init hook registration)
  - Tests: Integration test that the hook script outputs injection text when a matching entry exists in `index.yaml`; test that the hook produces no output when `index.yaml` is empty; test that a `jq` parse failure (malformed input) causes the hook to exit 0 silently.
  - Done when: Hook is registered as `UserPromptSubmit` type during `reins init`; outputs injection text when relevant knowledge exists; always exits 0; produces no output when nothing is relevant.
