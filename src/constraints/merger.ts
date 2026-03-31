import type { Constraint } from './schema.js';
import { detectConflicts, type ConflictPair } from './conflict-detector.js';

export interface MergeResult {
  kept: Constraint[];
  added: Constraint[];
  deprecated: Constraint[];
  conflicts: ConflictPair[];
}

export function mergeConstraints(existing: Constraint[], incoming: Constraint[]): MergeResult {
  const incomingMap = new Map<string, Constraint>(incoming.map(c => [c.id, c]));
  const existingMap = new Map<string, Constraint>(existing.map(c => [c.id, c]));
  const conflicts = detectConflicts(existing, incoming);
  const conflictIds = new Set(conflicts.map(cp => cp.existing.id));

  const kept: Constraint[] = [];
  const deprecated: Constraint[] = [];

  for (const existingConstraint of existing) {
    // Rule 1: manual source → always kept
    if (existingConstraint.source === 'manual') {
      kept.push(existingConstraint);
      continue;
    }

    const incomingConstraint = incomingMap.get(existingConstraint.id);

    // Rule 3: conflict → goes to conflicts array (not kept or deprecated)
    if (conflictIds.has(existingConstraint.id)) {
      continue;
    }

    if (incomingConstraint) {
      // Rule 2: same id, rules match → kept
      kept.push(existingConstraint);
    } else {
      // Rule 4: not in incoming, not manual → deprecated
      deprecated.push({ ...existingConstraint, status: 'deprecated' });
    }
  }

  // Rule 5: incoming id not present in existing → added
  const added: Constraint[] = [];
  for (const incomingConstraint of incoming) {
    if (!existingMap.has(incomingConstraint.id)) {
      added.push({ ...incomingConstraint, source: 'auto', status: 'draft' });
    }
  }

  return { kept, added, deprecated, conflicts };
}
