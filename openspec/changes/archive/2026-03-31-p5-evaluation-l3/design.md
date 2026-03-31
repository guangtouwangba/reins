## Approach

Extend the existing evaluation stack with a new L3 layer that reads `type: e2e` verification-case YAML files and drives a Playwright headless browser through the declared step sequence. Environment startup is extended to run Docker Compose before the dev server so the full dependency chain is live before any browser action is taken. The E2E runner is a standalone module that the verification runner dispatches to, keeping L2 and L3 execution paths separate.

## Architecture

**Environment startup sequence** (`environment-manager.ts`):
1. Parse `verification.yaml` `environment.dependencies[]`
2. For each dependency with a `setup` command, run it (e.g. `docker compose up -d postgres redis`)
3. Poll each dependency's `check` command until it passes (max attempts configurable)
4. Run `environment.start.command` (dev server) in background
5. Poll `environment.start.health_check` URL until HTTP 200 or `startup_timeout` is exceeded
6. Return a running environment handle with a `teardown()` method

**L3 entry point** (`evaluation/l3-e2e.ts`):
- `runL3(casePaths: string[], env: RunningEnvironment): Promise<L3Result>`
- Filters verification-case files to those with `type: e2e`
- For each case, calls `E2ERunner.execute(case, env.baseUrl)`
- Aggregates step-level pass/fail into a case-level result
- Returns `{ passed: boolean, cases: CaseResult[], screenshots: string[] }`

**E2E runner** (`evaluation/e2e-runner.ts`):
- `execute(case: E2ECase, baseUrl: string): Promise<CaseResult>`
- Launches Playwright `chromium.launch({ headless: true })`
- Iterates `case.steps[]`, dispatching by `action`:
  - `navigate`: `page.goto(baseUrl + step.url)`, then assert `step.expect.selector` is visible
  - `upload`: `page.setInputFiles(step.selector, step.file)`, then assert expect
  - `click`: `page.click(step.selector)`, then assert expect with `step.expect.timeout`
  - `screenshot`: `page.screenshot({ path: screenshotPath })`, optionally compare to baseline
- On any step failure: capture failure screenshot to `.reins/logs/e2e-failure-<caseId>-<stepId>-<timestamp>.png`
- Closes browser in `finally` block regardless of outcome

**Screenshot baseline comparison** (optional, in `e2e-runner.ts`):
- If `step.action === 'screenshot'` and a baseline exists at `.reins/fixtures/screenshots/<name>.png`, run pixel diff
- Diff threshold configurable via `evaluation.e2e.screenshot_diff_threshold` (default: 0.01 = 1%)
- Diff failure is non-blocking by default; set `evaluation.e2e.screenshot_diff_blocking: true` to make it fail the step

**Exit condition integration** (`exit-condition.ts`):
- `fullstack` profile condition extended: `L0_passed && L1_passed && L2_passed && L3_passed && L4_confidence >= 80`
- `L3Result.passed` maps directly to `ExitCondition.L3_passed`

**Verification runner dispatch** (`verification-runner.ts`):
- After loading case files, partition into `type: api` (L2) and `type: e2e` (L3)
- Run L2 cases first (fail fast), then L3 cases if L2 passed
- Surface combined results to `evaluator.ts`

## Key Decisions

- **Playwright over Cypress**: Playwright ships a headless-first API, has a smaller install footprint for CI, and is already detected by the existing `environment-detector.ts` (`hasPlaywright` flag). Cypress requires a separate server process.
- **Steps as YAML, not code**: Keeping E2E cases in YAML (not JS test files) means non-engineers can read and modify verification cases, and the harness retains full control over execution — no test runner subprocess needed.
- **Docker Compose startup in environment-manager, not a separate module**: The startup sequence is already environment-manager's responsibility; adding Docker Compose steps there avoids a new abstraction and keeps all service lifecycle in one place.
- **Failure screenshots always captured**: Even when a step assertion passes, the screenshot action captures state. This gives a visual trace of what the browser saw without needing to reproduce the run.
- **Screenshot comparison is opt-in and non-blocking by default**: Visual regression is useful but noisy on CI with dynamic content. Making it opt-in and non-blocking lets teams enable it incrementally.

## File Structure

```
src/evaluation/
├── evaluator.ts                    # extended: calls runL3(), surfaces L3Result
├── l3-e2e.ts                       # new: L3 entry point, case routing, result aggregation
├── e2e-runner.ts                   # new: Playwright browser control, step dispatch, screenshot capture
├── verification-runner.ts          # extended: partitions api vs e2e cases, dispatches L3
├── environment-manager.ts          # extended: Docker Compose startup, sequential health polling
└── exit-condition.ts               # extended: fullstack profile requires L3_passed

.reins/
├── verification.yaml               # extended: environment.dependencies[].setup/teardown/check
├── verification-cases/
│   └── <feature>-e2e.yaml         # new: type: e2e, steps[] format
├── fixtures/
│   └── screenshots/               # baseline screenshots for optional visual regression
└── logs/
    └── e2e-failure-*.png          # failure screenshots (gitignored)
```
