## Tasks

- [ ] **Task 1: Define KnowledgeEntry interface and implement store.ts**
  - Description: Define the `KnowledgeEntry` interface and `KnowledgeIndex` type in `src/knowledge/store.ts`. Implement `generateId` (reads index, returns next sequential "k-NNN"), `generateFilename` (constructs `<type>-<slug>.md` from type and summary), `saveEntry` (writes markdown file + updates index.yaml), `loadIndex`, `saveIndex`, and `loadEntry`. Create the `.reins/knowledge/` directory if absent. All writes are synchronous.
  - Files: `src/knowledge/store.ts`
  - Tests: Unit test `generateId` increments correctly from an existing index; test `generateFilename` produces valid kebab-case filenames; test `saveEntry` creates both the markdown file and the index entry; test `loadEntry` returns null for missing ids; test round-trip save/load preserves all fields.
  - Done when: All store functions exported and passing tests; `saveEntry` is atomic (no partial state if interrupted mid-write); `index.yaml` entries are always sorted by id.

- [ ] **Task 2: Implement reflector.ts**
  - Description: Implement `buildReflectionPrompt(taskDescription)` that injects the task description into the structured 4-question template. Implement `parseReflectionOutput(raw)` that extracts all `---...---` YAML blocks from the LLM response, validates required fields (`type`, `summary`, `detail`), fills defaults for missing optional fields, and returns an array of `Partial<KnowledgeEntry>`. Implement `runReflection(projectRoot, taskDescription)` that calls the LLM (using the configured `reflection_model`, default `haiku`), parses the output, completes each entry with `generateId`/`generateFilename`, and calls `saveEntry` for each.
  - Files: `src/knowledge/reflector.ts`
  - Tests: Unit test `parseReflectionOutput` with a fixture containing two valid YAML blocks; test it skips malformed blocks without throwing; test it returns an empty array when the LLM output contains no YAML blocks; test that entries missing `type` are filtered out.
  - Done when: `buildReflectionPrompt` and `parseReflectionOutput` exported and tested; `runReflection` saves entries to store and returns the saved ids.

- [ ] **Task 3: Implement extractor.ts**
  - Description: Implement `detectCorrectionSignal(userMessage)` that checks for negation keywords in English and Chinese ("不对", "别这样", "换个方式", "no", "don't", "stop", "wrong", "instead"). Implement `buildCorrectionPrompt` and `buildRetryPrompt` that inject context into their respective templates. Implement `parseExtractorOutput(raw)` that extracts a single YAML block. Implement `runCorrectionExtract(projectRoot, originalApproach, correction)` and `runRetryExtract(projectRoot, firstAttempt, failureReason, successfulApproach)` that call the LLM, parse, and save via store.
  - Files: `src/knowledge/extractor.ts`
  - Tests: Unit test `detectCorrectionSignal` returns true for each negation keyword and false for neutral messages; test `parseExtractorOutput` handles a valid block and returns null for empty input; test `buildCorrectionPrompt` correctly injects both approach strings into the template.
  - Done when: Both extract functions exported; correction detection covers all listed keywords; extractor correctly handles LLM output with no YAML block (returns null, saves nothing).

- [ ] **Task 4: Add Stop hook script and wire reflection trigger**
  - Description: Create the `knowledge-reflect.sh` hook script template (written to `.reins/hooks/` during `reins init`). The script reads task description from `$CLAUDE_HOOK_DATA` via `jq`, invokes `node .reins/bin/reflect.js <task>`, and exits 0. Create the `reflect.js` CLI entry point that calls `runReflection`. Register the hook in the hooks configuration during `reins init`. Ensure the hook is non-blocking — a failure in reflection must not propagate as a Stop hook failure.
  - Files: `src/knowledge/reflector.ts` (runReflection export), `src/templates/hooks/knowledge-reflect.sh`, `src/templates/bin/reflect.js`
  - Tests: Integration test that running the hook script with a valid task description creates at least one entry in `index.yaml` (using a mock LLM); test that a LLM failure in the reflection step does not cause the hook script to exit non-zero.
  - Done when: Hook script exits 0 in all cases (reflection errors are logged, not propagated); at least one `KnowledgeEntry` is written to `.reins/knowledge/` when the LLM returns a valid YAML block.
