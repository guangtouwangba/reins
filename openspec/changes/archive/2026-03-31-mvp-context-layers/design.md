## Approach

Three independent generator functions — one per layer — each taking `Constraint[]` filtered to the relevant severity. A directory profiler infers which directories need L1 files. String templates are inline TypeScript template literals (no template engine dependency). All generators enforce their line-count hard limits by truncating constraint lists before rendering.

## Architecture

**`src/context/index.ts`** — unified entry point:
```
generateContext(projectRoot, constraints, context, depth)
  → generateL0(projectRoot, context, constraints)               always
  → if depth includes L1: generateL1(projectRoot, constraints, buildDirectoryProfiles(context, constraints))
  → if depth includes L2: generateL2(projectRoot, constraints, context)
```

**`src/context/l0-generator.ts`**:

`generateL0(projectRoot, context, constraints): void`
- Filters `constraints` to `severity === 'critical'`, takes first 5
- Builds output from template sections in order:
  1. `# {projectName}` (1 line)
  2. Stack one-liner: `{framework} + {language} + {packageManager}` (1 line)
  3. `## Commands` block: dev/test/lint/typecheck commands inferred from `context.stack` (5 lines)
  4. `## Critical Rules` block: up to 5 bullet points (6 lines max)
  5. `## Project Map` block: top-level directory tree from `context.structure` (10 lines max)
  6. `## Reins` footer: navigation pointers to `.reins/` (6 lines)
- Hard cap: if total exceeds 50 lines, truncate `## Project Map` first, then truncate critical rules to 3
- Handles existing `CLAUDE.md`: if file exists and does not contain `<!-- reins-managed -->` marker, appends the generated content under a `## Reins` section with the marker. If marker exists, replaces content between markers.

**`src/context/l1-generator.ts`**:

`buildDirectoryProfiles(context, constraints): DirectoryProfile[]`
- Takes `context.architecture.layers` and `context.structure` to find architecture-layer directories (`app/`, `lib/`, `src/`, `components/`, `services/`, `api/`, `repositories/`)
- Also includes any directory referenced in a constraint's `scope` field (`directory:{path}`)
- For each candidate dir: assigns `purpose` from a lookup of known layer names + fallback to directory name
- Returns `DirectoryProfile[]` with `path`, `purpose`, `constraints`, `keyFiles`, `patternRef`

`generateL1(projectRoot, constraints, directories): void`
- For each `DirectoryProfile`, filters `constraints` to `severity === 'important'` AND (`scope === 'global'` OR `scope === \`directory:${dir.path}\``)
- Takes first 5 matching constraints
- Renders the template from module ④ spec: purpose header, rules section, key files section, patterns pointer
- Hard cap: 30 lines per file. If exceeded, drop key files section first, then truncate rules to 3.
- Creates the directory if it doesn't exist; skips writing if the directory does not exist in the project

**`src/context/l2-generator.ts`**:

`groupConstraintsByTopic(constraints): Map<string, Constraint[]>`
- Groups helpful constraints by inferred topic using keyword matching on `constraint.rule`:
  - "API" / "route" / "endpoint" → `api-patterns`
  - "test" / "coverage" / "fixture" → `testing-patterns`
  - "error" / "exception" / "throw" → `error-handling`
  - "import" / "module" / "dependency" → `module-patterns`
  - Fallback: `general-patterns`

`generateL2(projectRoot, constraints, context): void`
- Filters to `severity === 'helpful'`
- Groups by topic
- Writes one `.reins/patterns/{topic}.md` per group
- No line limit — these files are never preloaded
- Creates `.reins/patterns/` directory if absent

## Key Decisions

- **Inline template literals over a template engine**: Handlebars/Mustache adds a dependency and indirection for what are small, fixed-structure templates; TypeScript template literals are type-safe and readable
- **50-line / 30-line hard caps enforced in code, not by convention**: The generators truncate output to stay within budget. This prevents context drift as constraint lists grow.
- **Marker-based CLAUDE.md injection**: Using `<!-- reins-managed -->` and `<!-- /reins-managed -->` allows reins to update its section without destroying user-authored content above or below
- **L2 is topic-grouped, not one-file-per-constraint**: A single file per topic is more discoverable via grep than dozens of tiny files; agents searching for "api patterns" get a complete picture in one read
- **`buildDirectoryProfiles` is separate from `generateL1`**: The profiler logic can be tested independently and reused by the `reins update` command (Phase 3) to determine which AGENTS.md files need refreshing

## File Structure

```
src/context/
├── index.ts              # generateContext() unified entry point
├── l0-generator.ts       # CLAUDE.md generation (critical constraints)
├── l1-generator.ts       # directory AGENTS.md generation (important constraints)
└── l2-generator.ts       # .reins/patterns/*.md generation (helpful constraints)
```
