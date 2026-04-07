import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import yaml from 'js-yaml';
import type { Feature } from './types.js';

/**
 * Write a complete `Feature` to disk as a markdown file with YAML
 * frontmatter + body. Used by `reins feature new` and tests; **not** used
 * by the ship runner for status updates (see `updateFeatureFrontmatter`).
 *
 * Creates parent directories as needed. Overwrites existing files — the
 * caller is responsible for "does the file already exist" checks.
 */
export function writeFeature(filePath: string, feature: Feature): void {
  const frontmatter = serializeFrontmatter(feature);
  const content = `---\n${frontmatter}---\n${feature.body}`;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
}

/**
 * Update only the frontmatter of an existing feature file, preserving the
 * body bytes verbatim. This is how the ship runner flips `status`, records
 * `last_run_id`, and persists `last_failure` without touching the user's
 * prose.
 *
 * The `updated_at` field is auto-bumped regardless of the patch contents.
 *
 * Throws if the file doesn't exist or isn't a valid frontmatter file — the
 * caller should have validated via `parseFeatureFile` first.
 *
 * Byte-preservation is guaranteed by extracting the body slice directly
 * from the raw bytes (rather than round-tripping through `parseFeatureFile`
 * and writing via `writeFeature`).
 */
export function updateFeatureFrontmatter(
  filePath: string,
  patch: Record<string, unknown>,
): void {
  if (!existsSync(filePath)) {
    throw new Error(`updateFeatureFrontmatter: file not found: ${filePath}`);
  }

  const raw = readFileSync(filePath, 'utf-8');

  const bounds = findFrontmatterBounds(raw);
  if (!bounds) {
    throw new Error(`updateFeatureFrontmatter: missing frontmatter delimiters: ${filePath}`);
  }

  const { yamlStart, yamlEnd, bodyStart } = bounds;
  const frontmatterYaml = raw.slice(yamlStart, yamlEnd);
  const bodyBytes = raw.slice(bodyStart);

  let existing: Record<string, unknown>;
  try {
    const loaded = yaml.load(frontmatterYaml);
    existing = loaded && typeof loaded === 'object' && !Array.isArray(loaded)
      ? (loaded as Record<string, unknown>)
      : {};
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`updateFeatureFrontmatter: invalid YAML in ${filePath}: ${msg}`);
  }

  const merged: Record<string, unknown> = {
    ...existing,
    ...patch,
    updated_at: new Date().toISOString(),
  };

  const newYaml = dumpFrontmatter(merged);
  // bodyBytes starts at the first body character (the closing delimiter
  // line — including its trailing newline — was already consumed by
  // `findFrontmatterBounds`). We re-emit a clean closing `---\n` here.
  const newContent = `---\n${newYaml}---\n${bodyBytes}`;
  writeFileSync(filePath, newContent, 'utf-8');
}

interface FrontmatterBounds {
  /** Index into `raw` where the YAML content starts (immediately after the opening delimiter line). */
  yamlStart: number;
  /** Index into `raw` where the YAML content ends (at the newline before the closing `---`). */
  yamlEnd: number;
  /** Index into `raw` where the body starts (immediately after the closing `---` and any trailing whitespace on that line). */
  bodyStart: number;
}

/**
 * Same delimiter recognition as `parseFeatureFile`'s regex, but returns
 * byte offsets so the body can be sliced verbatim.
 *
 * Tolerated:
 * - Trailing spaces/tabs on the opening `---` line
 * - `\r\n` line endings on either delimiter
 * - Trailing spaces/tabs on the closing `---` line
 *
 * Returns `null` for any file that wouldn't parse cleanly via
 * `parseFeatureFile` — the two functions agree on what counts as a
 * valid feature file.
 */
function findFrontmatterBounds(raw: string): FrontmatterBounds | null {
  // Opening delimiter: `---` then optional spaces/tabs then `\n` or `\r\n`.
  const openMatch = /^---[ \t]*\r?\n/.exec(raw);
  if (!openMatch) return null;
  const yamlStart = openMatch[0].length;

  // Closing delimiter: `\n---` then optional spaces/tabs then end-of-line or end-of-file.
  // Search starting at yamlStart so the opening delimiter can't accidentally match.
  const closeRe = /\r?\n---[ \t]*(\r?\n|$)/g;
  closeRe.lastIndex = yamlStart;
  const closeMatch = closeRe.exec(raw);
  if (!closeMatch) return null;

  const yamlEnd = closeMatch.index;
  // bodyStart skips past the closing delimiter line entirely (including
  // its trailing newline if present), so the body slice starts at the
  // first body byte. Files with no trailing newline after the closing
  // `---` get an empty body.
  const bodyStart = closeMatch.index + closeMatch[0].length;
  return { yamlStart, yamlEnd, bodyStart };
}

/**
 * Serialize a Feature's structured fields to YAML, producing the exact
 * frontmatter string (minus the `---` delimiters) that `writeFeature`
 * embeds in the file.
 */
function serializeFrontmatter(feature: Feature): string {
  const obj: Record<string, unknown> = {
    id: feature.id,
    title: feature.title,
    status: feature.status,
    priority: feature.priority,
    depends_on: feature.depends_on,
  };
  if (feature.max_attempts !== undefined) obj['max_attempts'] = feature.max_attempts;
  if (feature.scope !== undefined) obj['scope'] = feature.scope;
  obj['created_at'] = feature.created_at;
  obj['updated_at'] = feature.updated_at;
  obj['last_run_id'] = feature.last_run_id;
  obj['last_failure'] = feature.last_failure;
  return dumpFrontmatter(obj);
}

function dumpFrontmatter(obj: Record<string, unknown>): string {
  // js-yaml already appends a trailing `\n`; we keep it so the closing
  // delimiter lands on its own line after the YAML block.
  return yaml.dump(obj, { lineWidth: 120, quotingType: '"' });
}
