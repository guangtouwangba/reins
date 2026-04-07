import type { Feature } from './types.js';

/**
 * Pick the next feature for ship to work on.
 *
 * Selection rules (in order):
 * 1. Only `status === 'todo'` features are candidates.
 * 2. A candidate's `depends_on` must all reference features with
 *    `status === 'done'`. Unknown dependency ids are treated as unmet.
 * 3. Among candidates, the lowest `priority` wins. Ties broken by
 *    ascending `created_at`.
 *
 * Returns `null` when no `todo` feature has all of its dependencies met.
 * This is not an error — it means ship should stop the current loop.
 *
 * This function is the fallback used when the AI planner (Phase 2) is
 * disabled or its output couldn't be validated. Until the planner ships,
 * `pickNextFeature` is the only scheduler — Phase 1 ship is fully serial.
 */
export function pickNextFeature(features: Feature[]): Feature | null {
  const todo = features.filter(f => f.status === 'todo');
  if (todo.length === 0) return null;

  const doneIds = new Set(
    features.filter(f => f.status === 'done').map(f => f.id),
  );

  const ready = todo.filter(f =>
    f.depends_on.every(dep => doneIds.has(dep)),
  );
  if (ready.length === 0) return null;

  ready.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.created_at.localeCompare(b.created_at);
  });

  return ready[0] ?? null;
}

/**
 * Detect dependency cycles across the feature queue.
 *
 * Uses three-color DFS (WHITE = unvisited, GRAY = in current traversal
 * stack, BLACK = finished). A back edge to a GRAY node proves a cycle.
 *
 * Cycles include both direct (A → B → A) and transitive (A → B → C → A)
 * cases. Self-loops (A → A) also count.
 *
 * Unknown `depends_on` ids are skipped — they can't form a cycle because
 * they have no outgoing edges to follow. The caller should validate
 * unknown ids separately if that matters.
 */
export function hasCycle(features: Feature[]): boolean {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;

  const color = new Map<string, number>();
  const byId = new Map<string, Feature>();
  for (const f of features) {
    color.set(f.id, WHITE);
    byId.set(f.id, f);
  }

  function dfs(id: string): boolean {
    const c = color.get(id) ?? WHITE;
    if (c === GRAY) return true;
    if (c === BLACK) return false;

    color.set(id, GRAY);
    const feature = byId.get(id);
    if (feature) {
      for (const dep of feature.depends_on) {
        if (!byId.has(dep)) continue;
        if (dfs(dep)) return true;
      }
    }
    color.set(id, BLACK);
    return false;
  }

  for (const f of features) {
    if ((color.get(f.id) ?? WHITE) === WHITE) {
      if (dfs(f.id)) return true;
    }
  }
  return false;
}
