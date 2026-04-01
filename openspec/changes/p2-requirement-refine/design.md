## Approach

Replace the single RALPLAN stage with three progressive refinement stages — each producing a persistent markdown document. The stages are independently skippable and each requires user confirmation before advancing. The question engine uses project context to minimize user friction: infer what's known, ask only what's ambiguous, default what's optional.

All three stages share a common pattern: gather inputs → LLM generation → user review → persist artifact. The LLM is a tool, not the authority — the user confirms every artifact before it drives downstream work.

## Architecture

**Pipeline (updated):**

```
reins develop "add avatar upload"
  │
  ├─ REQUIREMENT_REFINE ─────────────────────────────────────────
  │   ├─ loadContext(): CodebaseContext + Constraint[] + CommandMap
  │   ├─ questionEngine.generate(task, context, constraints)
  │   │   ├─ Layer 1: universalDimensions()          → Question[]
  │   │   ├─ Layer 2: filterByContext(questions, ctx) → Question[] (reduced)
  │   │   └─ Layer 3: taskSpecificQuestions(task, ctx) → Question[] (LLM)
  │   ├─ categorize(questions) → { blocking, important, optional }
  │   ├─ inferFromContext(ctx) → InferredFact[]
  │   ├─ promptUser(blocking + important)
  │   ├─ applyDefaults(optional)
  │   ├─ specGenerator.generate(task, answers, inferred, constraints)
  │   ├─ printSpec() → user confirms [y/n/edit]
  │   └─ writeSpec(".reins/specs/<id>/spec.md")
  │
  ├─ DESIGN_GENERATE ────────────────────────────────────────────
  │   ├─ loadSpec(".reins/specs/<id>/spec.md")
  │   ├─ designGenerator.generate(spec, context, constraints, commands)
  │   │   ├─ architectureDiagram(spec, context)
  │   │   ├─ apiDesign(spec, context)
  │   │   ├─ dataModelChanges(spec, context)
  │   │   ├─ filePlan(spec, context, constraints)
  │   │   └─ technicalDecisions(spec, context)
  │   ├─ printDesign() → user confirms [y/n/edit]
  │   └─ writeDesign(".reins/specs/<id>/design.md")
  │
  ├─ TASK_GENERATE ──────────────────────────────────────────────
  │   ├─ loadDesign(".reins/specs/<id>/design.md")
  │   ├─ taskGenerator.generate(design, spec, constraints, commands)
  │   │   ├─ decomposeIntoTasks(design)
  │   │   ├─ mapConstraintsToTasks(tasks, constraints)
  │   │   ├─ addVerificationCommands(tasks, commands)
  │   │   └─ addDoneCriteria(tasks, spec.acceptanceCriteria)
  │   ├─ printTasks() → user confirms [y/n/edit]
  │   └─ writeTasks(".reins/specs/<id>/tasks.md")
  │
  ├─ HARNESS_INIT ───────────────────── [existing, modified]
  │   ├─ injectConstraints(constraints, profile)
  │   └─ injectSpec(spec, design, tasks)    ← NEW: spec content in prompt
  │
  ├─ EXECUTION ──────────────────────── [existing, unchanged]
  │
  ├─ RALPH ──────────────────────────── [existing, enhanced]
  │   ├─ checkConstraintCompliance()         [existing]
  │   └─ checkSpecCoverage(spec.acceptance)  ← NEW
  │
  └─ QA ─────────────────────────────── [existing, unchanged]
```

### Sub-module: Question Engine (`src/pipeline/question-engine.ts`)

Exports `generateQuestions(task, context, constraints): CategorizedQuestions`.

```typescript
interface Question {
  id: string;
  dimension: string;        // 'scope' | 'users' | 'data' | 'auth' | 'error' | 'migration' | 'task-specific'
  text: string;             // The question shown to user
  priority: 'blocking' | 'important' | 'optional';
  default?: string;         // For optional questions
  inferredAnswer?: string;  // If auto-resolved from context
  inferredFrom?: string;    // What context signal resolved it
}

interface InferredFact {
  dimension: string;
  fact: string;             // "Storage: S3"
  source: string;           // "aws-sdk in dependencies, S3_BUCKET in .env"
}

interface CategorizedQuestions {
  inferred: InferredFact[];    // Show to user as "already known"
  blocking: Question[];         // Must answer
  important: Question[];        // Should answer
  optional: Question[];         // Has defaults, shown as FYI
}
```

**Layer 1 — Universal dimensions:**

```typescript
const UNIVERSAL_DIMENSIONS: DimensionCheck[] = [
  {
    dimension: 'scope',
    questions: [
      { text: 'What is the core functionality? What is explicitly NOT included?', priority: 'blocking' },
    ],
  },
  {
    dimension: 'users',
    questions: [
      { text: 'Who uses this feature? Are there different permission levels?', priority: 'important' },
    ],
  },
  {
    dimension: 'data',
    questions: [
      { text: 'What data is created/modified? Any new database tables or fields?', priority: 'important' },
    ],
  },
  {
    dimension: 'error',
    questions: [
      { text: 'How should failures be handled? What does the user see on error?', priority: 'optional', default: 'Standard error response with message' },
    ],
  },
  {
    dimension: 'migration',
    questions: [
      { text: 'Does this affect existing users or data? Any migration needed?', priority: 'important' },
    ],
  },
  {
    dimension: 'auth',
    questions: [
      { text: 'Does this need authentication or authorization?', priority: 'important' },
    ],
  },
];
```

**Layer 2 — Context filtering:**

```typescript
function filterByContext(questions: Question[], context: CodebaseContext, constraints: Constraint[]): Question[] {
  const inferred: InferredFact[] = [];

  // If project has auth middleware → auto-resolve auth questions
  if (context.structure.files.some(f => f.path.includes('middleware/auth') || f.path.includes('auth.ts'))) {
    inferred.push({ dimension: 'auth', fact: 'Reuse existing auth middleware', source: 'detected auth middleware in project' });
    questions = questions.filter(q => q.dimension !== 'auth');
  }

  // If project has S3/cloud storage config → auto-resolve storage questions
  const deps = getDependencies(context);
  if (deps['aws-sdk'] || deps['@aws-sdk/client-s3']) {
    inferred.push({ dimension: 'storage', fact: 'S3', source: 'aws-sdk in dependencies' });
  }

  // If constraints require testing → don't ask about testing
  if (constraints.some(c => c.rule.includes('test'))) {
    inferred.push({ dimension: 'testing', fact: 'Required by project constraints', source: `constraint: ${c.id}` });
  }

  // If constraints specify ORM → don't ask about database access
  if (constraints.some(c => c.rule.includes('Prisma') || c.rule.includes('ORM'))) {
    inferred.push({ dimension: 'orm', fact: 'Prisma (project constraint)', source: `constraint: ${c.id}` });
  }

  return { questions, inferred };
}
```

**Layer 3 — Task-specific questions (LLM):**

```typescript
async function generateTaskSpecificQuestions(
  task: string,
  context: CodebaseContext,
  alreadyInferred: InferredFact[],
): Promise<Question[]> {
  const prompt = `
Given this task: "${task}"
And this project context:
  - Languages: ${context.stack.language.join(', ')}
  - Frameworks: ${context.stack.framework.join(', ')}
  - Architecture: ${context.architecture.pattern}

The following facts are already known (do NOT ask about these):
${alreadyInferred.map(f => `  - ${f.dimension}: ${f.fact}`).join('\n')}

Generate 3-5 specific questions that would help clarify the requirements for this task.
Focus on questions where the answer would change the implementation approach.
Do NOT ask about technology choices (those come from the project).
Do NOT ask about testing (project constraints handle that).

Return as JSON array: [{ "text": "...", "priority": "blocking|important|optional", "default": "..." }]
  `;

  // Use cheapest model (haiku) for question generation
  return await llm(prompt, { model: 'haiku', structured: true });
}
```

### Sub-module: Spec Generator (`src/pipeline/spec-generator.ts`)

Exports `generateSpec(task, answers, inferred, constraints): string`.

Produces a markdown document following this template:

```markdown
# {Task Title}

## Problem
{Why this feature is needed — derived from task description}

## Scope
{What's included — from user answers to scope questions}
- {Bullet points of confirmed functionality}

## Out of Scope
{What's explicitly excluded — from user answers}
- {Bullet points of excluded functionality}

## User Stories
{Derived from scope + users answers}
- As a {user type}, I want to {action}, so that {benefit}

## Decisions
| Question | Decision | Reason |
|----------|----------|--------|
{From user answers + inferred facts + applied defaults}

## Constraints
{Mapped from project constraints that are relevant to this feature}
- [{severity}] {constraint rule}

## Acceptance Criteria
{Derived from scope — each scope item becomes a testable criterion}
- [ ] {Criterion}
```

The generator uses LLM to flesh out the template sections from the raw answers, but the structure is fixed. The LLM adds natural language, not structure.

**Model selection:** Sonnet for spec generation — needs enough reasoning to synthesize answers into coherent prose, but doesn't need Opus-level depth. Estimated ~2K input tokens, ~1K output tokens per spec.

### Sub-module: Design Generator (`src/pipeline/design-generator.ts`)

Exports `generateDesign(spec, context, constraints, commands): string`.

Takes the confirmed `spec.md` and produces `design.md` with five sections:

**1. Architecture diagram** — ASCII art showing component flow. Generated by LLM with a structured prompt that names the concrete files/layers from the project context:

```
Prompt: "Given this spec and this project structure (Next.js app router + Prisma + S3),
draw an ASCII architecture diagram showing: Client component → API route → Service → External storage.
Use the actual directory conventions from this project (app/api/ for routes, lib/services/ for services)."
```

**2. API design** — For each endpoint implied by the spec:
- Method + path (following project conventions from `context.architecture`)
- Auth requirements (from spec decisions)
- Request/response shapes (TypeScript interfaces)
- Error codes

**3. Data model changes** — If the spec implies new data:
- Prisma migration (or equivalent for the project's ORM)
- Schema diff

**4. File plan** — Table of files to create/modify:

```markdown
| Action | File | Purpose |
|--------|------|---------|
| Create | `lib/services/avatar.ts` | Upload, compress, S3 storage logic |
| Create | `app/api/avatar/route.ts` | API route with auth + validation |
| ...    | ...  | ... |
```

File paths follow the project's existing conventions (detected from `context.conventions.fileStructure` and `context.architecture.layers`).

**5. Key technical decisions** — Rationale for choices not already in the spec:
- Why a particular library (e.g., "sharp already in deps")
- Why a particular approach (e.g., "server-side resize, not client crop")
- Any `next.config.js` or config changes needed

**Model selection:** Sonnet for design generation. Needs architectural reasoning + project convention awareness. Estimated ~3K input tokens, ~2K output tokens.

### Sub-module: Task Generator (`src/pipeline/task-generator.ts`)

Exports `generateTasks(design, spec, constraints, commands): string`.

Decomposes the design into implementation tasks. Each task is:

```typescript
interface GeneratedTask {
  title: string;
  description: string;
  files: string[];                // File paths to create/modify
  constraints: string[];          // Constraint IDs that apply
  verification: string[];         // Commands to run (from context.commands)
  doneWhen: string;               // Human-readable completion criteria
  dependsOn?: string[];           // Task IDs this depends on
}
```

**Task ordering rules:**
1. Database migrations first (other code depends on schema)
2. Shared services/utilities before consumers
3. API routes before UI components (backend before frontend)
4. Tests grouped with their source files (not as a separate final task)
5. Final verification task always last

**Constraint mapping:** For each task, scan the constraint list for rules that mention the task's domain. A task creating `app/api/avatar/route.ts` gets constraints about API format, auth, error handling. A task creating `lib/services/avatar.ts` gets constraints about ORM usage, return types.

**Verification commands:** Each task gets the relevant commands from `context.commands`:
- Service tasks: `context.commands.typecheck`, `context.commands.test` (with `testSingle` template)
- API tasks: `context.commands.lint`, `context.commands.typecheck`
- Final task: full `context.commands.test`, `context.commands.lint`, `context.commands.build`

**Model selection:** Sonnet. Task decomposition is mostly mechanical (follow the file plan from design.md), but needs LLM to write good descriptions and done-when criteria. Estimated ~2K input tokens, ~1.5K output tokens.

### Sub-module: Spec Storage (`src/state/specs.ts`)

Exports `createSpecDir(projectRoot, task): string` (returns spec ID), `writeSpecFile(projectRoot, specId, filename, content)`, `loadSpec(projectRoot, specId): SpecBundle`, `listSpecs(projectRoot): SpecEntry[]`.

**Spec ID format:** `<YYYY-MM-DD>-<slug>` where slug is the task description slugified (lowercase, hyphens, max 40 chars). Example: `2026-04-01-avatar-upload`.

**Directory structure:**

```
.reins/specs/
├── 2026-04-01-avatar-upload/
│   ├── spec.md
│   ├── design.md
│   └── tasks.md
├── 2026-04-02-email-notifications/
│   ├── spec.md
│   ├── design.md
│   └── tasks.md
└── index.yaml              # Metadata index for quick listing
```

**index.yaml:**

```yaml
specs:
  - id: "2026-04-01-avatar-upload"
    task: "添加用户头像上传功能"
    status: "implemented"       # draft | confirmed | in-progress | implemented | abandoned
    created: "2026-04-01T10:30:00Z"
    confirmed: "2026-04-01T10:35:00Z"
    implemented: "2026-04-01T11:20:00Z"
  - id: "2026-04-02-email-notifications"
    task: "添加邮件通知"
    status: "confirmed"
    created: "2026-04-02T09:00:00Z"
    confirmed: "2026-04-02T09:10:00Z"
```

Status transitions: `draft` → `confirmed` (user approves spec) → `in-progress` (execution starts) → `implemented` (QA passes) → or `abandoned` (user cancels).

### Pipeline Integration (`src/pipeline/runner.ts` modifications)

The stage array changes:

```typescript
// Before:
const STAGES = ['harness_init', 'ralplan', 'execution', 'ralph', 'qa'];

// After:
const STAGES = ['requirement_refine', 'design_generate', 'task_generate', 'harness_init', 'execution', 'ralph', 'qa'];
```

**Skip logic:**

```typescript
if (opts.skipStages.includes('spec')) {
  // Skip requirement_refine: create a minimal spec from raw task description
  spec = createMinimalSpec(task);
}
if (opts.skipStages.includes('design')) {
  // Skip design_generate: pass spec directly to task generation
}
if (opts.specPath) {
  // Load existing spec from path, skip requirement_refine
  spec = loadSpecFromPath(opts.specPath);
}
```

**Spec path option:** `--spec .reins/specs/2026-04-01-avatar-upload` loads all three files from that directory, skipping all generation stages and going straight to HARNESS_INIT + EXECUTION.

### HARNESS_INIT Enhancement (`src/pipeline/constraint-injector.ts`)

The injected prompt now includes spec content:

```typescript
function injectConstraints(task: string, config: InjectionContext, spec?: SpecBundle): string {
  return `
## Task
${task}

## Confirmed Requirements (from spec.md)
${spec?.specContent ?? 'No spec — use task description as requirements.'}

## Technical Design (from design.md)
${spec?.designContent ?? 'No design — plan your own approach following project conventions.'}

## Implementation Tasks (from tasks.md)
${spec?.tasksContent ?? 'No task breakdown — decompose the work yourself.'}

## Project Constraints (${activeConstraints.length} rules, profile: ${config.profile.name})
${activeConstraints.map(c => `- [${c.severity}] ${c.rule}`).join('\n')}

## Active Hooks
${config.hooks.filter(h => h.mode === 'block').map(h => `- ${h.constraintId}: ${h.description}`).join('\n')}
  `;
}
```

When specs are present, the executor gets precise instructions (spec + design + tasks). When absent (skip mode), it falls back to the current behavior.

### RALPH Review Enhancement (`src/pipeline/review.ts`)

Add a spec coverage check after constraint compliance:

```typescript
async function reviewLoop(execution, constraints, spec?): Promise<ReviewResult> {
  while (iteration < maxIterations) {
    // Existing: constraint compliance check
    const constraintResult = await checkConstraintCompliance(execution, constraints);

    // New: spec coverage check (only if spec exists)
    let specResult = { covered: true, uncovered: [] };
    if (spec?.acceptanceCriteria) {
      specResult = await checkSpecCoverage(execution, spec.acceptanceCriteria);
    }

    if (constraintResult.passed && specResult.covered) {
      return { success: true };
    }

    // Merge violations for fix iteration
    const issues = [
      ...constraintResult.violations,
      ...specResult.uncovered.map(c => ({ type: 'uncovered-criterion', criterion: c })),
    ];

    execution = await applyFixes(issues, injectedContext);
  }
}
```

**Spec coverage check:** For each acceptance criterion in `spec.md`, the reviewer checks:
1. Does any created/modified file implement this criterion? (file content search)
2. Does any test file verify this criterion? (test file content search)
3. If neither → mark as uncovered → trigger fix iteration

This is an LLM-based check (send criteria + file list + file contents → ask which criteria are covered). Uses sonnet for accuracy.

### Interactive Flow

**Terminal output for the full flow:**

```
$ reins develop "添加用户头像上传功能"

── Requirement Refinement ────────────────────────────────

Based on your project, I already know:
  • Storage: S3 (aws-sdk in dependencies, S3_BUCKET in .env)
  • Database: Prisma (project constraint: no-direct-sql)
  • Auth: existing middleware detected (lib/middleware/auth.ts)
  • Testing: required (project constraint: test-required)

A few questions to clarify the requirements:

? Who can upload avatars — only the user themselves, or admins too?
> Only the user themselves

? Do you need a frontend cropping UI, or just direct upload?
> Direct upload, no crop for V1

? Supported image formats? [default: JPG, PNG, WebP]
> (enter — accept default)

? Automatic compression? If yes, target size?
> Yes, compress to 200KB

── Spec ──────────────────────────────────────────────────

# User Avatar Upload

## Problem
Users have no way to customize their profile avatar...

## Scope
- Users upload their own avatar (JPG/PNG/WebP, ≤5MB)
- Automatic compression to 200KB
- Storage to S3
...

## Acceptance Criteria
- [ ] User can upload JPG/PNG/WebP avatar
- [ ] Files >5MB rejected with error message
- [ ] Uploaded images compressed to ≤200KB
- [ ] Avatar URL saved to users table via Prisma
- [ ] Unauthenticated requests return 401
- [ ] All new files have corresponding tests

Spec saved to .reins/specs/2026-04-01-avatar-upload/spec.md
Continue to design? [y/n/edit]
> y

── Design ────────────────────────────────────────────────

# User Avatar Upload — Technical Design

## Architecture
  Client              API                Service            Storage
  ──────────────────────────────────────────────────────────────
  AvatarUploader → POST /api/avatar → avatar.upload() →    S3
  (React)          (NextResponse)      (sharp + prisma)     ↓
                                                         avatar_url

## File Plan
| Action | File                         | Purpose              |
|--------|------------------------------|----------------------|
| Create | lib/services/avatar.ts       | Upload + compress    |
| Create | app/api/avatar/route.ts      | API with auth        |
| Create | components/AvatarUploader.tsx | Upload UI            |
...

Design saved to .reins/specs/2026-04-01-avatar-upload/design.md
Continue to tasks? [y/n/edit]
> y

── Tasks ─────────────────────────────────────────────────

- [ ] Task 1: Prisma migration (add avatar_url)
      Verify: pnpm prisma validate
- [ ] Task 2: Avatar service (lib/services/avatar.ts)
      Constraints: no-direct-sql, typed-returns
      Verify: pnpm typecheck
- [ ] Task 3: API route (app/api/avatar/route.ts)
      Constraints: api-nextresponse, auth-required
      Verify: myco lint --strict
...

Tasks saved to .reins/specs/2026-04-01-avatar-upload/tasks.md
Start execution? [y/n/edit]
> y

── Executing ─────────────────────────────────────────────
  [1/6] prisma migration... ✓
  ...
```

**Edit flow:** When user chooses `edit` at any confirmation point, the spec file is opened in their `$EDITOR` (or printed to stdout for manual copy-paste if no editor configured). After editing, the stage re-validates and re-displays.

**Non-interactive mode:** `--no-input` creates a minimal spec from the task description (no questions, all defaults applied, all inferred facts used) and proceeds through all stages without prompts.

## Key Decisions

- **Three separate documents, not one**: Separating spec (what) from design (how) from tasks (do) follows the SDD principle of concern separation. Each document can be reviewed independently. The spec can be written before the developer knows how to build it. The design can change without changing what was agreed.
- **Markdown, not YAML**: Spec documents are meant to be read by humans (in PR reviews, handoffs, post-mortems) and by AI (in the execution prompt). Markdown serves both. YAML would be machine-friendly but hostile to review.
- **LLM generates, user confirms**: The AI drafts every document, but the user has a confirmation gate at each stage. This prevents both "AI guessed wrong and I didn't know" and "AI asked 50 questions and I gave up." The sweet spot: AI does 80% of the work, user validates the remaining 20%.
- **Context-aware question filtering**: The biggest UX win. If the scanner already detected S3 config, Prisma, and auth middleware, showing those as "already known" instead of asking about them saves 3-5 questions and builds user trust ("this tool understands my project").
- **Haiku for questions, sonnet for documents**: Question generation is a classification task (what to ask) — haiku is sufficient. Document generation needs coherent reasoning and project-convention awareness — sonnet is the right balance of quality and cost.
- **Spec directory lives alongside constraints**: `.reins/specs/` sits next to `.reins/constraints.yaml`, keeping all reins artifacts in one place. Specs are git-tracked (unlike logs which are gitignored) because they're project documentation.
- **RALPLAN replaced, not wrapped**: The new stages produce strictly richer output than RALPLAN (persistent documents vs. in-memory plan). Keeping both would create confusion about which plan is authoritative. Clean replacement is simpler.
- **Acceptance criteria drive RALPH review**: This closes the loop — requirements from spec.md become verification targets in the review stage. Without this, the spec is documentation-only; with it, the spec is an executable contract.

## File Structure

```
src/pipeline/
├── runner.ts                   # modified: 7-stage pipeline, spec skip logic
├── requirement-refiner.ts      # NEW: orchestrates question → answer → spec flow
├── question-engine.ts          # NEW: 3-layer question generation + context filtering
├── spec-generator.ts           # NEW: LLM-based spec.md generation from answers
├── design-generator.ts         # NEW: LLM-based design.md generation from spec
├── task-generator.ts           # NEW: LLM-based tasks.md generation from design
├── constraint-injector.ts      # modified: injects spec content alongside constraints
├── review.ts                   # modified: adds spec-coverage checking
├── planning.ts                 # REMOVED: replaced by design-generator + task-generator
├── execution.ts                # unchanged
├── qa.ts                       # unchanged
└── omc-bridge.ts               # unchanged

src/state/
└── specs.ts                    # NEW: spec directory management, index.yaml I/O

src/commands/
└── init.ts                     # unchanged (specs are created via develop, not init)

src/cli.ts                      # modified: --skip spec, --skip design, --spec <path> options

.reins/specs/                   # NEW: spec document storage (git-tracked)
├── <spec-id>/
│   ├── spec.md
│   ├── design.md
│   └── tasks.md
└── index.yaml
```
