import type { Workflow } from './types.js';

export const setupWorkflow: Workflow = {
  id: 'reins-setup',
  name: 'reins-setup',
  description: 'Finish Reins configuration after init — fill pipeline.pre_commit and add project-specific constraints.',
  body: `Reins has scanned this repo and laid down a skeleton in \`.reins/\`, but
left project-specific fields empty because they need real codebase
knowledge. Your job: **update \`.reins/constraints.yaml\` in place** with
accurate values. Work through the phases in order — later phases depend on
earlier ones.

---

## Phase 0 — Read and audit what's already there

1. Read \`.reins/constraints.yaml\` top to bottom.
2. For every existing constraint (especially \`source: auto\`), verify
   against the real repo:
   - Does the \`scope\` path actually exist?
   - Is the \`rule\` factually correct?
   - Can the \`rule\` be phrased as **"must X"** or **"don't X"**? If it
     reads like operational how-to ("to run integration tests, first
     \`docker compose up\`"), it's **not a constraint** — delete it and put
     the info in the relevant \`AGENTS.md\` instead.
   - Will it be **already enforced** by a \`pre_commit\` command you're
     about to add (e.g. a rule "ESLint must pass" when \`pnpm lint\` is in
     \`pre_commit\`)? If yes, delete it — the command is the source of truth.
3. **Delete** any constraint that fails these checks. 5 load-bearing
   constraints are much better than 12 with 3 junk ones.

> Do not preserve bad constraints out of politeness. Scanner-generated ones
> are guesses, not gospel. Factually-wrong constraints actively mislead
> future agents.

---

## Phase 1 — \`pipeline.pre_commit\`

A list of shell commands the \`gate-stop\` hook runs **verbatim** with
\`cwd\` = repo root. If any command exits non-zero, the Stop hook blocks the
turn.

**Goal**: catch lint, type, and fast static check failures in < ~60s total.

**Rules**:

- Use \`string[]\`. Each entry is a full shell command line.
- Assume cwd is the repo root. For subdirectories, use \`cd\` explicitly:
  \`cd app/frontend && pnpm lint\`.
- Pick the actual package manager (read the lockfile: \`pnpm-lock.yaml\` →
  pnpm, \`yarn.lock\` → yarn, \`package-lock.json\` → npm, \`uv.lock\` → uv,
  \`poetry.lock\` → poetry, \`Cargo.lock\` → cargo, \`go.sum\` → go).
- Prefer what README / CONTRIBUTING / Makefile / \`.github/workflows/*.yml\`
  already documents. **Verify each command exists** before writing it.
- No network calls, no slow tests, no DB/Docker dependencies at Stop time.
- If the repo has no lint/typecheck tooling, leave the list empty. Empty
  is a legitimate answer — a wrong command is worse than no command.

**Examples** (pick what actually applies):

\`\`\`yaml
pipeline:
  pre_commit:
    # Simple Node
    - pnpm lint
    - pnpm typecheck

    # Monorepo with frontend in a subdir
    - cd app/frontend && pnpm lint
    - cd app/frontend && pnpm typecheck

    # Python with uv + ruff
    - uv run ruff check src tests
    - uv run ruff format --check src tests

    # Go
    - golangci-lint run ./...
    - go vet ./...

    # Rust
    - cargo clippy --all-targets -- -D warnings
    - cargo check --all-targets
\`\`\`

---

## Phase 2 — Refine \`stack\` and \`project.type\`

If the scan got any of these wrong (including \`unknown\`), fix them by
reading the repo. Don't invent values.

- \`stack.primary_language\`: the actual primary language
- \`stack.framework\`: the main framework (\`next\`, \`fastapi\`, \`rails\`, …)
- \`stack.test_framework\`: \`vitest\`, \`jest\`, \`pytest\`, \`go-test\`, …
- \`stack.package_manager\`: what the lockfile actually uses
- \`project.type\`: \`monolith\` | \`monorepo\` | \`microservice\` | \`library\`

---

## Phase 3 — Project-specific constraints (the hardest & most valuable part)

After pruning in Phase 0, add **5-8** new constraints that capture the
non-obvious knowledge a fresh AI agent would get wrong on the first try.

### A constraint earns its place only if **all** of these hold

1. **Expressible as "must X" or "don't X"** — not operational how-to.
2. **Not obvious** from 30 seconds of code-reading. Generic best practices
   ("use TypeScript strictly", "follow DDD layering") do not count.
3. **Not already enforced** by a \`pre_commit\` command.
4. **Grounded** — you can cite a specific file path, commit hash, past
   incident, config override, or README line that proves it.
5. **Concrete** — an agent would violate it on first try without this rule.

If you can't satisfy all five, don't write the constraint.

### Where to look — past pain encodes current rules

1. **Git log for "fix / revert / don't / instead of"** — each past mistake
   that made it into a commit message is a candidate. **Cite the hash.**
2. **Per-file lint/type overrides**: \`# noqa: N815\`,
   \`// eslint-disable\`, \`# type: ignore\`, \`@ts-expect-error\`, per-file
   \`ruff.toml\` entries. These encode intentional exceptions an AI will
   "helpfully" undo.
3. **Generated files / cross-service type contracts**: OpenAPI → TS types,
   Protobuf, Prisma schema, \`*.generated.ts\`. Editing the generated file
   is a classic AI mistake.
4. **Framework foot-guns**: Next.js Edge vs Node runtime, RSC vs client
   components, Django signals, FastAPI dependency injection, Rails
   concerns — wherever the framework has two similar paths and one
   silently fails.
5. **Migration / schema tooling**: Alembic vs Prisma Migrate vs Atlas vs
   raw SQL. Picking the wrong one breaks the migration chain.
6. **Architecture boundaries that are actually enforced**: not "layers
   exist" but "\`domain\` must not import \`infrastructure\` — enforced by
   \`import-linter\` in \`pyproject.toml\`".
7. **Load-bearing shared utilities**: the one error type, the one HTTP
   client, the one logger that everything must go through.

### Severity calibration — be strict

Most project-specific rules are \`important\`, not \`critical\`. Inflation
makes the whole system noise.

- \`critical\`: **past incident or CI/production breaker**. Violating it has
  caused real damage or will immediately break CI. You can cite a commit.
- \`important\`: project convention an AI will guess wrong on first try.
- \`helpful\`: soft preference. Removing the constraint costs almost nothing.

### Good vs bad examples

❌ **Bad**:

\`\`\`yaml
- rule: Use TypeScript strictly                       # already known
- rule: ESLint must pass with --max-warnings=0        # already in pre_commit
- rule: To run tests first \`docker compose up -d\`     # operational how-to
- rule: Follow DDD layering                           # generic
\`\`\`

✅ **Good** (notice: specific paths, commit hashes, concrete failures):

\`\`\`yaml
- id: dto-camelcase-intentional
  rule: Fields in \`app/backend/src/dto/canvas.py\` use camelCase on purpose
    to match the frontend JSON contract. Do not rename to snake_case —
    ruff N815 is noqa'd for that file.
  severity: important
  scope: app/backend/src/dto/canvas.py
  source: manual

- id: db-migrations-via-alembic
  rule: Database schema changes go through Alembic only. Do not hand-edit
    existing migrations or use any other migration tool — the migration
    chain has been broken before (commit d56eb130).
  severity: critical
  scope: app/backend/**
  source: manual
\`\`\`

---

## Phase 4 — Verify

1. Save \`.reins/constraints.yaml\` as valid YAML.
2. Run \`reins status\` — it must parse successfully and list the
   constraints you wrote.
3. Run \`reins test\` — all hooks should still report \`healthy\`.
4. Report back:
   - Which existing constraints you **pruned** and why (one line each).
   - Which commands you chose for \`pre_commit\` and where you got them
     from (README? Makefile? CI workflow?).
   - Which new project-specific constraints you added and the evidence
     for each (file path, commit hash, or config override).

---

## Hard rules

- Do not invent commands or cite commits you didn't actually read.
- Do not touch other files under \`.reins/\` — only \`constraints.yaml\`.
- Operational how-tos belong in \`AGENTS.md\` files, not constraints.
- An empty \`pre_commit\` list is fine. A wrong command is worse than no
  command. Unverified constraints are worse than fewer ones.
`,
};
