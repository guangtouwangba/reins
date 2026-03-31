## Tasks

- [ ] **Task 1: Implement l4-semantic.ts**
  - Description: Define `SemanticReviewResult` and `SemanticIssue` interfaces. Implement `semanticReview(taskDescription, changedFiles, verificationResults)` that builds the structured prompt (task requirements, file diffs, verification summary, evaluation instructions with explicit JSON schema example), calls the configured LLM, parses the JSON response, and retries once with a stricter "return only raw JSON, no markdown fences" prompt on parse failure. On second failure, return a fallback result with `completenessScore: 0, confidence: 0` and the raw response in `rawResponse`.
  - Files: `src/evaluation/l4-semantic.ts`
  - Tests: Unit test prompt construction includes all three sections; test JSON parse success path returns correct structure; test retry is triggered on invalid JSON response; test fallback result returned after two failures; test `SemanticIssue` types are correctly mapped from LLM output.
  - Done when: `semanticReview` is exported, handles parse failures gracefully with retry, and unit tests pass for success and failure paths.

- [ ] **Task 2: Implement visual-reviewer.ts**
  - Description: Implement `loadScreenshots(projectRoot)` that reads all files in `.reins/logs/screenshots/` and base64-encodes them. Implement `visualReview(screenshots, taskDescription)` that builds a vision LLM message with each screenshot embedded as a base64 image and a prompt asking for UI correctness assessment relative to the task description. Return `{ passed: false, observations: [], score: 0, skipped: true }` immediately if no screenshots are provided or the directory does not exist.
  - Files: `src/evaluation/visual-reviewer.ts`
  - Tests: Unit test `loadScreenshots` returns empty array when directory does not exist; test skipped result returned when screenshots array is empty; test vision LLM is called with correct message shape when screenshots are present; test `score` is within 0–100.
  - Done when: `visualReview` and `loadScreenshots` are exported, skipped path works correctly, and unit tests pass.

- [ ] **Task 3: Implement contract-verifier.ts**
  - Description: Implement `verifyContract(projectRoot, strategy)` with dispatch to three strategies. `type_sharing`: run `tsc --noEmit` via `child_process.execSync`, parse stderr for error count, return passed if zero errors; skip if no `shared/` types directory found. `openapi`: locate `openapi.yaml` or `swagger.yaml`, extract `paths` keys, extract routes from `src/` using regex for Express/Next.js route patterns, diff the two sets, return issues for mismatches; skip if no spec file found. `runtime_record`: load `*.json` recording files from `.reins/recordings/`, replay each request via `curl`, compare response; skip if directory empty. `none`: return `{ skipped: true }` immediately.
  - Files: `src/evaluation/contract-verifier.ts`
  - Tests: Test `type_sharing` returns passed on zero tsc errors; test `openapi` detects a missing route; test `runtime_record` returns skipped when recordings directory is empty; test `none` always returns skipped; test each strategy returns skipped when prerequisites are absent.
  - Done when: All four strategy branches implemented, each degrades to skipped when prerequisites absent, and unit tests pass.

- [ ] **Task 4: Wire L4 into evaluator and update exit-condition**
  - Description: In `src/evaluation/exit-condition.ts`, add `L4_confidence: number` field to `ExitCondition`. Update `shouldExit()` so `strict` profile requires `L0_passed && L1_passed && L2_passed && L4_confidence >= 80`, and `fullstack` adds `L3_passed` to that set. In `src/evaluation/evaluator.ts`, after L2 (strict) or L3 (fullstack) passes: call `semanticReview`, call `visualReview` (only when `frontend_ui.screenshots: true` in `verification.yaml` and screenshots exist), call `verifyContract` with the configured strategy, compute the weighted `L4Score`, and set `ExitCondition.L4_confidence` from the semantic result's `confidence` field.
  - Files: `src/evaluation/evaluator.ts`, `src/evaluation/exit-condition.ts`
  - Tests: Test `shouldExit` for `strict` returns false when `L4_confidence` is 79; test it returns true at 80; test evaluator calls all three L4 sub-functions under `strict` profile; test visual review is skipped when `screenshots: false` in config; test contract verify result is included in returned `EvaluationResult`.
  - Done when: `ExitCondition.L4_confidence` wired through, `shouldExit` updated for strict/fullstack, evaluator calls L4 sub-functions in order, and tests pass.
