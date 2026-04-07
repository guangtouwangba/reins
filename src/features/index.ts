/**
 * Feature queue module — public API surface.
 *
 * Internal layering:
 * - `types.ts`    — structural types (Feature, FeatureStatus, FailureContext)
 * - `parser.ts`   — read a feature file from disk (lenient, never throws on parse errors)
 * - `storage.ts`  — write feature files; partial frontmatter updates preserving body bytes
 * - `resolver.ts` — dependency resolution + cycle detection
 *
 * This file re-exports the callable surface and adds `loadAllFeatures`
 * which is the most common entry point for the ship runner.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseFeatureFile } from './parser.js';
import type { Feature } from './types.js';

export type { Feature, FeatureStatus, FailureContext } from './types.js';
export { FEATURE_STATUSES, isFeatureStatus } from './types.js';
export { parseFeatureFile } from './parser.js';
export { writeFeature, updateFeatureFrontmatter } from './storage.js';
export { pickNextFeature, hasCycle } from './resolver.js';

/**
 * Load every valid feature from `<projectRoot>/.reins/features/`. Invalid
 * files are skipped (with a warning printed by `parseFeatureFile`), not
 * propagated as errors — a broken feature file should not kill the queue.
 *
 * Non-`.md` files are ignored so dotfiles, `README.md` drafts, and tooling
 * cruft don't need to live elsewhere. Returns an empty array when the
 * directory doesn't exist yet.
 */
export function loadAllFeatures(projectRoot: string): Feature[] {
  const featuresDir = join(projectRoot, '.reins', 'features');
  if (!existsSync(featuresDir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(featuresDir);
  } catch {
    return [];
  }

  const features: Feature[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const parsed = parseFeatureFile(join(featuresDir, entry));
    if (parsed) features.push(parsed);
  }
  return features;
}
