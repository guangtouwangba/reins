## Why

`reins init` currently writes output files for **all 5 adapters** (CLAUDE.md, AGENTS.md, .cursorrules, copilot-instructions.md, .windsurfrules) without asking the user which tools they actually use. This creates three problems:

1. **Noise**: A developer using only Claude Code gets 4 unnecessary files polluting their project root and git history.
2. **Missing tools**: The adapter list is frozen at 5 tools from early 2025. The market now has 15+ mainstream AI coding tools, each with its own config format. Developers using Cline, Roo Code, Continue.dev, Amazon Q, Augment, Aider, or Gemini CLI get nothing.
3. **Stale formats**: Cursor migrated from `.cursorrules` (single file) to `.cursor/rules/*.mdc` (directory + metadata). Windsurf migrated from `.windsurfrules` to `.windsurf/rules/*.md`. The current adapters output the old formats.

This matters because Reins' core value proposition is _generating context files that AI tools auto-load_. If the generated files are in the wrong format, for the wrong tool, or for tools the user doesn't have — the product fails silently.

## What Changes

### 1. Interactive tool selection during `reins init`

Replace the current "generate all adapters" behavior with an interactive multi-select prompt:

```
$ reins init

Reins: Scanning project...
  ✓ Stack: TypeScript + vitest + pnpm
  ✓ 12 constraints generated

Which AI tools do you use? (space to select, enter to confirm)
  ◉ Claude Code        → CLAUDE.md, AGENTS.md, .claude/settings.json
  ◯ Cursor             → .cursor/rules/reins.mdc
  ◯ GitHub Copilot     → .github/copilot-instructions.md
  ◯ Windsurf           → .windsurf/rules/reins.md
  ◯ Cline / Roo Code   → .clinerules, AGENTS.md
  ◯ Continue.dev       → .continue/rules/reins.md
  ◯ Amazon Q           → .amazonq/rules/reins.md
  ◯ Augment            → .augment-guidelines
  ◯ Aider              → CONVENTIONS.md
  ◯ Gemini CLI         → GEMINI.md

Generated:
  ✓ .reins/constraints.yaml
  ✓ CLAUDE.md
  ✓ AGENTS.md
  ✓ .claude/settings.json
```

**Auto-detection**: Before prompting, scan for existing tool config to pre-select tools that are already in use:
- `.cursor/` directory exists → pre-select Cursor
- `.github/copilot-instructions.md` exists → pre-select Copilot
- `.clinerules` exists → pre-select Cline
- `.claude/` exists → pre-select Claude Code
- etc.

**Selection persistence**: Save the choice to `.reins/config.yaml` under `adapters.enabled: [claude-code, cursor, ...]` so `reins update` regenerates only the selected adapters without re-prompting.

**Non-interactive mode**: `reins init --no-input` uses auto-detection results. If nothing detected, defaults to Claude Code only. `reins init --adapters claude-code,cursor` explicitly selects without prompting.

### 2. Update existing adapters to current formats

| Adapter | Current (old) | Updated (new) |
|---------|---------------|---------------|
| Cursor | `.cursorrules` (single file) | `.cursor/rules/reins.mdc` (directory + frontmatter) |
| Windsurf | `.windsurfrules` (single file) | `.windsurf/rules/reins.md` (directory + trigger field) |

Keep backward-compatible: if the old file exists and user hasn't migrated, write to old path. Otherwise use new path.

### 3. Add new adapters

**High priority** (large or rapidly growing user bases):

| Tool | Output Path | Format Notes |
|------|-------------|--------------|
| Cline / Roo Code | `.clinerules` | Markdown; Roo Code also reads AGENTS.md automatically |
| Continue.dev | `.continue/rules/reins.md` | Markdown with name/description properties |
| Amazon Q | `.amazonq/rules/reins.md` | Markdown in directory |
| Augment | `.augment-guidelines` | Markdown in project root |
| Aider | `CONVENTIONS.md` | Markdown; loaded via `.aider.conf.yml` read flag |
| Gemini CLI | `GEMINI.md` | Markdown in project root |

**Lower priority** (can be added later):
- Tabnine (`.tabnine/*.md`)
- Trae (`.rules`)
- JetBrains AI Assistant (UI-configured, limited file support)

### 4. Adapter interface extension

The current `Adapter` interface is minimal:

```ts
interface Adapter {
  name: string;
  outputPath: string;
  generate(constraints, context, config): string;
}
```

Extend it to support the new requirements:

```ts
interface Adapter {
  name: string;
  id: string;                        // machine name: 'claude-code', 'cursor', etc.
  displayName: string;               // human label: 'Claude Code', 'Cursor', etc.
  outputPaths: string[];             // may produce multiple files (CLAUDE.md + AGENTS.md + settings.json)
  detectInstalled(projectRoot): boolean;  // auto-detect if tool is in use
  generate(constraints, context, config): AdapterOutput[];
}

interface AdapterOutput {
  path: string;                      // relative to projectRoot
  content: string;
  description: string;               // shown in summary: "AI context file"
}
```

### 5. Shared content layer

Multiple adapters output essentially the same content in different wrappings. Factor out a shared content builder:

```
SharedContent
  ├─ projectSummary(context)         → "TypeScript + vitest + pnpm monorepo"
  ├─ criticalConstraints(constraints) → top 3-5 rules
  ├─ commandsSection(context)         → build/test/lint commands
  └─ conventionsSection(context)      → naming, imports, patterns

Adapter A: wrapAsClaudeMd(sharedContent)
Adapter B: wrapAsCursorMdc(sharedContent)
Adapter C: wrapAsCopilotMd(sharedContent)
...
```

This eliminates content duplication across adapters and ensures all tools receive consistent constraint information.

## Capabilities

### New Capabilities
- `interactive-adapter-selection`: Interactive tool selection during init, auto-detection of installed tools, selection persistence, new adapter support for 10+ tools, shared content layer.

### Modified Capabilities
- `cli-interaction-contracts` (from previous change): The init flow gains an interactive prompt step between scanning and file generation.

## Impact

- Affected code: `src/adapters/` (all files), `src/adapters/base-adapter.ts` (interface), `src/commands/init.ts` (selection prompt), `src/state/config.ts` (persist selection), `src/cli.ts` (--adapters option)
- Affected systems: Init flow, update flow, adapter registry
- APIs/UX: New interactive prompt in init, new `--adapters` CLI option, new `--no-input` behavior for adapter selection
- Phase: P2 — improves core init UX and expands tool coverage

## Risks / Trade-offs

- [Adding interactive prompts may slow down init for power users] → Mitigate with `--no-input` and `--adapters` flags for scripted usage.
- [10+ adapters increases maintenance surface] → Mitigate with shared content layer so each adapter is ~20 lines of wrapping code.
- [Auto-detection may false-positive on tool directories left from previous use] → Mitigate by treating auto-detection as pre-selection hints, not final decisions. The user always confirms.
- [Old format files (.cursorrules, .windsurfrules) may confuse tools expecting new format] → Mitigate by detecting which format is in use and matching it.
