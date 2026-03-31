## Why

Full-stack projects need browser-level verification beyond API tests — L2 integration verify confirms the server responds correctly, but it cannot confirm that the user-facing UI renders, uploads, and navigates correctly end-to-end. L3 closes this gap using Playwright so the `fullstack` exit profile has a concrete, automatable gate.

## What Changes

- Add `src/evaluation/l3-e2e.ts`: parses `type: e2e` verification-case YAML files and drives the E2E runner
- Add `src/evaluation/e2e-runner.ts`: launches a headless Playwright browser, executes step sequences (navigate, upload, click, screenshot), captures failure screenshots
- Extend `environment-manager.ts` to support full-stack startup: `docker compose up` for DB/Redis dependencies, wait for health check before proceeding
- Extend `verification-runner.ts` to route `type: e2e` cases to the L3 runner
- Extend `evaluator.ts` to call `runL3()` and surface results to the exit-condition check
- Add `verification-cases/*.yaml` schema support for the `steps[]` format: `id`, `action` (navigate|upload|click|screenshot), `selector`, `url`, `file`, `expect` (selector, visible, timeout)
- Enable optional screenshot baseline comparison for visual regression detection
- Wire L3 result into the `fullstack` exit profile condition in `exit-condition.ts`

## Capabilities

### New Capabilities

- `l3-e2e-verification`: Execute YAML-defined E2E step sequences against a live dev server using a headless Playwright browser
- `e2e-step-runner`: Interpret navigate/upload/click/screenshot actions, assert selector visibility with configurable timeouts, and capture failure screenshots to `.reins/logs/e2e-failure-*.png`
- `fullstack-environment-startup`: Orchestrate `docker compose up` for declared service dependencies (DB, Redis), then start the dev server, then poll the health endpoint before running any verification
- `screenshot-baseline-comparison`: Optional visual regression check comparing E2E screenshots against stored baselines in `.reins/fixtures/screenshots/`

### Modified Capabilities

- `environment-manager`: Extended to handle multi-service Docker Compose startup and sequential health-check polling before dev server launch
- `verification-runner`: Extended to detect `type: e2e` in case files and dispatch to the L3 runner instead of the curl-based L2 runner
- `evaluator`: Extended to execute and record L3 results; `fullstack` profile exit condition now requires `L3_passed: true`

## Impact

- Adds `playwright` as a dev dependency; projects without Playwright installed will have L3 skipped with a warning
- `environment-manager.ts` startup sequence changes: Docker Compose startup is now a first-class step, not optional
- `exit-condition.ts` `fullstack` profile now requires `L3_passed`; existing projects using `fullstack` profile will not exit until L3 passes
- New YAML schema fields (`type: e2e`, `steps[]`) are additive and do not break existing `type: api` verification cases
- Failure screenshots are written to `.reins/logs/` which is already gitignored
