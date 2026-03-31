## Why

Knowledge entries that have been repeatedly validated carry the same weight as brand-new unverified entries — there is no path for proven implicit knowledge to "graduate" into the formal constraint system where it gets enforced, versioned, and team-shared. Without a promotion mechanism, high-value patterns stay locked in the knowledge store and never gain the enforcement power of constraints.

## What Changes

- Enhance `src/knowledge/promoter.ts`: implement `checkPromotion()` with the three promotion conditions (confidence >= 90, injection_outcomes.success >= 5, success_rate >= 80%) and route by type: preference/coupling → constraint, gotcha → skill, decision → L1 AGENTS.md addition
- Add `PromotionCandidate` interface to `promoter.ts`: `{ knowledge: KnowledgeEntry, targetType: 'constraint' | 'skill' | 'l1_addition', reason: string }`
- Implement reverse demotion detection: track constraints that are repeatedly bypassed; when bypass count > 5 and post-bypass success rate > 90%, surface a downgrade suggestion
- Add `src/lifecycle/consistency.ts`: session-end consistency check — identify which files were modified this session, find associated knowledge entries, lower their confidence and mark `needs_review`
- Extend knowledge injection to annotate source session and creation timestamp so agents can judge staleness themselves
- Add freshness check at injection time: if `related_files` were modified after the knowledge entry was created, prepend a staleness warning to the injected text
- Honor `promotion.auto_suggest` config flag: when true, emit a user-facing prompt when any knowledge entry first meets all promotion conditions

## Capabilities

### New Capabilities

- `knowledge-promotion`: Automatically evaluate every knowledge entry against promotion thresholds after each session and surface candidates to the user with typed promotion targets (constraint, skill, or L1 AGENTS.md)
- `reverse-demotion-detection`: Monitor constraint bypass events; suggest downgrading a constraint to a preference/recommendation when bypass evidence exceeds the threshold
- `session-consistency-check`: At session end, scan modified files, find associated knowledge entries, and mark stale entries with `needs_review` and reduced confidence
- `injection-freshness-warning`: At injection time, compare knowledge creation date against related file modification dates and prepend a visible staleness warning when files have changed significantly

### Modified Capabilities

- `knowledge/promoter.ts`: Was a stub; now fully implements `checkPromotion()`, `PromotionCandidate` routing, and demotion suggestion logic
- `knowledge injector`: Extended to annotate each injected entry with its source task and age, and to prepend freshness warnings when related files have been modified

## Impact

- Depends on `p4-knowledge-lifecycle` for the `KnowledgeEntry` type, `index.yaml` format, and injection pipeline
- Depends on `p3-constraint-profiles` for the constraint schema that graduated knowledge entries will be written into
- Graduation to constraint calls `src/constraints/` write path — promoted knowledge entries become new rules in `constraints.yaml`, triggering the same recompile flow used by `p5-self-improving`'s constraint updater
- Graduation to L1 AGENTS.md appends a new section to the target directory's `AGENTS.md`; this is a file write that should be committed and reviewed
- The `promotion.auto_suggest` config flag is additive; default is `true` so teams get suggestions out of the box without configuration
- Consistency check adds light work to the `SessionEnd` hook; total overhead is a directory scan + index.yaml read, expected under 100ms
