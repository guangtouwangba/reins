## Approach

Three focused sub-modules handle the profile and merge concerns separately. `profiles.ts` is purely a read/resolve operation with no side effects. `merger.ts` implements the merge algorithm as a pure function over two constraint arrays. `conflict-detector.ts` is a single predicate function used by `merger.ts`. The init command is the only place that writes; it calls these modules and handles the interactive conflict resolution UI.

## Architecture

**Profile schema** (addition to `constraints.yaml`):

```yaml
profiles:
  strict:
    constraints: all               # "all" | ["critical"] | ["critical","important"]
    hooks: all
    pipeline: [planning, execution, review, qa]
  default:
    constraints: all
    hooks: [critical, important]
    pipeline: [planning, execution, review, qa]
  relaxed:
    constraints: [critical]
    hooks: [critical]
    pipeline: [execution]
  ci:
    constraints: all
    hooks: all
    pipeline: [execution, qa]
    output_format: json
```

**`src/constraints/profiles.ts`**

```typescript
interface Profile {
  name: string;
  constraints: 'all' | Severity[];   // which severity levels are active
  hooks: 'all' | Severity[];         // which hook severities fire
  pipeline: PipelineStage[];         // which pipeline stages run
  output_format?: 'human' | 'json';
}

interface ResolvedProfile {
  activeConstraints: Constraint[];
  activeHooks: HookConfig[];
  pipelineStages: PipelineStage[];
}

function loadProfiles(projectRoot: string): Record<string, Profile>
function resolveProfile(name: string, allConstraints: Constraint[], projectRoot: string): ResolvedProfile
```

- `loadProfiles` reads from `constraints.yaml` profiles section; merges with hardcoded built-in defaults so projects that don't define a profile still get the default behavior
- `resolveProfile` filters `allConstraints` by severity matching the profile's `constraints` field; similarly filters hooks; returns the resolved set ready for pipeline use
- If `name` is not found in profiles, falls back to `default`

**`src/constraints/conflict-detector.ts`**

```typescript
interface ConflictPair {
  existing: Constraint;    // current in constraints.yaml
  incoming: Constraint;    // from new scan
}

function detectConflicts(existing: Constraint[], incoming: Constraint[]): ConflictPair[]
```

- Conflict = same `id`, different `rule` text (after trimming whitespace)
- Does not flag severity or enforcement changes as conflicts — those are auto-merged toward the incoming value for auto-sourced constraints
- `source: 'manual'` constraints are never flagged as conflicts; they are always kept as-is

**`src/constraints/merger.ts`**

```typescript
interface MergeResult {
  kept: Constraint[];          // unchanged or manual
  added: Constraint[];         // new from scan, marked source:'auto', status:'draft'
  deprecated: Constraint[];    // in existing but not in incoming (marked deprecated, not deleted)
  conflicts: ConflictPair[];   // same id, different rule
}

function mergeConstraints(existing: Constraint[], incoming: Constraint[]): MergeResult
```

Merge rules (applied in order):
1. `existing.source === 'manual'` → always `kept`, regardless of incoming
2. `existing.id` present in incoming AND rules match → `kept`
3. `existing.id` present in incoming AND rules differ AND source !== 'manual' → `conflicts`
4. `existing.id` not present in incoming AND source !== 'manual' → `deprecated` (set `status: 'deprecated'`)
5. `incoming.id` not present in existing → `added` (set `source: 'auto'`, `status: 'draft'`)

**Init command merge flow** (`src/cli.ts` / `src/commands/init.ts`):

```
reins init (default --merge)
  → if no .reins/ exists: full init (existing behavior)
  → if .reins/ exists:
      loadExistingConstraints()
      runScanner() → incoming constraints
      mergeConstraints(existing, incoming) → MergeResult
      detectConflicts already embedded in MergeResult
      [print summary: N kept, N added as draft, N deprecated, N conflicts]
      [for each conflict: show diff, prompt keep-existing | use-new | skip]
      writeConstraintsYaml(result)
      saveSnapshot("reinit-merge")

reins init --force
  → saveSnapshot("pre-force-reinit")
  → full init (overwrite everything)

reins init --diff
  → run merge computation, print diff, exit 0 (no writes)
```

## Key Decisions

- **`source: 'manual'` is the preservation signal**: Rather than tracking which fields the user edited (fragile), the convention is that any constraint the user wants preserved should be set to `source: manual`. The merger treats this as a no-touch flag. This is the same convention already in the module spec.
- **Deprecated constraints are not deleted**: Deletion is irreversible. Marking `status: deprecated` gives the user a review window. A separate cleanup command (or manual edit) can remove them later.
- **Conflicts require explicit user resolution at merge time**: Silent auto-resolution of rule text conflicts would hide meaningful changes. The interactive prompt is intentional.
- **Built-in profiles are hardcoded defaults, not written to constraints.yaml on init**: Writing them would clutter the file and make every re-init produce a conflict if the user has customized them. They are only written if the user adds a `profiles:` section manually.

## File Structure

```
src/constraints/profiles.ts          # Profile interface, loadProfiles, resolveProfile
src/constraints/merger.ts            # MergeResult interface, mergeConstraints
src/constraints/conflict-detector.ts # ConflictPair interface, detectConflicts
src/constraints/schema.ts            # Add Profile type (modified)
src/cli.ts                           # Add --merge/--force/--diff flags, --profile passthrough (modified)
```
