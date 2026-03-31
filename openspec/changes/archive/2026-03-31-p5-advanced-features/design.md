## Approach

Split the advanced scanner work (L3-L5) and the cross-project learning work into four independent sub-modules that extend the existing scanner and learn directories. Scanner depth is gated behind config (`scan.depth`), so L3-L5 are opt-in additions that do not change default L0-L2 behavior. Cross-project learning runs as a post-session background step: skill abstraction and global persistence happen after the session closes, and global skill injection happens during `reins init`. Monorepo support is handled at the scanner level, shaping the output constraint structure. Community templates are fetched once at init time and treated as a read-only starting point.

## Architecture

**L3 AST analyzer** (`scanner/ast-analyzer.ts`):
- Exports `analyzeAST(projectRoot: string, sampleSize: number): ASTAnalysis`
- Selects 5-10 representative source files: entry points + most-imported files (by import frequency in L0 scan)
- Parses each file using `@typescript-eslint/parser` for TS/JS, `ast-grep` for other languages
- Extracts:
  - `importPatterns`: relative vs absolute vs alias ratio, most-used import sources
  - `errorHandlingStyle`: try/catch ratio vs Result type ratio vs callback-error ratio
  - `typeAnnotationDensity`: annotated return types / total functions
  - `recurringIdioms`: top 10 most-repeated 3-node AST subtrees (function call patterns, destructuring patterns)
- Returns `ASTAnalysis` merged into `CodebaseContext.conventions`

**L4 git analyzer** (`scanner/git-analyzer.ts`):
- Exports `analyzeGitHistory(projectRoot: string, days: number): GitAnalysis`
- Runs `git log --since=<N>d --name-only --pretty=format:` to get changed files
- Computes per-directory churn: count of commits touching files under each directory
- Identifies `hotDirectories[]` (top 5 by commit count) and `highChurnFiles[]` (top 10 by change frequency)
- Returns `GitAnalysis { hotDirectories, highChurnFiles, activeContributors, totalCommits }`
- Used by constraint generator to prioritize rules for hot directories

**L5 LLM analyzer** (`scanner/llm-analyzer.ts`):
- Exports `analyzeLLM(sampleFiles: string[]): LLMAnalysis`
- Sends sampled file content (max 4 files, max 500 lines each) to the configured LLM with a structured prompt
- Prompt asks: module responsibilities, key design patterns, implicit conventions, areas of complexity
- Returns `LLMAnalysis { moduleDescriptions, designPatterns, implicitConventions, complexityHotspots }`
- Gated behind `scan.depth: 'l5'` in config; disabled by default
- Uses the cheapest configured model (default: haiku) to control cost

**Cross-project learning** (`learn/cross-project.ts`):
- Exports `extractGlobalSkills(projectRoot: string, skills: SkillEntry[]): void`
- For each skill with quality >= 95 and `scope: 'project'`:
  - Check for project-specific path references: scan skill content for strings matching `projectRoot` or known project-specific directory names
  - If no path dependencies found: abstract the skill (strip any remaining project references), tag with `stack[]` from the project fingerprint
  - Write to `~/.dev-harness/global-skills/<primaryStack>/<skill-name>.yaml`
  - Append to `~/.dev-harness/transfer-log.json`
- Exports `injectGlobalSkills(projectRoot: string, stack: StackInfo): SkillEntry[]`
- Called during `reins init`: reads `~/.dev-harness/global-skills/`, filters by stack match, copies matching skills to `.reins/skills/` with `quality: 50` and `source: 'global'`

**Project fingerprinting** (in `learn/cross-project.ts`):
- `writeFingerprint(projectRoot: string, context: CodebaseContext): void`
- Writes `~/.dev-harness/project-profiles/<projectName>.json` with: stack, framework, architecture, conventions, created, lastUpdated
- Called at end of `reins init` and `reins update`

**Monorepo support** (`scanner/index.ts` + `src/constraints/`):
- `scan()` detects monorepo when `packages/` or `apps/` directories exist
- For each package directory: run the same L0-L2 scan, merge with root context, write per-package `<package>/.reins/constraints.yaml`
- Root `constraints.yaml` contains only global rules; package constraints inherit root + add package-specific rules
- Inheritance expressed as `extends: ../../.reins/constraints.yaml` in package constraint files

**Constraint version migration** (`src/constraints/migrator.ts`):
- `migrate(projectRoot: string): void`
- Reads `constraints.yaml` schema version field; compares to current supported version
- For each version gap, runs the corresponding migration function (e.g. `v1→v2`, `v2→v3`)
- Before any migration: writes backup to `.reins/backups/constraints-<version>-<timestamp>.yaml`
- After migration: appends changelog entry, updates version field
- Migration functions are registered in a `MIGRATIONS` map keyed by `"v1→v2"` etc.

**Community templates** (`src/scanner/index.ts` during init):
- `fetchCommunityTemplates(stack: StackInfo): ConstraintTemplate[]`
- Makes a GET request to a configured endpoint (default: `https://templates.reins.dev/v1/match`)
- Sends stack signature; receives ranked list of template names + download URLs
- Downloads selected template, validates schema, writes to `.reins/constraints.yaml` as starting point
- Skipped silently if network unavailable or `init.community_templates: false` in config

**Scanner depth dispatch** (`scanner/index.ts`):
- `scan(projectRoot: string, depth: 'l2' | 'l3' | 'l4' | 'l5'): CodebaseContext`
- Default depth: `'l2'` (existing behavior unchanged)
- `l3`: also runs `ast-analyzer.ts`
- `l4`: also runs `git-analyzer.ts`
- `l5`: also runs `llm-analyzer.ts`
- Each higher level includes all lower levels

## Key Decisions

- **`@typescript-eslint/parser` for L3 AST**: Already a likely dev dependency in TypeScript projects; avoids bundling a second parser. For non-TS projects, L3 falls back to regex-based idiom detection (lower fidelity but no new dep).
- **L5 uses haiku by default**: LLM scanning at init time should cost under $0.01. Haiku's context window is sufficient for 4 files × 500 lines. The model is configurable if teams need deeper analysis.
- **Global skills stored in `~/.dev-harness/`, not a cloud service**: Cross-project learning in Phase 5 is local-first. Cloud sharing is a future concern (community templates cover the multi-team case at a coarser granularity).
- **Quality threshold of 95 for global extraction**: Only battle-tested skills get promoted globally. A skill at 95 has passed through Verified (90) and accumulated further successes. Lower-quality skills stay project-local.
- **Monorepo per-package constraints via `extends`**: A flat merge would make it impossible to see which rules are global vs package-specific. The `extends` reference makes the inheritance explicit and lets tools validate the chain.
- **Constraint migration as a separate `migrator.ts`**: Migration logic is versioned and append-only. Keeping it out of the main constraint loader avoids bloating the read path with upgrade concerns.
- **Community templates are read-only starting points**: Fetched templates are written to `constraints.yaml` before any project-specific tuning. Teams own their constraint file from the moment init completes; there is no "sync back to template" mechanism.

## File Structure

```
src/scanner/
├── index.ts                        # extended: depth dispatch, monorepo detection
├── ast-analyzer.ts                 # new: L3 AST sampling and idiom extraction
├── git-analyzer.ts                 # new: L4 git history churn analysis
└── llm-analyzer.ts                 # new: L5 LLM code understanding

src/learn/
└── cross-project.ts                # new: global skill extraction, fingerprinting, injection

src/constraints/
└── migrator.ts                     # new: schema version migration with backup

~/.dev-harness/
├── global-skills/
│   ├── typescript/
│   ├── python/
│   └── ...
├── project-profiles/
│   └── <project-name>.json
└── transfer-log.json

.reins/
├── backups/
│   └── constraints-v1-<timestamp>.yaml   # pre-migration backups
└── config.yaml                           # extended: scan.depth, init.community_templates
```
