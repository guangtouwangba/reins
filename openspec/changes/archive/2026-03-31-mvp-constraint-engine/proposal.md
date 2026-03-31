## Why

A `CodebaseContext` alone is not actionable. The constraint engine transforms scanner output into structured, severity-classified rules that AI coding agents can consume — bridging raw project understanding and enforceable behavioral guidelines.

## What Changes

- Define the `Constraint` interface and `constraints.yaml` schema
- Implement constraint generation from tech-stack templates (TypeScript, Python, Go, Rust, Java) and project-specific inference from `CodebaseContext`
- Implement severity classification: `critical` / `important` / `helpful`
- Write `src/constraints/generator.ts`, `src/constraints/classifier.ts`, `src/constraints/schema.ts`
- Create tech-stack template YAML files under `src/constraints/templates/`
- Output `constraints.yaml` to `.reins/constraints.yaml`

## Capabilities

### New Capabilities

- `constraint-generation`: `generateConstraints(context: CodebaseContext): Constraint[]` combines tech-stack template constraints with project-inferred constraints derived from architecture layers, existing lint rules, and test patterns
- `constraint-classification`: `classifyConstraint(constraint: Constraint): Severity` assigns `critical`, `important`, or `helpful` severity using pattern-matching rules from module ③
- `constraints-yaml-output`: Writes the canonical `.reins/constraints.yaml` with full schema including `version`, `generated_at`, `project`, `stack`, `constraints[]`, `pipeline`, and `profiles` sections
- `stack-templates`: Pre-built constraint sets for TypeScript, Python, Go, Rust, and Java — loaded and merged based on detected primary language
- `project-inference`: Derives project-specific constraints from `CodebaseContext` fields: repository layer → "use repository layer" rule; ESLint `no-console` → "use project logger" rule; test pattern → "test location" rule

### Modified Capabilities

- `scan-entry` (from mvp-scanner-core): `scan()` output (`CodebaseContext`) is now the required input to `generateConstraints()` — the two modules form a pipeline

## Impact

- `mvp-context-layers` consumes `Constraint[]` from this module, filtered by severity, to generate CLAUDE.md / AGENTS.md / patterns files
- `mvp-output-adapters` also consumes `Constraint[]` to generate tool-specific output files
- `.reins/constraints.yaml` is a team-shared file (committed to git); its schema is the stable API surface between this module and all consumers
- Adds no new external runtime dependencies beyond `js-yaml` (already present from scaffold)
- `src/constraints/templates/*.yaml` files are bundled with the distributed package and read at runtime
