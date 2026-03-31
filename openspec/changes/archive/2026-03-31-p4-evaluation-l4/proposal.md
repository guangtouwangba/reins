## Why

Passing L0–L2 confirms the code is syntactically valid, tested, and the API responds correctly—but none of those layers can detect that the implementation misses a requirement, handles an edge case wrong, or diverges from the original intent. L4 closes this gap by having an LLM compare the task description against actual code diffs and verification results, and for frontend projects it adds a visual pass using multi-modal review of Playwright screenshots.

## What Changes

- Add `src/evaluation/l4-semantic.ts` implementing `semanticReview(taskDescription, changedFiles, verificationResults)` that calls an LLM with a structured prompt and returns a scored result (completeness 0–100, confidence, issues, suggestions)
- Add `src/evaluation/visual-reviewer.ts` implementing `visualReview(screenshots, taskDescription)` that sends screenshots to a vision-capable LLM and returns a `VisualReviewResult` with a pass/fail judgment and observations
- Add `src/evaluation/contract-verifier.ts` implementing the three contract verification strategies (`type_sharing`, `openapi`, `runtime_record`) selected from `verification.yaml`
- Extend `ExitCondition` with `L4_confidence: number`; update `strict` and `fullstack` profile exit checks to require `L4_confidence >= 80`
- Wire L4 into `src/evaluation/evaluator.ts` under `strict` and `fullstack` profiles; visual review runs when `frontend_ui.screenshots: true` in `verification.yaml` and L3 screenshots are available

## Capabilities

### New Capabilities

- `semantic-review`: Given a task description, file diffs, and verification results, produces a structured LLM evaluation: completeness score (0–100), confidence level, list of unmet requirements, list of over-implementations, and improvement suggestions
- `visual-review`: For frontend tasks, sends Playwright screenshots to a vision LLM and returns observations about UI correctness relative to the task description; result is folded into the L4 score
- `contract-verify`: Validates frontend/backend contract using the strategy declared in `verification.yaml`; `type_sharing` checks shared TypeScript types compile cleanly, `openapi` diffs the spec against route implementations, `runtime_record` replays recorded HTTP pairs against current responses

### Modified Capabilities

- `exit-condition`: Extended with `L4_confidence: number` field; `strict` profile exit now requires `L4_confidence >= 80` in addition to L0 + L1 + L2 passing; `fullstack` profile adds L3 to that set
- `evaluator`: Updated to call `semanticReview` and optionally `visualReview` after L2/L3 under `strict`/`fullstack` profiles; L4 result is included in the returned `EvaluationResult`

## Impact

- New source files: `src/evaluation/l4-semantic.ts`, `src/evaluation/visual-reviewer.ts`, `src/evaluation/contract-verifier.ts`
- Modified source files: `src/evaluation/evaluator.ts`, `src/evaluation/exit-condition.ts`
- L4 requires an LLM API call; model is configurable (defaults to the same model running the agent, can be overridden to `haiku` for cost control)
- Visual review requires screenshots produced by L3 (Playwright); L4 visual pass is skipped when no screenshots are available—L4 semantic still runs
- Contract verifier requires project-specific setup: `type_sharing` needs a `shared/` types package, `openapi` needs a spec file, `runtime_record` needs a recordings directory; all strategies degrade gracefully to skipped when prerequisites are absent
- `p2-evaluation-l0` must be in place (evaluator entry point and `ExitCondition` type exist)
