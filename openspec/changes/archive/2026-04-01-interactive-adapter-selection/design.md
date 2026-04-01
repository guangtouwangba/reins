## Context

This change restructures the adapter system from a hardcoded "generate all" model to a user-selected, auto-detected, extensible registry. The current adapter interface (`Adapter` in `src/adapters/base-adapter.ts`) produces a single file per adapter with a fixed `outputPath`. The new design supports multi-file adapters, tool detection, shared content generation, and interactive selection.

Relevant existing structures:

- `Adapter` interface in `src/adapters/base-adapter.ts` owns the generate contract.
- `DEFAULT_ADAPTERS` array in `src/adapters/index.ts` is the hardcoded adapter list.
- `runAdapters()` in `base-adapter.ts` iterates adapters, writes files, and returns results.
- `initCommand()` in `src/commands/init.ts` calls `runAdapters(projectRoot, constraints, context, config, DEFAULT_ADAPTERS)`.
- `ReinsConfig` in `src/state/config.ts` is the runtime config loaded from `.reins/config.yaml`.

## Goals / Non-Goals

**Goals:**
- Let users choose which AI tools to generate config for during `reins init`.
- Auto-detect tools already in use and pre-select them.
- Persist selection so `reins update` doesn't re-prompt.
- Add adapters for Cline, Continue.dev, Amazon Q, Augment, Aider, Gemini CLI.
- Upgrade Cursor and Windsurf adapters to current directory-based formats.
- Factor out shared content generation so adapters are thin wrappers.
- Support `--no-input` (auto-detect only) and `--adapters a,b,c` (explicit) modes.

**Non-Goals:**
- Support every AI tool in existence — focus on tools that auto-load project-level config files.
- Custom adapter plugin system — out of scope for this change.
- Per-directory adapter selection (e.g., different tools for different packages in a monorepo).
- Adapter output validation against tool-specific schemas.

## Decisions

### 1. Replace `Adapter` with `AdapterDefinition` registry

The current `Adapter` interface is too minimal (single outputPath, no detection, no multi-file). Define a new `AdapterDefinition`:

```ts
interface AdapterDefinition {
  id: string;                                    // 'claude-code', 'cursor', 'cline', etc.
  displayName: string;                           // 'Claude Code', 'Cursor', etc.
  description: string;                           // '→ CLAUDE.md, AGENTS.md, .claude/settings.json'
  detect(projectRoot: string): boolean;          // auto-detection
  generate(input: AdapterInput): AdapterOutput[];
}

interface AdapterInput {
  projectRoot: string;
  constraints: Constraint[];
  context: CodebaseContext;
  config: ConstraintsConfig;
  content: SharedContent;                        // pre-built shared content
}

interface AdapterOutput {
  path: string;                                  // relative to projectRoot
  content: string;
  label: string;                                 // for summary display
}
```

All adapters are registered in an `ADAPTER_REGISTRY: AdapterDefinition[]` ordered by recommended selection priority.

Alternatives considered:
- Keep old interface and add optional fields: rejected because it forces awkward null checks and doesn't support multi-file.
- Use class-based adapters with inheritance: rejected because the adapters are stateless — a plain object with functions is simpler.

### 2. Shared content builder

Factor content generation into `src/adapters/shared-content.ts`:

```ts
interface SharedContent {
  projectSummary: string;          // "TypeScript + vitest + pnpm"
  architectureSummary: string;     // "standard with src/ layout"
  criticalRules: string[];         // top constraints by severity
  importantRules: string[];
  helpfulRules: string[];
  commandsBlock: string;           // "## Commands\n- Build: `pnpm run build`\n..."
  conventionsBlock: string;        // "## Conventions\n- camelCase naming\n..."
  hooksSummary: string;            // "3 hooks active (2 block, 1 warn)"
  constraintCount: { critical: number; important: number; helpful: number };
}

function buildSharedContent(constraints, context, config): SharedContent;
```

Each adapter calls `buildSharedContent()` once, then wraps the result into its tool-specific format. This eliminates the duplicated constraint-formatting logic across the current 5 adapters.

Alternatives considered:
- Let each adapter build its own content from raw constraints: rejected because it's the current approach and leads to inconsistent output across tools.
- Use template strings with slot replacement: rejected because the format differences between tools (Markdown headings vs. YAML frontmatter vs. tagged lines) are structural, not just textual.

### 3. Interactive selection with auto-detection

The selection flow in `initCommand()`:

```
1. Run ADAPTER_REGISTRY.map(a => ({ ...a, detected: a.detect(projectRoot) }))
2. If --adapters flag provided → use explicit list, skip prompt
3. If --no-input or non-TTY → use detected adapters only (fallback: claude-code)
4. Otherwise → show multi-select prompt with detected items pre-checked
5. Save selection to config: adapters.enabled = ['claude-code', 'cursor']
6. Run selected adapters
```

Use `@inquirer/prompts` for the interactive checkbox (already available via Node.js built-ins, or use basic readline-based implementation to avoid new dependencies).

Alternatives considered:
- Always generate all and let users delete unwanted files: rejected because it pollutes the project and .gitignore.
- Detect-only with no prompt: rejected because detection can't cover all cases (user might have Cursor installed but use Claude Code for this project).

### 4. Selection persistence in config

Add to `ReinsConfig`:

```ts
interface AdaptersConfig {
  enabled: string[];  // adapter IDs: ['claude-code', 'cursor']
}
```

Stored in `.reins/config.yaml` under `adapters.enabled`. When `reins update` runs, it reads this list instead of re-prompting. When `reins init` runs again on an already-initialized project, it pre-selects from the saved list and lets the user adjust.

### 5. Adapter format upgrades

**Cursor**: Detect which format is in use:
- If `.cursor/rules/` directory exists → write `.cursor/rules/reins.mdc` with frontmatter (`description`, `globs: **`, `alwaysApply: true`)
- If `.cursorrules` exists and `.cursor/rules/` doesn't → write `.cursorrules` (backward compat)
- Fresh project → use new `.cursor/rules/reins.mdc` format

**Windsurf**: Same pattern:
- If `.windsurf/rules/` exists → write `.windsurf/rules/reins.md`
- If `.windsurfrules` exists → write `.windsurfrules`
- Fresh → use new `.windsurf/rules/reins.md`

### 6. New adapter specifications

| ID | detect() | Output files | Format |
|----|----------|-------------|--------|
| `claude-code` | `.claude/` exists OR `CLAUDE.md` exists | `CLAUDE.md`, `AGENTS.md`, `.claude/settings.json` | Markdown + JSON hooks |
| `cursor` | `.cursor/` OR `.cursorrules` exists | `.cursor/rules/reins.mdc` or `.cursorrules` | Markdown with YAML frontmatter |
| `copilot` | `.github/copilot-instructions.md` OR `.github/` exists | `.github/copilot-instructions.md` | Markdown |
| `windsurf` | `.windsurf/` OR `.windsurfrules` exists | `.windsurf/rules/reins.md` or `.windsurfrules` | Markdown |
| `cline` | `.clinerules` exists | `.clinerules` | Markdown |
| `continue` | `.continue/` exists | `.continue/rules/reins.md` | Markdown |
| `amazon-q` | `.amazonq/` exists | `.amazonq/rules/reins.md` | Markdown |
| `augment` | `.augment-guidelines` OR `.augment/` exists | `.augment-guidelines` | Markdown |
| `aider` | `.aider.conf.yml` OR `CONVENTIONS.md` exists | `CONVENTIONS.md` | Markdown |
| `gemini` | `GEMINI.md` exists | `GEMINI.md` | Markdown |

## Risks / Trade-offs

- [Interactive prompt adds a step to init] → Mitigate with fast auto-detection and `--no-input`/`--adapters` bypasses.
- [Adapter registry grows with each tool] → Mitigate with shared content builder keeping each adapter to ~30 lines.
- [Cursor .mdc frontmatter may break if Cursor changes its format] → Mitigate with minimal frontmatter (only `alwaysApply: true`).
- [Some tools read AGENTS.md (Cline, Roo Code) — generating it only for Claude Code may miss these] → Mitigate by having Claude Code adapter always produce AGENTS.md, and having Cline adapter note that AGENTS.md is shared.

## Migration Plan

1. Create `SharedContent` builder and migrate existing adapter logic to use it.
2. Define `AdapterDefinition` interface and migrate existing 5 adapters to new interface.
3. Add detection logic to existing adapters.
4. Add 6 new adapters (Cline, Continue, Amazon Q, Augment, Aider, Gemini).
5. Upgrade Cursor and Windsurf adapters to support new directory formats.
6. Add selection prompt to `initCommand()` with auto-detection.
7. Add `adapters.enabled` to config persistence.
8. Add `--adapters` and `--no-input` flags to CLI.
9. Update `reins update` to use persisted selection.
10. Update tests for all new adapters and the selection flow.

## Open Questions

- Should the AGENTS.md adapter be treated as part of `claude-code` or as a standalone shared adapter that multiple tools can opt into?
- Should `reins init` clean up files from previously selected but now deselected adapters?
- Should there be a `reins adapters list` command to show available and active adapters?
