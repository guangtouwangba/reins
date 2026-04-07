import { existsSync, readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import type { Feature, FailureContext } from './types.js';
import { isFeatureStatus } from './types.js';

/**
 * Regex for the frontmatter block: `^---\n<yaml>\n---\n<body>`.
 *
 * Uses `[ \t]*` (not `\s*`) after the delimiters so that trailing whitespace
 * on the delimiter line is allowed without accidentally swallowing the
 * body's leading newline. The body group captures everything after the
 * closing delimiter's trailing newline, so round-trips through
 * `writeFeature` → `parseFeatureFile` preserve body bytes exactly.
 */
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n)?([\s\S]*)$/;

/**
 * Parse a feature markdown file from disk. Returns `null` with a
 * `console.warn` on any validation failure — ship is supposed to skip
 * invalid files rather than crash, so this function never throws on parse
 * errors. (It *does* throw if the file is unreadable — that's a genuinely
 * unexpected condition the caller should surface.)
 *
 * Unknown frontmatter fields are silently ignored so future schema changes
 * don't break older feature files.
 */
export function parseFeatureFile(filePath: string): Feature | null {
  if (!existsSync(filePath)) {
    console.warn(`[features] ${filePath}: file not found`);
    return null;
  }

  const raw = readFileSync(filePath, 'utf-8');
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    console.warn(`[features] ${filePath}: missing frontmatter delimiters`);
    return null;
  }

  const [, frontmatterYaml, body] = match;
  if (frontmatterYaml === undefined || body === undefined) {
    console.warn(`[features] ${filePath}: frontmatter regex did not capture body`);
    return null;
  }

  let frontmatter: Record<string, unknown>;
  try {
    const loaded = yaml.load(frontmatterYaml);
    if (loaded === null || loaded === undefined) {
      frontmatter = {};
    } else if (typeof loaded !== 'object' || Array.isArray(loaded)) {
      console.warn(`[features] ${filePath}: frontmatter is not a YAML mapping`);
      return null;
    } else {
      frontmatter = loaded as Record<string, unknown>;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[features] ${filePath}: invalid YAML frontmatter: ${msg}`);
    return null;
  }

  // --- Required fields ---
  const id = frontmatter['id'];
  if (typeof id !== 'string' || id.trim() === '') {
    console.warn(`[features] ${filePath}: missing or invalid 'id'`);
    return null;
  }

  const title = frontmatter['title'];
  if (typeof title !== 'string' || title.trim() === '') {
    console.warn(`[features] ${filePath}: missing or invalid 'title'`);
    return null;
  }

  const status = frontmatter['status'];
  if (!isFeatureStatus(status)) {
    console.warn(`[features] ${filePath}: missing or invalid 'status' (got ${JSON.stringify(status)})`);
    return null;
  }

  // --- Optional fields with defaults ---
  const priority = typeof frontmatter['priority'] === 'number' ? frontmatter['priority'] : 100;

  const depends_on = Array.isArray(frontmatter['depends_on'])
    ? frontmatter['depends_on'].filter((x): x is string => typeof x === 'string')
    : [];

  const max_attempts =
    typeof frontmatter['max_attempts'] === 'number' && Number.isFinite(frontmatter['max_attempts'])
      ? frontmatter['max_attempts']
      : undefined;

  const scope =
    Array.isArray(frontmatter['scope'])
      ? frontmatter['scope'].filter((x): x is string => typeof x === 'string')
      : undefined;

  // created_at / updated_at default to '' (not `new Date().toISOString()`) so
  // parsing the same file twice is deterministic. The empty string sorts
  // first in `localeCompare`, which is what tie-breaking on missing dates
  // should do anyway. `writeFeature` always emits real timestamps, so
  // empty values only appear on hand-edited files.
  const created_at = typeof frontmatter['created_at'] === 'string' ? frontmatter['created_at'] : '';
  const updated_at = typeof frontmatter['updated_at'] === 'string' ? frontmatter['updated_at'] : '';

  const last_run_id = typeof frontmatter['last_run_id'] === 'string' ? frontmatter['last_run_id'] : null;

  const last_failure = parseFailureContext(frontmatter['last_failure']);

  return {
    id,
    title,
    status,
    priority,
    depends_on,
    max_attempts,
    scope,
    created_at,
    updated_at,
    last_run_id,
    last_failure,
    body,
  };
}

function parseFailureContext(raw: unknown): FailureContext | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const stage = obj['stage'];
  const command = obj['command'];
  const exit_code = obj['exit_code'];
  const output = obj['output'];
  const trace_tail = obj['trace_tail'];

  const validStages = new Set([
    'claude',
    'scope-drift',
    'pre_commit',
    'feature_verify',
    'browser_verify',
    'commit',
    'rebase',
  ]);

  if (typeof stage !== 'string' || !validStages.has(stage)) return null;
  if (typeof command !== 'string') return null;
  if (typeof exit_code !== 'number') return null;
  if (typeof output !== 'string') return null;

  return {
    stage: stage as FailureContext['stage'],
    command,
    exit_code,
    output,
    ...(typeof trace_tail === 'string' ? { trace_tail } : {}),
  };
}
