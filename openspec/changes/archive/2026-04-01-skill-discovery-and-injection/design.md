## Context

This change adds a skill discovery and injection layer to Reins. Skills are user-authored Markdown files that describe _how to do things_ in a project (e.g., "how to write e2e tests," "how to deploy"). They already exist in the Claude Code ecosystem (`.claude/commands/`, `.claude/skills/`) and in user-managed directories. Reins' role is to discover, index, match, and inject them — not to own or manage the files.

Relevant existing structures:

- `CodebaseContext` in `src/scanner/types.ts` is the output of scanning — skills will be a new field.
- `injectConstraints()` in `src/pipeline/constraint-injector.ts` builds the HARNESS_INIT prompt — skills injection hooks into this.
- `runPipeline()` in `src/pipeline/runner.ts` orchestrates stages — skill matching runs before HARNESS_INIT.
- `ReinsConfig` in `src/state/config.ts` holds runtime config — skills config is added here.
- `ADAPTER_REGISTRY` in `src/adapters/base-adapter.ts` shows the pattern for a discovery-based registry.

## Goals / Non-Goals

**Goals:**
- Discover skills from `.claude/commands/`, `.claude/skills/`, `.reins/skills/`, user-configured directories, and `~/.claude/commands/`.
- Extract triggers from YAML frontmatter or infer from filename/content.
- Build a `.reins/skill-index.json` index during `reins init`.
- Match skills to tasks during `reins develop` based on keyword/file/command overlap.
- Inject matched skills into the HARNESS_INIT prompt with a configurable token budget.
- Provide `reins skill create <name>` to scaffold a skill from project context.
- Provide `reins skills` to list all indexed skills.

**Non-Goals:**
- Auto-generate or auto-edit skill files — skills are user-authored.
- Replace Claude Code's native skill/command loading — Reins adds pipeline-aware matching on top.
- Support non-Markdown skill formats (YAML skill definitions, JSON, etc.).
- Implement skill versioning, sharing, or marketplace.
- Cross-project skill deduplication or conflict resolution beyond priority ordering.

## Decisions

### 1. Skill file format: Markdown with optional YAML frontmatter

A skill file is a plain `.md` file. If it has YAML frontmatter, Reins reads structured triggers from it:

```markdown
---
triggers:
  keywords: [e2e, test, playwright]
  files: ["*.spec.ts", "tests/**"]
  commands: [test, testSingle]
---

# E2E Testing with Playwright

## Test Runner
- Framework: Playwright
...
```

If no frontmatter is present, triggers are inferred:
- Filename `e2e-testing.md` → keywords: `["e2e", "testing"]`
- First `# Heading` → title
- Content keyword extraction: scan for tool names (playwright, cypress, jest, prisma, docker, etc.) from a built-in vocabulary

Alternatives considered:
- Require frontmatter for all skills: rejected because existing `.claude/commands/` files don't have it.
- Use a separate index file per directory: rejected because it adds a maintenance burden the user won't keep up with.

### 2. Source priority and deduplication

When the same skill ID (filename without extension) appears in multiple sources, the highest-priority source wins:

```
Priority 1: .claude/commands/ and .claude/skills/ (project-local)
Priority 2: .reins/skills/ (team-shared, git-tracked)
Priority 3: User-configured directories (skills.sources in config)
Priority 4: ~/.claude/commands/ and ~/.claude/skills/ (user global)
```

Deduplication is by ID only (filename stem). If `e2e-testing.md` exists in both `.claude/commands/` and `~/.claude/commands/`, the project-local version wins entirely.

Alternatives considered:
- Merge content from multiple sources: rejected because partial merging of Markdown is unreliable and confusing.
- Allow explicit override declarations: rejected as over-engineering for the initial release.

### 3. Skill index as derived data

The skill index (`.reins/skill-index.json`) is:
- Generated during `reins init` and `reins update`
- Gitignored (derived from source files)
- Refreshed automatically if `skills.auto_index: true` (default) during `reins develop`

```ts
interface SkillIndex {
  version: 1;
  generatedAt: string;
  skills: SkillEntry[];
}

interface SkillEntry {
  id: string;                    // filename without extension
  title: string;                 // from first # heading or filename
  sourcePath: string;            // absolute path to .md file
  sourceType: 'project' | 'team' | 'user';
  priority: number;              // 1-4 based on source
  triggers: {
    keywords: string[];
    files: string[];
    commands: string[];
  };
  contentHash: string;           // sha256 of file content for staleness detection
  tokenEstimate: number;         // rough token count (chars / 4)
}
```

Alternatives considered:
- In-memory only (no file): rejected because scanning many directories on every develop run is slow.
- YAML format: rejected because JSON is faster to parse and this is machine-only data.

### 4. Matching algorithm: weighted keyword scoring

```ts
function scoreSkill(skill: SkillEntry, task: string, context: CodebaseContext): number {
  let score = 0;

  // Keyword match: each keyword that appears in the task description
  const taskLower = task.toLowerCase();
  for (const kw of skill.triggers.keywords) {
    if (taskLower.includes(kw.toLowerCase())) {
      score += 10;
    }
  }

  // File pattern match: if task mentions files matching skill's file triggers
  // (used when spec/design stage has produced a file plan)
  for (const pattern of skill.triggers.files) {
    if (context.structure.files.some(f => matchGlob(f.path, pattern))) {
      score += 5;
    }
  }

  // Command match: if skill triggers include commands that exist in context.commands
  for (const cmd of skill.triggers.commands) {
    if (context.commands?.[cmd as keyof typeof context.commands]) {
      score += 3;
    }
  }

  return score;
}
```

Skills with score > 0 are candidates. Top N (default 5) by score are selected. Ties are broken by priority (lower number = higher priority).

Alternatives considered:
- LLM-based matching: rejected because it adds latency and cost for a task that keyword matching handles well.
- User-specified skill selection per task: rejected as default — but `--skills e2e-testing,api-design` flag is supported as override.

### 5. Injection strategy: budget-aware insertion

Skills are injected into the HARNESS_INIT prompt in a new `## Active Skills` section between `## Task` and `## Project Constraints`:

```
## Task
{task description}

## Active Skills (auto-loaded)

### E2E Testing with Playwright
Source: .claude/commands/e2e-test.md
{skill content}

### Auth Flow
Source: .claude/skills/auth-flow.md
{skill content}

## Project Constraints
...
```

Token budget enforcement:
1. Sort matched skills by score (highest first)
2. Add skills one by one until budget (default 4000 tokens) is reached
3. If a skill would exceed the budget, try the next smaller one
4. If no more skills fit, stop

Token estimation: `Math.ceil(content.length / 4)` — rough but sufficient for budgeting.

Alternatives considered:
- Summarize skills that don't fit: rejected because skill content is already human-curated and concise — summarizing would lose the specific patterns and examples that make skills valuable.
- Inject as separate files/context: rejected because a single prompt section is simpler and works across all pipeline modes.

### 6. Scaffolding: project-aware skill generation

`reins skill create <name>` generates a skill file at `.claude/commands/<name>.md`:

```ts
async function scaffoldSkill(name: string, projectRoot: string, context: CodebaseContext): Promise<string> {
  // 1. Determine skill topic from name
  // 2. Scan project for relevant signals:
  //    - Config files (playwright.config.ts, jest.config.js, .eslintrc, etc.)
  //    - Package.json scripts
  //    - Directory patterns (tests/, e2e/, __tests__/)
  //    - context.commands
  // 3. Generate a Markdown template with:
  //    - YAML frontmatter with inferred triggers
  //    - Detected tools and config
  //    - Placeholder sections for patterns and anti-patterns
  // 4. Write to .claude/commands/<name>.md
  // 5. Return the path
}
```

The scaffolder does NOT use LLM — it uses the same detection logic as the scanner to pre-fill known facts. The user then adds the procedural knowledge (patterns, examples, anti-patterns) that only they know.

## Risks / Trade-offs

- [Home directory scanning may be slow] → Mitigate with explicit source configuration and a 100ms timeout per directory.
- [Many skills with broad keywords may all match] → Mitigate with score-based ranking and max_skills limit (default 5).
- [Token budget may be too small for rich skills] → Mitigate with configurable `skills.inject.max_tokens` (default 4000, user can increase).
- [Inferred triggers from content may be noisy] → Mitigate with a curated keyword vocabulary (not arbitrary content words) and priority for explicit frontmatter triggers.
- [Skills may reference tools or patterns that have changed] → Mitigate with content hash comparison and `reins skills --stale` to surface skills not matched in 30+ days.

## Migration Plan

1. Add `SkillEntry` types and skill source scanning module.
2. Add trigger extraction (frontmatter parser + inference engine).
3. Build skill indexer that writes `.reins/skill-index.json`.
4. Integrate indexing into `reins init` and `reins update`.
5. Add skill matcher that scores skills against tasks.
6. Modify `constraint-injector.ts` to accept and inject skills.
7. Wire matcher + injection into `runPipeline()` before HARNESS_INIT.
8. Add `reins skill create` scaffolding command.
9. Add `reins skills` listing command.
10. Add config fields (`skills.sources`, `skills.inject.*`).
11. Add tests for each module.
12. Update `.gitignore` template to include `skill-index.json`.

## Open Questions

- Should `reins skill create` write to `.claude/commands/` or `.reins/skills/`? The former is Claude Code native; the latter is team-shareable via git.
- Should the skill index track match history (how often each skill was matched) for staleness detection and relevance tuning?
- Should skills support an `inject: always` mode that bypasses matching and injects on every develop run?
- Should there be a `reins skill edit <name>` that opens the skill file in `$EDITOR`?
