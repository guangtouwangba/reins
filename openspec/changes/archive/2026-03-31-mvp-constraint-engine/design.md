## Approach

Generate constraints in two passes: first load applicable tech-stack templates, then run project-specific inference against `CodebaseContext`. Merge the two sets, classify each constraint's severity, and serialize to `constraints.yaml`. The classifier is a pure function with no side effects, making it independently testable. Templates are YAML files shipped with the package and read at runtime via `fs.readFileSync` relative to the module's `__dirname`.

## Architecture

**`src/constraints/schema.ts`** — TypeScript types:
- `Severity = 'critical' | 'important' | 'helpful'`
- `ConstraintScope = 'global' | \`directory:${string}\``
- `ConstraintSource = 'auto' | 'manual' | 'learned'`
- `Enforcement = { soft: boolean; hook: boolean; hook_type?: string; hook_mode?: string; hook_check?: string }`
- `Constraint = { id: string; rule: string; severity: Severity; scope: ConstraintScope; source: ConstraintSource; enforcement: Enforcement; status?: 'draft' | 'active' | 'deprecated' }`
- `ConstraintsFile = { version: number; generated_at: string; project: {...}; stack: {...}; constraints: Constraint[]; pipeline: {...}; profiles: {...} }`

**`src/constraints/classifier.ts`** — severity classification:
- `CLASSIFICATION_RULES: Array<{ pattern: RegExp; severity: Severity }>` covering the patterns from module ③
- `classifyConstraint(constraint: Omit<Constraint, 'severity'>): Severity` — applies rules in order, returns first match, defaults to `'helpful'`
- Classification rules:
  - `critical`: database/SQL/security/secret/env patterns; build-fail/crash patterns
  - `important`: architecture/layering/service/repository/test patterns; naming/convention/format patterns
  - `helpful`: template/example/reference/prefer patterns

**`src/constraints/generator.ts`** — constraint generation:

```
generateConstraints(context: CodebaseContext): Constraint[]
  1. loadTemplates(context.stack.language)
     → reads src/constraints/templates/{typescript,python,go,rust,java}.yaml
     → filters by condition (e.g. "tsconfig.strict !== true")
  2. inferConstraints(context)
     → checks architecture.layers, existingRules, testing.pattern
     → returns project-specific Constraint[]
  3. merge: deduplicate by id, template constraints first, inferred second
  4. classifyConstraint() on any constraint missing severity
  5. return Constraint[]
```

**`src/constraints/templates/*.yaml`** — one file per language stack. Each contains a `constraints:` array with `id`, `rule`, `severity`, and optional `condition` field. The condition is a simple dot-path expression evaluated against `CodebaseContext` (e.g. `"existingRules.typeCheck !== true"`). Condition evaluation uses a minimal interpreter — no `eval`, just path lookup + comparison.

**Output serialization**: `writeConstraintsFile(projectRoot, constraints, context)` builds the full `ConstraintsFile` object and writes it to `.reins/constraints.yaml` using `js-yaml`.

**Pipeline and profiles sections**: populated with defaults from the spec — `pipeline` references standard commands from `context.stack.packageManager`; `profiles` are the four standard profiles (strict/default/relaxed/ci).

## Key Decisions

- **Template conditions as dot-path strings, not code**: Prevents eval injection; keeps templates as pure data; all conditions in the MVP templates are simple equality/inequality checks on `CodebaseContext` fields
- **Classifier as pure function separate from generator**: Lets the classifier be tested in isolation and reused by the merger (Phase 2) without pulling in the full generator
- **Template files in `src/constraints/templates/`, bundled with build**: Avoids network fetches; works offline; version-controlled alongside the code that uses them
- **Deduplication by constraint id**: Template id wins over inferred id on collision — templates are the canonical source for standard rules; project inference adds project-specific additions
- **No merging logic at MVP**: MVP only runs fresh generation; the `merger.ts` module (Phase 2) handles re-init merge. On re-init at MVP, existing `constraints.yaml` is overwritten with a warning

## File Structure

```
src/constraints/
├── schema.ts                 # Constraint, ConstraintsFile, Severity types
├── classifier.ts             # classifyConstraint() pure function
├── generator.ts              # generateConstraints() orchestrator
└── templates/
    ├── typescript.yaml       # TypeScript-specific constraint templates
    ├── python.yaml           # Python-specific constraint templates
    ├── go.yaml               # Go-specific constraint templates
    ├── rust.yaml             # Rust-specific constraint templates
    └── java.yaml             # Java-specific constraint templates
```
