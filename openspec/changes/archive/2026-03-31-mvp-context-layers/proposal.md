## Why

`constraints.yaml` is machine-readable but not directly consumable by AI coding agents. The context generator distributes constraints across the three-layer progressive context model — placing the most critical rules where agents always see them (L0 CLAUDE.md), directory-specific rules where agents enter those directories (L1 AGENTS.md), and detailed patterns where agents retrieve them on demand (L2 .reins/patterns/).

## What Changes

- Implement L0 generator: produces `CLAUDE.md` at project root from critical constraints + project overview, hard-limited to 50 lines / ~500-800 tokens
- Implement L1 generator: produces per-directory `AGENTS.md` files from important constraints scoped to that directory, hard-limited to 30 lines each
- Implement L2 generator: produces `.reins/patterns/*.md` files from helpful constraints grouped by topic, no line limit
- Implement severity-to-layer mapping: `critical → L0`, `important → L1`, `helpful → L2`
- Expose a unified `generateContext(projectRoot, constraints, context, depth)` entry point

## Capabilities

### New Capabilities

- `l0-context-generation`: `generateL0(projectRoot, context, constraints)` writes `CLAUDE.md` with project overview, tech stack one-liner, key commands, up to 5 critical constraints, project directory map, and a Reins navigation footer — all within 50 lines
- `l1-context-generation`: `generateL1(projectRoot, constraints, directories)` identifies which directories warrant an `AGENTS.md` (architecture-layer dirs and dirs with scoped constraints), then writes a focused file per directory with purpose, up to 5 important constraints, key files list, and pointer to L2 patterns
- `l2-context-generation`: `generateL2(projectRoot, constraints, context)` groups helpful constraints by inferred topic and writes one `.reins/patterns/{topic}.md` per topic with formatted constraint descriptions
- `directory-profiler`: `buildDirectoryProfiles(context, constraints)` determines which directories need L1 files and what purpose each serves, based on architecture layer names and constraint scopes

### Modified Capabilities

None — this is a new module with no predecessors to modify.

## Impact

- Writes `CLAUDE.md` at the project root — if a `CLAUDE.md` already exists, the generator appends a clearly-delimited `## Reins` section rather than overwriting the whole file
- Writes `AGENTS.md` into source directories — non-destructively (creates new, does not overwrite existing unless `--force` is passed to `reins init`)
- Creates `.reins/patterns/` directory and populates it with `.md` files — safe to overwrite on re-init
- No new external dependencies; uses only `fs` and string templating
- `mvp-reins-init` calls `generateContext()` as the third step of the init pipeline (after scan → constraints → context)
