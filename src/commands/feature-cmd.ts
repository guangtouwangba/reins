import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadAllFeatures,
  parseFeatureFile,
  writeFeature,
  updateFeatureFrontmatter,
  pickNextFeature,
  isFeatureStatus,
  FEATURE_STATUSES,
} from '../features/index.js';
import type { Feature, FeatureStatus } from '../features/index.js';

/**
 * `reins feature` CLI entry — pure structured operations on the feature
 * queue, no LLM calls. Mirrors the surface documented in the OpenSpec
 * proposal under `2026-04-07-feature-ship` tasks.md §2.
 *
 * The ship runner uses these same primitives (via the `src/features/`
 * module) but never shells out through this file — the CLI exists for the
 * user, not the runner.
 */
export async function runFeature(action: string | undefined, args: string[]): Promise<void> {
  const projectRoot = process.cwd();

  switch (action) {
    case 'list':
      return runFeatureList(projectRoot);
    case 'show': {
      const id = args[0];
      if (!id) {
        console.error('Usage: reins feature show <id>');
        process.exitCode = 1;
        return;
      }
      return runFeatureShow(projectRoot, id);
    }
    case 'new': {
      const id = args[0];
      if (!id) {
        console.error('Usage: reins feature new <id> [--title "…"] [--force]');
        process.exitCode = 1;
        return;
      }
      const { title, force } = parseNewFlags(args.slice(1));
      return runFeatureNew(projectRoot, id, { title, force });
    }
    case 'status': {
      const id = args[0];
      if (!id) {
        console.error('Usage: reins feature status <id> [--json]');
        process.exitCode = 1;
        return;
      }
      const jsonMode = args.includes('--json');
      return runFeatureStatus(projectRoot, id, jsonMode);
    }
    case 'set-status': {
      const id = args[0];
      const newStatus = args[1];
      if (!id || !newStatus) {
        console.error('Usage: reins feature set-status <id> <status>');
        process.exitCode = 1;
        return;
      }
      return runFeatureSetStatus(projectRoot, id, newStatus);
    }
    case 'next':
      return runFeatureNext(projectRoot);
    default:
      if (action) {
        console.error(`Unknown action: ${action}`);
        console.error('');
      }
      console.error('Usage: reins feature <list|show|new|status|set-status|next> [args...]');
      if (action) process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export function runFeatureList(projectRoot: string): void {
  const features = loadAllFeatures(projectRoot);
  if (features.length === 0) {
    console.log('No features in queue.');
    console.log('');
    console.log('Add one with: reins feature new <id>');
    return;
  }

  // Sort: draft/todo/in-progress/blocked first, done/verified last, by priority then created_at
  const sorted = [...features].sort((a, b) => {
    const activeOrder = statusSortKey(a.status) - statusSortKey(b.status);
    if (activeOrder !== 0) return activeOrder;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.created_at.localeCompare(b.created_at);
  });

  const idWidth = Math.max(2, ...sorted.map(f => f.id.length));
  const titleWidth = Math.min(40, Math.max(5, ...sorted.map(f => f.title.length)));

  console.log(`${'ID'.padEnd(idWidth)}  ${'TITLE'.padEnd(titleWidth)}  STATUS        PRI  DEPS`);
  console.log('-'.repeat(idWidth + titleWidth + 30));

  for (const f of sorted) {
    const title = truncate(f.title, titleWidth);
    const deps = f.depends_on.length === 0 ? '-' : f.depends_on.join(',');
    console.log(
      `${f.id.padEnd(idWidth)}  ${title.padEnd(titleWidth)}  ${f.status.padEnd(13)} ${String(f.priority).padStart(3)}  ${deps}`,
    );
  }
}

function statusSortKey(status: FeatureStatus): number {
  switch (status) {
    case 'in-progress': return 0;
    case 'todo': return 1;
    case 'blocked': return 2;
    case 'draft': return 3;
    case 'implemented': return 4;
    case 'verified': return 5;
    case 'done': return 6;
    default: return 7;
  }
}

function truncate(s: string, n: number): string {
  // Use ASCII '...' (3 chars) so non-UTF-8 terminals don't print garbage.
  return s.length <= n ? s : s.slice(0, n - 3) + '...';
}

// ---------------------------------------------------------------------------
// show
// ---------------------------------------------------------------------------

export function runFeatureShow(projectRoot: string, id: string): void {
  const path = featurePath(projectRoot, id);
  if (!existsSync(path)) {
    console.error(`Feature not found: ${id}`);
    console.error(`Expected at: ${path}`);
    process.exitCode = 1;
    return;
  }

  const feature = parseFeatureFile(path);
  if (!feature) {
    console.error(`Feature file could not be parsed: ${path}`);
    process.exitCode = 1;
    return;
  }

  console.log(`ID:          ${feature.id}`);
  console.log(`Title:       ${feature.title}`);
  console.log(`Status:      ${feature.status}`);
  console.log(`Priority:    ${feature.priority}`);
  console.log(`Depends on:  ${feature.depends_on.length > 0 ? feature.depends_on.join(', ') : '(none)'}`);
  if (feature.max_attempts !== undefined) console.log(`Max attempts: ${feature.max_attempts}`);
  if (feature.scope && feature.scope.length > 0) {
    console.log(`Scope:       ${feature.scope.join(', ')}`);
  }
  console.log(`Created:     ${feature.created_at}`);
  console.log(`Updated:     ${feature.updated_at}`);
  if (feature.last_run_id) console.log(`Last run:    ${feature.last_run_id}`);
  if (feature.last_failure) {
    console.log('');
    console.log('Last failure:');
    console.log(`  Stage:     ${feature.last_failure.stage}`);
    console.log(`  Command:   ${feature.last_failure.command}`);
    console.log(`  Exit code: ${feature.last_failure.exit_code}`);
  }
  console.log('');
  console.log('--- Body ---');
  console.log(feature.body.trim());
}

// ---------------------------------------------------------------------------
// new
// ---------------------------------------------------------------------------

interface NewFlags {
  title?: string;
  force: boolean;
}

function parseNewFlags(args: string[]): NewFlags {
  let title: string | undefined;
  let force = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--force') {
      force = true;
    } else if (a === '--title') {
      const next = args[i + 1];
      if (next) {
        title = next;
        i++;
      }
    } else if (a && a.startsWith('--title=')) {
      title = a.slice('--title='.length);
    }
  }
  return { title, force };
}

/**
 * Allowed feature-id characters: ASCII alphanumerics + `.`, `_`, `-`,
 * must start with an alphanumeric, max 64 chars. This prevents two
 * real security issues:
 * 1. Path traversal — `..` in an id would escape `.reins/features/`
 * 2. Git flag injection — an id starting with `-` would be parsed by
 *    `git worktree add` as a flag, not a branch name
 * ...plus a general sanity floor (no spaces, no slashes, no newlines).
 */
const VALID_FEATURE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function validateFeatureId(id: string): string | null {
  if (id.includes('..')) return 'cannot contain ".."';
  if (!VALID_FEATURE_ID.test(id)) {
    return 'must match /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/ (letters, digits, ".", "_", "-"; starts with alphanumeric; max 64 chars)';
  }
  return null;
}

export function runFeatureNew(
  projectRoot: string,
  id: string,
  opts: { title?: string; force: boolean },
): void {
  const invalid = validateFeatureId(id);
  if (invalid) {
    console.error(`Invalid feature id "${id}": ${invalid}`);
    process.exitCode = 1;
    return;
  }

  const path = featurePath(projectRoot, id);
  if (existsSync(path) && !opts.force) {
    console.error(`Feature already exists: ${path}`);
    console.error('Use --force to overwrite.');
    process.exitCode = 1;
    return;
  }

  const now = new Date().toISOString();
  const title = opts.title ?? id;

  const body = `
## What
<free-form prose — what the feature is and why it matters>

## Acceptance
- [ ] <observable checklist>

## Backend contract
<API shape, if applicable>

## Browser test
<natural-language description of how a human would click through to verify>

## Notes
<filled by ship runner on retry — what was tried, what failed, what was learned>
`;

  const feature: Feature = {
    id,
    title,
    status: 'draft',
    priority: 100,
    depends_on: [],
    created_at: now,
    updated_at: now,
    last_run_id: null,
    last_failure: null,
    body,
  };

  writeFeature(path, feature);
  console.log(`Created: ${path}`);
  console.log('');
  console.log('Next:');
  console.log(`  1. Edit the file and fill in What / Acceptance / Browser test.`);
  console.log(`  2. Run: reins feature set-status ${id} todo`);
  console.log(`  3. Run: reins ship`);
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export function runFeatureStatus(projectRoot: string, id: string, jsonMode: boolean): void {
  const path = featurePath(projectRoot, id);
  if (!existsSync(path)) {
    if (jsonMode) {
      console.log(JSON.stringify({ error: 'not_found', id }));
    } else {
      console.error(`Feature not found: ${id}`);
    }
    process.exitCode = 1;
    return;
  }

  const feature = parseFeatureFile(path);
  if (!feature) {
    if (jsonMode) {
      console.log(JSON.stringify({ error: 'parse_failed', id }));
    } else {
      console.error(`Feature file could not be parsed: ${path}`);
    }
    process.exitCode = 1;
    return;
  }

  if (jsonMode) {
    console.log(JSON.stringify({
      id: feature.id,
      status: feature.status,
      priority: feature.priority,
      depends_on: feature.depends_on,
      last_run_id: feature.last_run_id,
      last_failure: feature.last_failure,
    }));
  } else {
    console.log(feature.status);
  }
}

// ---------------------------------------------------------------------------
// set-status
// ---------------------------------------------------------------------------

export function runFeatureSetStatus(projectRoot: string, id: string, newStatus: string): void {
  if (!isFeatureStatus(newStatus)) {
    console.error(`Invalid status: "${newStatus}"`);
    console.error(`Valid statuses: ${FEATURE_STATUSES.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const path = featurePath(projectRoot, id);
  if (!existsSync(path)) {
    console.error(`Feature not found: ${id}`);
    process.exitCode = 1;
    return;
  }

  // Ensure file is parseable before we touch it (avoid corrupting the
  // frontmatter on files that already have schema issues).
  const feature = parseFeatureFile(path);
  if (!feature) {
    console.error(`Feature file is not parseable, refusing to update: ${path}`);
    process.exitCode = 1;
    return;
  }

  updateFeatureFrontmatter(path, { status: newStatus });
  console.log(`${id}: ${feature.status} → ${newStatus}`);
}

// ---------------------------------------------------------------------------
// next
// ---------------------------------------------------------------------------

export function runFeatureNext(projectRoot: string): void {
  const features = loadAllFeatures(projectRoot);
  const next = pickNextFeature(features);
  console.log(next?.id ?? '');
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function featurePath(projectRoot: string, id: string): string {
  return join(projectRoot, '.reins', 'features', `${id}.md`);
}
