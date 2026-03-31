## Why

Skills and constraints learned in one project are discarded when starting the next — every new project begins from zero even when the technology stack is identical. Simultaneously, the scanner still operates only at L0-L2 (file names, config files, directory structure), missing the richer understanding that AST analysis, git history, and LLM code reading can provide for more precise constraint generation.

## What Changes

- Add `src/scanner/ast-analyzer.ts`: L3 scanner — samples 5-10 core source files, parses ASTs to extract import patterns, error-handling style, type annotation density, and recurring idioms
- Add `src/scanner/git-analyzer.ts`: L4 scanner — analyzes git log for the last 30 days to identify hot directories, churn rate per file, and contributor patterns
- Add `src/scanner/llm-analyzer.ts`: L5 scanner — sends sampled file content to an LLM to extract business logic patterns, design intent, and module responsibilities that structural analysis cannot surface
- Add `src/learn/cross-project.ts`: cross-project learning engine — detects when a skill has no project-specific path dependencies, abstracts it, and saves it to `~/.dev-harness/global-skills/` organized by tech stack; on new project init, matches global skills to the detected stack and injects as draft skills (quality: 50)
- Add project fingerprinting: write `~/.dev-harness/project-profiles/<project>.json` on every `reins init` capturing stack, framework, architecture pattern, and key conventions
- Add monorepo support: detect `packages/` or `apps/` directories and generate per-package constraint files alongside the root constraints
- Add constraint version migration: when `constraints.yaml` schema version increments, run a migration function to upgrade the file in-place with a changelog entry
- Add community template support (remote, read-only): on `reins init`, offer to fetch "TypeScript + Next.js Top 20 constraints" and similar stack-matched templates as a starting point

## Capabilities

### New Capabilities

- `scanner-l3-ast`: Sample and parse source file ASTs to detect import patterns, error-handling conventions, and coding idioms for more precise constraint generation
- `scanner-l4-git`: Analyze recent git history to identify high-churn files, active directories, and contributor patterns; surface these as context for constraint prioritization
- `scanner-l5-llm`: Send sampled source files to an LLM for business-logic-level understanding — extracts module responsibilities and design intent beyond what static analysis can see
- `cross-project-learning`: Detect project-agnostic skills, abstract away path dependencies, persist to `~/.dev-harness/global-skills/<stack>/`, and inject matching skills as drafts when initializing new projects
- `project-fingerprinting`: Write and maintain `~/.dev-harness/project-profiles/<project>.json` capturing stack signature for cross-project skill matching
- `monorepo-constraint-support`: Detect monorepo structure and generate per-package `constraints.yaml` files in addition to the root-level file
- `constraint-version-migration`: Automated in-place migration of `constraints.yaml` when the schema version changes, with changelog entry
- `community-constraint-templates`: Fetch and apply remote stack-matched constraint templates during `reins init` as an opt-in starting point

### Modified Capabilities

- `scanner/index.ts`: `scan(projectRoot, depth)` now accepts depth levels L3, L4, L5 and dispatches to the new analyzer sub-modules; L0-L2 behavior is unchanged
- `reins init`: Extended to run project fingerprinting, match global skills, and offer community templates

## Impact

- Depends on `p5-self-improving` for the skill lifecycle and quality scoring infrastructure that cross-project learning builds on
- L3 AST scanning requires a TypeScript/JavaScript parser (e.g. `@typescript-eslint/parser` or `acorn`) as a new dependency; other languages need their own parsers
- L5 LLM scanning costs tokens per init; disabled by default, enabled via `scan.depth: l5` in config
- Cross-project global skills are stored in `~/.dev-harness/` which is outside the project repo — no git impact on the project side
- Monorepo support changes the output of `reins init` for monorepos: multiple `constraints.yaml` files are written; existing single-package projects are unaffected
- Community templates require network access during `reins init`; gracefully skipped if offline
- Constraint version migration is destructive (rewrites `constraints.yaml`); always creates a backup before migrating
