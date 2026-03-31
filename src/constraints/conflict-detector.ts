import type { Constraint } from './schema.js';

export interface ConflictPair {
  existing: Constraint;
  incoming: Constraint;
}

export function detectConflicts(existing: Constraint[], incoming: Constraint[]): ConflictPair[] {
  const incomingMap = new Map<string, Constraint>(incoming.map(c => [c.id, c]));
  const conflicts: ConflictPair[] = [];

  for (const existingConstraint of existing) {
    // Manual constraints are never flagged as conflicts
    if (existingConstraint.source === 'manual') continue;

    const incomingConstraint = incomingMap.get(existingConstraint.id);
    if (!incomingConstraint) continue;

    // Conflict = same id, different rule text (after trimming)
    if (existingConstraint.rule.trim() !== incomingConstraint.rule.trim()) {
      conflicts.push({ existing: existingConstraint, incoming: incomingConstraint });
    }
  }

  return conflicts;
}
