## Why

Reins currently governs AI agents with **constraints** (what not to do) and **context** (what the project looks like). But there is no mechanism for **skills** — positive, procedural knowledge about _how to do things_ in a project. When a user says "add e2e tests," the AI has no way to know that this project uses Playwright with Page Object pattern, `data-testid` selectors, and a specific test runner command.

Meanwhile, users already maintain skills in their local environment:

- `~/.claude/commands/` — global Claude Code commands
- `~/.claude/skills/` — global skills
- `.claude/commands/` — project-specific commands
- `.claude/skills/` — project-specific skills
- Team-shared skill repos cloned locally (e.g., `~/company-skills/`)

These skills are written in Markdown, version-controlled, and actively maintained. But they sit in isolation — the user must manually remember to reference the right skill at the right time. There is no discovery, no automatic matching, and no injection into the development pipeline.

The gap: **Reins knows the rules (constraints) but not the recipes (skills). The recipes already exist on disk — they just aren't connected to the pipeline.**

Three specific problems this causes:

1. **Redundant prompting**: Users repeatedly explain the same procedures ("use Page Object pattern," "run `pnpm test:e2e`") because the AI doesn't know these skills exist.
2. **Inconsistent execution**: Without skill injection, AI agents guess at procedures — sometimes they use the right test framework, sometimes they don't.
3. **Knowledge rot**: Skills are written but never loaded automatically, so users stop maintaining them because the effort-to-value ratio is too low.

## What Changes

### 1. Skill source discovery (`src/scanner/skill-scanner.ts`)

A new scanner module that discovers skills from multiple locations, in priority order:

| Priority | Source | Scope | Example Path |
|----------|--------|-------|-------------|
| 1 (highest) | Project `.claude/` | Per-project | `.claude/commands/e2e-test.md` |
| 2 | Project `.reins/skills/` | Per-project (team-shared) | `.reins/skills/deploy.md` |
| 3 | User config sources | Per-user | `~/company-skills/api-design.md` |
| 4 | User `.claude/` | Per-user global | `~/.claude/commands/react-patterns.md` |

Custom source directories are configured in `.reins/config.yaml`:

```yaml
skills:
  sources:
    - ~/company-skills
    - ~/my-skills
```

The scanner reads each `.md` file and extracts:
- **Title**: first `# Heading` line
- **Triggers**: extracted from YAML frontmatter (`triggers:` field) if present, or inferred from filename and content keywords
- **Content**: the full Markdown body (for injection)
- **Source path**: absolute path to the file (for display and editing)

### 2. Skill index (`src/scanner/skill-indexer.ts`)

Builds a searchable index from discovered skills. The index maps trigger signals to skill IDs:

```ts
interface SkillEntry {
  id: string;               // "e2e-testing" (derived from filename)
  title: string;            // "E2E Testing with Playwright"
  sourcePath: string;       // absolute path to .md file
  sourceType: 'project' | 'team' | 'user';
  triggers: SkillTrigger;
  contentHash: string;      // for change detection
}

interface SkillTrigger {
  keywords?: string[];      // ["test", "e2e", "playwright"]
  files?: string[];         // ["*.spec.ts", "tests/**"]
  commands?: string[];      // ["test", "testSingle"]
}
```

The index is written to `.reins/skill-index.json` during `reins init` and refreshed on `reins update`. It is gitignored (derived data).

**Trigger inference** when no frontmatter is present:
- Filename `e2e-testing.md` → keywords: `["e2e", "testing"]`
- Content contains "Playwright" → keywords: `["playwright"]`
- Content contains code blocks with `pnpm test` → commands: `["test"]`

### 3. Skill matching (`src/pipeline/skill-matcher.ts`)

During `reins develop`, after the task is parsed, the matcher scores each indexed skill against the current task:

```ts
function matchSkills(task: string, context: CodebaseContext, index: SkillEntry[]): ScoredSkill[] {
  // Score each skill against:
  // 1. Task description keyword overlap
  // 2. Files being created/modified (from spec or task description)
  // 3. Commands being used
  // Return skills sorted by relevance score, top 3-5
}
```

Matching is lightweight (keyword/glob matching, no LLM) to keep it fast.

### 4. Skill injection into pipeline

Matched skills are injected into the HARNESS_INIT prompt alongside constraints:

```
## Task
Add e2e tests for the login page

## Active Skills (auto-loaded)
### E2E Testing with Playwright (from .claude/commands/e2e-test.md)
[full skill content]

### Auth Flow (from .claude/skills/auth-flow.md)
[full skill content]

## Project Constraints (12 rules, profile: default)
- [critical] Use Prisma for all database queries
...
```

Skills are injected between the task and constraints sections. A token budget (default: 4000 tokens across all skills) prevents context overflow. If matched skills exceed the budget, lower-priority skills are summarized or dropped.

### 5. Skill scaffolding command

`reins skill create <name>` generates a skill starter file from project context:

```bash
$ reins skill create e2e-testing

Created: .claude/commands/e2e-testing.md

  Detected:
    Test runner: Playwright (from playwright.config.ts)
    Test pattern: tests/**/*.spec.ts
    Commands: pnpm test:e2e

  Open in editor to customize, then run 'reins init' to index.
```

The scaffolder:
1. Scans the project for relevant signals (test framework, config files, directory patterns)
2. Generates a Markdown template pre-filled with detected context
3. Writes to `.claude/commands/` (Claude Code native location)
4. Prompts the user to edit and customize

### 6. Skill listing and status

`reins skills` shows all discovered skills and their status:

```bash
$ reins skills

  Source                              Skills  Triggers
  ──────────────────────────────────  ──────  ────────
  .claude/commands/ (project)         3       12 keywords
  .claude/skills/ (project)           1       4 keywords
  ~/company-skills/ (team)            5       18 keywords
  ~/.claude/commands/ (global)        2       6 keywords
  ──────────────────────────────────
  Total: 11 skills indexed

  Recently matched:
    e2e-testing     matched 3 times (last: 2h ago)
    api-design      matched 1 time  (last: 1d ago)
```

### 7. Config integration

Skills configuration in `.reins/config.yaml`:

```yaml
skills:
  enabled: true
  sources:                          # additional directories to scan
    - ~/company-skills
  inject:
    max_tokens: 4000                # token budget for skill injection
    max_skills: 5                   # max skills per task
  auto_index: true                  # re-index on every develop run
```

## Capabilities

### New Capabilities
- `skill-discovery`: Scan multiple source directories for Markdown skills with trigger extraction
- `skill-matching`: Match skills to tasks based on keywords, files, and commands
- `skill-injection`: Inject matched skills into the pipeline HARNESS_INIT prompt
- `skill-scaffolding`: Generate skill starters from project context
- `skill-listing`: Show all indexed skills and match history

### Modified Capabilities
- `pipeline-runner`: HARNESS_INIT stage injects skills alongside constraints
- `constraint-injector`: Accept optional skills parameter
- `cli`: New `skill` and `skills` commands

## Impact

- Affected code: `src/scanner/skill-scanner.ts` (new), `src/scanner/skill-indexer.ts` (new), `src/pipeline/skill-matcher.ts` (new), `src/pipeline/constraint-injector.ts` (modified), `src/pipeline/runner.ts` (modified), `src/commands/skill-cmd.ts` (new), `src/cli.ts` (modified), `src/state/config.ts` (modified)
- Affected systems: Scanner, pipeline, CLI, config
- APIs/UX: New `reins skill create`, `reins skills` commands; automatic skill injection during develop
- Phase: P2 — builds on existing pipeline and scanner infrastructure

## Design Principles

1. **Reins does not own skills** — Skills live in the user's existing directories (`.claude/`, home directory, team repos). Reins discovers and indexes them but never moves or copies them.
2. **Zero migration cost** — Users with existing `.claude/commands/` skills get automatic discovery with no changes. New users get scaffolding help.
3. **User writes, Reins reads** — Skills are authored and maintained by humans. Reins never auto-modifies a skill file. The AI may _suggest_ updates, but the user makes the edit.
4. **Additive, not required** — Skills are optional enhancement. Reins works fine without any skills. Skills make it better, not mandatory.
5. **Respect priority** — Project skills override user skills override global skills. Closer to the project = higher authority.

## Risks / Trade-offs

- [Scanning user home directories may be slow or hit permission issues] → Mitigate with configurable source list (only scan what's declared) and timeout per directory.
- [Keyword-based matching may inject irrelevant skills] → Mitigate with explicit YAML frontmatter triggers that override inference, and a token budget that limits injection volume.
- [Users may not know skill format or how to write good skills] → Mitigate with `reins skill create` scaffolding and clear examples in documentation.
- [Skill content may be stale relative to project changes] → Mitigate with content hashing in the index and a `reins skills --stale` flag that identifies skills not matched in 30+ days.
- [Multiple skills may conflict (e.g., two testing skills)] → Mitigate with source priority order — project beats user beats global — and max_skills limit.
