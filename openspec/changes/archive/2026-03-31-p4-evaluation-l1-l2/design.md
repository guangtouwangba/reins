## Approach

L1 is a pure static analysis pass over staged files—no process spawning, no network, runs in under 2 minutes. L2 is a procedural orchestration layer that delegates to existing project tooling (`pnpm dev`, `docker compose`, `curl`) rather than reimplementing environment management. Both layers are additive: they read existing project files and write results back to YAML; they do not mutate source code.

## Architecture

**L1 Coverage Gate** (`src/evaluation/l1-coverage.ts`)

```typescript
interface CoverageGateResult {
  passed: boolean;
  checks: CoverageCheckResult[];
}

interface CoverageCheckResult {
  type: string;
  passed: boolean;
  message: string;
  files?: string[];
}

async function runCoverageGate(projectRoot: string, stagedFiles: string[]): Promise<CoverageGateResult>
```

Five sequential checks:
1. `new_file_has_test`: For each new `.ts`/`.tsx` file (not already `.test.*`/`.spec.*`/`__tests__`), assert a corresponding `.test.ts` or `.spec.ts` sibling exists.
2. `no_empty_tests`: `grep -rn 'test\.skip|test\.todo|it\.skip|expect\(\)$'` across all `*.test.*` files in staged directories.
3. `branch_coverage`: Invoke project test runner with coverage flags; parse lcov/v8 output for new files only; assert covered branches / total branches >= 0.70.
4. `error_path_tested`: For each staged file containing `catch` or error handler patterns, assert at least one test file imports it and contains an error-path test (detects `throw`, `reject`, `rejects`, `toThrow`).
5. `mock_audit`: Parse test files for `jest.mock()`/`vi.mock()` calls; flag any mock that targets a file in `src/` (same project) rather than an external module.

**L2 Integration Verifier** (`src/evaluation/l2-integration.ts`)

```typescript
interface L2Result {
  passed: boolean;
  casesTotal: number;
  casesPassed: number;
  casesFailed: CaseResult[];
  environmentLog: string[];
}

async function runIntegrationVerify(projectRoot: string): Promise<L2Result>
```

Delegates to EnvironmentManager for lifecycle and VerificationRunner for case execution. Returns early with a skipped result if `verification.yaml` does not exist.

**Environment Manager** (`src/evaluation/environment-manager.ts`)

```typescript
interface EnvironmentConfig {
  start: { command: string; port: number; health_check: string; startup_timeout: string; env_file?: string }
  dependencies?: DependencyConfig[];
  database?: DatabaseConfig;
}

class EnvironmentManager {
  async prepare(): Promise<void>    // check deps, reset DB, seed
  async start(): Promise<void>      // spawn service, poll health_check
  async teardown(): Promise<void>   // kill service, reset DB
}
```

`start()` spawns the service command as a child process and polls the `health_check` URL every 500ms until `startup_timeout` elapses or HTTP 200 is received. `teardown()` always runs (in a `finally` block) even on case failure.

**Verification Runner** (`src/evaluation/verification-runner.ts`)

```typescript
interface VerificationCase {
  id: string;
  description: string;
  type: 'api' | 'e2e';
  verify: { method: string; path: string; headers?: Record<string,string>; body?: unknown; expect: { status: number; body?: unknown } }
  passes: boolean;
}

async function runVerificationCases(
  projectRoot: string,
  baseUrl: string,
  authToken?: string
): Promise<CaseResult[]>
```

Reads all `*.yaml` files in `.reins/verification-cases/`, skips `type: e2e` cases (those belong to L3), builds a `curl` command for each `type: api` case, executes it, compares status and body shape against `expect`, writes `passes: true/false` back to the YAML file. Template variables like `{{auth_token}}` are substituted before execution.

**Verification Recipe Generation** (wired into `src/scanner/environment-detector.ts` output consumed by `src/evaluation/l2-integration.ts`)

`verificationRecipeGenerate(projectRoot, envDetectorResult)` writes `.reins/verification.yaml` with detected values. If a field cannot be detected, it is written as a commented-out placeholder with a `# TODO` annotation.

**Data flow**:
```
evaluator.ts
  → runCoverageGate(stagedFiles)         // L1, ~30s
      → CoverageGateResult
  → runIntegrationVerify(projectRoot)    // L2, ~5min (skipped if no verification.yaml)
      → EnvironmentManager.prepare()
      → EnvironmentManager.start()
      → VerificationRunner.runCases()
      → EnvironmentManager.teardown()
      → L2Result
  → ExitCondition { L1_passed, L2_passed }
```

## Key Decisions

- **L1 branch coverage delegates to the project test runner**: Rather than instrumenting code ourselves, we invoke `pnpm test --coverage` and parse the output. This means L1 requires the project to have a coverage-capable test setup, but it avoids a parallel instrumentation stack. Projects without coverage support get a skipped result, not a failure.
- **L2 is skipped, not failed, when `verification.yaml` is absent**: During early development a project may not yet have verification recipes. Treating absence as a skip (not a gate failure) keeps L2 opt-in until the team commits to it.
- **curl over an HTTP client library for case execution**: Shell-level `curl` has zero npm dependencies, works in any environment, and its output is auditable in logs. Complex assertion logic (body shape matching) is handled in TypeScript after curl returns the response body.
- **Write `passes` back to YAML files**: The Ralph loop reads `passes` directly from case files to determine exit conditions. Writing results back to the source files means the same YAML serves as both spec and status.
- **Auth token obtained once, shared across all cases**: The `obtain` command in `verification.yaml` runs once before the case suite. Token is substituted into `{{auth_token}}` placeholders. This avoids repeated auth calls and mirrors real API client behavior.

## File Structure

```
src/evaluation/l1-coverage.ts          # CoverageGate: 5 checks, stagedFiles input
src/evaluation/l2-integration.ts       # L2 orchestrator, delegates to env + runner
src/evaluation/environment-manager.ts  # Service lifecycle: prepare/start/teardown
src/evaluation/verification-runner.ts  # YAML case loader, curl executor, result writer
```
