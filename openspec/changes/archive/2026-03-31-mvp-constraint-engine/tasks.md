## Tasks

- [ ] **Task 1: Define constraint schema types**
  - Description: Create `src/constraints/schema.ts` with all types from the design: `Severity`, `ConstraintScope`, `ConstraintSource`, `Enforcement`, `Constraint`, `ConstraintsFile`. Include JSDoc on each field. Export all types.
  - Files: `src/constraints/schema.ts`
  - Tests: `pnpm typecheck` exits 0; import types in a test and assert a valid `Constraint` object satisfies the interface
  - Done when: All types from module ③ schema are represented; no TypeScript errors

- [ ] **Task 2: Implement classifier.ts**
  - Description: Define `CLASSIFICATION_RULES` array with RegExp patterns for critical (database/SQL/security/secret/env, build-fail/crash), important (architecture/service/repository/test, naming/convention/format), and helpful (template/example/reference/prefer). Implement `classifyConstraint(constraint)` that matches `constraint.rule` against patterns in order, returning first match severity, defaulting to `'helpful'`. Handle the override: if `constraint.enforcement.hook === true`, minimum severity is `'critical'`.
  - Files: `src/constraints/classifier.ts`
  - Tests: Unit test each severity bucket with a representative rule string; assert a constraint with `enforcement.hook = true` is never classified as `'helpful'`; assert the default fallback is `'helpful'`
  - Done when: All classification rules from module ③ implemented; at least 6 unit tests covering critical/important/helpful and the hook override

- [ ] **Task 3: Create TypeScript constraint template**
  - Description: Create `src/constraints/templates/typescript.yaml` with the constraints from module ③: `ts-strict` (important, condition: `existingRules.typeCheck !== true`), `ts-no-any` (important), `ts-return-types` (helpful). Add additional TypeScript-specific constraints: `ts-no-implicit-any` (important), `ts-prefer-const` (helpful), `ts-error-handling` (important — prefer typed error objects over `unknown` catch).
  - Files: `src/constraints/templates/typescript.yaml`
  - Tests: Parse the YAML file in a unit test; assert it loads without errors and produces an array of objects each with `id`, `rule`, `severity` fields
  - Done when: YAML is valid; all 6+ constraints present with correct severity labels

- [ ] **Task 4: Create remaining language templates**
  - Description: Create `src/constraints/templates/python.yaml` (py-type-hints important, py-no-bare-except critical, py-no-mutable-defaults important), `src/constraints/templates/go.yaml` (go-error-check critical, go-no-panic important, go-context-first helpful), `src/constraints/templates/rust.yaml` (rust-no-unwrap important, rust-error-propagation important), `src/constraints/templates/java.yaml` (java-checked-exceptions important, java-no-raw-types important).
  - Files: `src/constraints/templates/python.yaml`, `src/constraints/templates/go.yaml`, `src/constraints/templates/rust.yaml`, `src/constraints/templates/java.yaml`
  - Tests: Each YAML file parses without errors in a unit test; each has at least 2 constraints
  - Done when: All 4 files present and parseable; severity labels are one of `critical`/`important`/`helpful`

- [ ] **Task 5: Implement template loader in generator.ts**
  - Description: In `src/constraints/generator.ts`, implement `loadTemplates(languages: string[]): Constraint[]`. Reads template YAML files from `src/constraints/templates/` based on detected languages. For each template constraint, evaluate the optional `condition` field against `CodebaseContext` using a simple dot-path resolver (no eval). Filter out constraints whose condition evaluates to false. Apply `classifyConstraint()` to any constraint without explicit severity.
  - Files: `src/constraints/generator.ts`
  - Tests: Unit test `loadTemplates(['typescript'])` with a mock context where `existingRules.typeCheck = true`; assert `ts-strict` constraint is filtered out. Test with `typeCheck = false`; assert `ts-strict` is included.
  - Done when: Template loading works for all 5 languages; condition evaluation filters correctly; unknown language returns empty array gracefully

- [ ] **Task 6: Implement inferConstraints() in generator.ts**
  - Description: Implement `inferConstraints(context: CodebaseContext): Constraint[]`. Check `context.architecture.layers.includes('repository')` → add repository-layer constraint (critical). Check `context.existingRules.linter?.rules?.['no-console']` → add no-console-log constraint (important). Check `context.testing.pattern` → add test-location constraint (helpful). Check presence of Prisma in dependencies → add no-direct-sql constraint (critical). Each inferred constraint has `source: 'auto'`.
  - Files: `src/constraints/generator.ts`
  - Tests: Unit test with mock context that has `architecture.layers = ['api', 'service', 'repository']`; assert repository constraint is in output. Test with no repository layer; assert it is absent.
  - Done when: All 4 inference rules implemented; each produces a correctly-shaped `Constraint` object

- [ ] **Task 7: Implement generateConstraints() orchestrator and file output**
  - Description: Implement `generateConstraints(context: CodebaseContext, projectRoot: string): Constraint[]`. Call `loadTemplates()` and `inferConstraints()`, merge with deduplication by `id` (template wins on collision). Implement `writeConstraintsFile(projectRoot, constraints, context)` that builds the full `ConstraintsFile` with `version: 1`, `generated_at` timestamp, project name/type from context, stack info, pipeline defaults, and four profiles (strict/default/relaxed/ci). Write to `.reins/constraints.yaml`.
  - Files: `src/constraints/generator.ts`
  - Tests: Integration test running `generateConstraints()` with a TypeScript mock context; assert output array has no duplicate ids; assert `constraints.yaml` is written and parses back to valid `ConstraintsFile`
  - Done when: Full pipeline works end-to-end; written YAML is human-readable and schema-valid

- [ ] **Task 8: Export public API from src/constraints/index.ts**
  - Description: Update `src/constraints/index.ts` to export `generateConstraints`, `writeConstraintsFile`, `classifyConstraint`, and all types from `schema.ts`. This is the contract consumed by `mvp-context-layers` and `mvp-output-adapters`.
  - Files: `src/constraints/index.ts`
  - Tests: `import { generateConstraints, Constraint } from './constraints/index.js'` compiles without errors
  - Done when: All public symbols exported; `pnpm typecheck` exits 0
