import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { Constraint, ConstraintsConfig } from '../constraints/schema.js';
import type { Feature, FailureContext } from '../features/types.js';

/**
 * Return the last `n` lines of `text`. When `text` has fewer than `n`
 * lines, returns the input unchanged (including its trailing newline
 * state). `n <= 0` returns an empty string.
 */
export function tail(text: string, n: number): string {
  if (n <= 0) return '';
  if (!text) return '';
  const lines = text.split('\n');
  if (lines.length <= n) return text;
  return lines.slice(lines.length - n).join('\n');
}

/**
 * Build the implement-task prompt sent to headless Claude Code for a
 * single feature attempt.
 *
 * Structure (in order):
 *   1. Header with feature title
 *   2. Feature body verbatim (the user's intent + acceptance criteria)
 *   3. Critical + important constraints loaded from `constraints.yaml`
 *      (helpful-severity rules filtered out to keep prompt bounded)
 *   4. If this is a retry, a "Previous attempt failed" section with the
 *      failing stage, command, exit code, and tail of output
 *   5. The "do not weaken the tests" guard (retry only)
 *   6. Footer instructing Claude Code to append its own notes to the
 *      feature file's `## Notes` section
 *
 * The prompt is stateless — every attempt reconstructs it from scratch.
 * That's intentional so the headless call behaves the same even if
 * Claude Code's own context gets reset between turns.
 */
export function buildImplementPrompt(
  feature: Feature,
  projectRoot: string,
  previousFailure?: FailureContext,
): string {
  const constraints = loadImportantConstraints(projectRoot);
  const featurePath = join('.reins', 'features', `${feature.id}.md`);

  const sections: string[] = [];

  sections.push(`# Implementation task: ${feature.title}`);
  sections.push('');
  sections.push(feature.body.trim());
  sections.push('');

  if (constraints.length > 0) {
    sections.push('## Project constraints (do not violate)');
    sections.push('');
    for (const c of constraints) {
      sections.push(`- [${c.severity}] ${c.rule}`);
    }
    sections.push('');
  }

  if (previousFailure) {
    sections.push('## Previous attempt failed');
    sections.push('');
    sections.push(`Stage: ${previousFailure.stage}`);
    sections.push(`Command: \`${previousFailure.command}\``);
    sections.push(`Exit code: ${previousFailure.exit_code}`);
    sections.push('');
    sections.push('Output (last 100 lines):');
    sections.push('```');
    sections.push(tail(previousFailure.output, 100));
    sections.push('```');
    sections.push('');
    sections.push(
      '**Fix the code so this command passes. Do not weaken the tests, do not skip them, do not add exceptions.**',
    );
    sections.push('');
  }

  sections.push('## When done');
  sections.push('');
  sections.push(
    `Append a short note under the \`## Notes\` section of \`${featurePath}\` describing what you changed and why. Do not modify any other field in that file.`,
  );

  return sections.join('\n');
}

/**
 * Load the constraint list from `.reins/constraints.yaml`, filtered to
 * `critical` + `important` severities. `helpful` is dropped on purpose
 * — retry prompts can blow past the token budget otherwise, and the
 * helpful rules are closer to nice-to-haves anyway.
 *
 * Returns `[]` when the file is missing, unreadable, or malformed. The
 * ship runner treats a missing constraints file as "no project rules",
 * not as an error.
 */
function loadImportantConstraints(projectRoot: string): Constraint[] {
  const path = join(projectRoot, '.reins', 'constraints.yaml');
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = yaml.load(raw) as ConstraintsConfig | null;
    const all = parsed?.constraints ?? [];
    return all.filter(c => c.severity === 'critical' || c.severity === 'important');
  } catch {
    return [];
  }
}

/**
 * Build the planning prompt for the AI execution planner.
 *
 * See `openspec/changes/2026-04-07-feature-ship/design.md` §11 for the
 * full contract. The planner reads a compact summary of every todo
 * feature and returns a JSON execution DAG assigning each feature to a
 * serial or parallel step. Reins then walks the DAG; a malformed
 * response falls back to `depends_on` topological order.
 *
 * The prompt is designed to be model-friendly: explicit schema, explicit
 * rules, one clear instruction to output JSON only (no markdown fences).
 */
export function buildPlanningPrompt(
  todoFeatures: Feature[],
  doneFeatureIds: string[],
  maxParallelism: number,
): string {
  const sections: string[] = [];

  sections.push(
    'You are planning the execution order of several code-change features in a single',
  );
  sections.push(
    'codebase. Your ONLY job is to decide which features can run in parallel vs',
  );
  sections.push(
    'serially, so Reins can schedule them efficiently without introducing merge',
  );
  sections.push('conflicts or dependency violations.');
  sections.push('');

  sections.push('Return ONLY a JSON object matching this schema:');
  sections.push('```json');
  sections.push('{');
  sections.push('  "steps": [');
  sections.push(
    '    {"mode": "serial" | "parallel", "features": ["<id>", ...], "reason": "<one sentence>"}',
  );
  sections.push('  ],');
  sections.push(
    '  "parallelism": <integer, max features allowed in any parallel step>,',
  );
  sections.push(
    '  "estimated_minutes": <rough total walltime estimate>',
  );
  sections.push('}');
  sections.push('```');
  sections.push('');

  sections.push('Rules:');
  sections.push('- Every feature id in the input list must appear in exactly one step.');
  sections.push(
    '- Respect depends_on: a dependent feature cannot appear in a step before its dep.',
  );
  sections.push(
    '- Put features in the same parallel step ONLY if they clearly touch different',
  );
  sections.push(
    '  files or modules. When in doubt, make them serial.',
  );
  sections.push(`- parallelism must be <= ${maxParallelism}.`);
  sections.push(
    '- DO NOT explain your reasoning outside the JSON. DO NOT output markdown fences.',
  );
  sections.push('');

  sections.push('Features:');
  sections.push('```json');
  sections.push(JSON.stringify(todoFeatures.map(summarizeFeatureForPlanning), null, 2));
  sections.push('```');
  sections.push('');

  sections.push('Already-done features (for dependency context):');
  sections.push('```json');
  sections.push(JSON.stringify(doneFeatureIds));
  sections.push('```');

  return sections.join('\n');
}

function summarizeFeatureForPlanning(feature: Feature): Record<string, unknown> {
  const bodyPreview = feature.body.trim().slice(0, 500);
  return {
    id: feature.id,
    title: feature.title,
    priority: feature.priority,
    depends_on: feature.depends_on,
    scope: feature.scope ?? [],
    body_preview: bodyPreview,
  };
}

// ---------------------------------------------------------------------------
// Browser test extraction + spec generation prompt
// ---------------------------------------------------------------------------

/**
 * Extract the content of the `## Browser test` section from a feature
 * body. Returns the inner text (trimmed, without the heading) or
 * `null` when the section is absent or empty.
 *
 * The section runs from `## Browser test` (any heading level ≥2) until
 * the next heading at the same or higher level, or end of body.
 *
 * Anchored via `(?:^|\n)` to match at line start without the `m` flag,
 * so the trailing `$` in the lookahead means end-of-string (not
 * end-of-line) and the lazy capture runs to the next heading or EOF.
 */
export function extractBrowserTestSection(body: string): string | null {
  // `[ \t]*\n` (not `\s*\n`) ensures the terminator newline is exactly
  // the one ending the heading line — without this, a greedy `\s*`
  // would gobble a following blank line and shift the capture start,
  // causing an empty "## Browser test\n\n## Notes\n…" section to
  // accidentally include the next section's content.
  const re = /(?:^|\n)#{2,6}\s+Browser test[ \t]*\n([\s\S]*?)(?=\n#{1,6}\s|$)/;
  const match = re.exec(body);
  if (!match || match[1] === undefined) return null;
  const content = match[1].trim();
  return content.length > 0 ? content : null;
}

/**
 * Build the prompt that asks Claude Code to write a Playwright spec
 * file at `specPath` implementing the feature's natural-language
 * browser test description.
 *
 * When a `playwrightConfigPath` is provided, the prompt instructs the
 * model to inspect it for baseURL, fixtures, and helper conventions so
 * the generated spec matches the project's existing style.
 */
export function buildSpecGenPrompt(
  feature: Feature,
  specPath: string,
  playwrightConfigPath?: string,
): string {
  const browserTest = extractBrowserTestSection(feature.body);
  if (browserTest === null) {
    throw new Error(
      `buildSpecGenPrompt: feature ${feature.id} has no "## Browser test" section`,
    );
  }

  const sections: string[] = [];
  sections.push(`# Playwright spec generation task: ${feature.title}`);
  sections.push('');
  sections.push(
    `Write a Playwright spec at \`${specPath}\` that verifies the browser-level behavior described below.`,
  );
  sections.push('');
  sections.push('## Browser test description');
  sections.push('');
  sections.push(browserTest);
  sections.push('');

  if (playwrightConfigPath) {
    sections.push('## Project Playwright config');
    sections.push('');
    sections.push(
      `Read \`${playwrightConfigPath}\` first to pick up the project's baseURL, fixtures, and helper conventions. Match its style.`,
    );
    sections.push('');
  }

  sections.push('## Requirements');
  sections.push('');
  sections.push(
    `- Write ONLY the spec file at the exact path above. Do not modify any other files.`,
  );
  sections.push(
    `- Use structured Playwright assertions (expect(locator).toHaveText, toHaveClass, toBeVisible, etc.). Do not rely on screenshot comparisons or vision models.`,
  );
  sections.push(
    `- If the spec needs a helper not present in the project, prefer inlining a small helper inside the spec file rather than creating a new file.`,
  );
  sections.push(
    `- Verify all acceptance criteria from the browser test description above.`,
  );
  sections.push(`- When done, the file at \`${specPath}\` must exist.`);

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// Dev server discovery prompt
// ---------------------------------------------------------------------------

/**
 * Build the prompt that asks Claude Code to identify how to start the
 * project's dev server. Returns JSON matching `DevServerConfig`:
 *
 *   { command, wait_for_url, timeout_ms }
 *
 * The prompt includes package.json scripts, Makefile targets, and the
 * first few lines of the README as evidence the model can consult.
 *
 * The discovery is a one-time cost per project — the caller persists a
 * successful result back to `constraints.yaml` so subsequent ships
 * reuse it instead of spawning claude again.
 */
export function buildDevServerDiscoveryPrompt(projectRoot: string): string {
  const sections: string[] = [];
  sections.push('# Dev server discovery task');
  sections.push('');
  sections.push(
    'Reins needs to start this project\'s dev server so Playwright tests can run against it. Identify the command, the URL to poll for health, and a reasonable startup timeout.',
  );
  sections.push('');

  sections.push('Return ONLY a JSON object matching this schema:');
  sections.push('```json');
  sections.push('{');
  sections.push('  "command": "<shell command that starts the dev server>",');
  sections.push('  "wait_for_url": "<http url that responds 2xx/3xx/4xx when server is ready>",');
  sections.push('  "timeout_ms": <max ms to wait for wait_for_url, usually 30000-60000>');
  sections.push('}');
  sections.push('```');
  sections.push('');

  sections.push('Rules:');
  sections.push(
    '- The command should run in the foreground (NOT detached) — reins wraps it for background execution.',
  );
  sections.push(
    '- Prefer the dev-mode script (not production build). E.g. `pnpm dev`, `npm run dev`, `next dev`, `bundle exec rails s`.',
  );
  sections.push('- If the project has no dev server at all, return `null` (not an empty object).');
  sections.push('- DO NOT output markdown fences. DO NOT explain your reasoning outside the JSON.');
  sections.push('');

  // Include evidence the model can consult
  sections.push('## package.json scripts');
  sections.push('');
  const pkgJson = safeReadFile(join(projectRoot, 'package.json'));
  if (pkgJson) {
    try {
      const pkg = JSON.parse(pkgJson) as { scripts?: Record<string, string> };
      if (pkg.scripts) {
        sections.push('```json');
        sections.push(JSON.stringify(pkg.scripts, null, 2));
        sections.push('```');
      } else {
        sections.push('(no scripts field)');
      }
    } catch {
      sections.push('(package.json exists but is not valid JSON)');
    }
  } else {
    sections.push('(no package.json)');
  }
  sections.push('');

  const makefile = safeReadFile(join(projectRoot, 'Makefile'));
  if (makefile) {
    sections.push('## Makefile');
    sections.push('');
    sections.push('```');
    sections.push(makefile.slice(0, 2000));
    sections.push('```');
    sections.push('');
  }

  const dockerCompose =
    safeReadFile(join(projectRoot, 'docker-compose.yml')) ??
    safeReadFile(join(projectRoot, 'docker-compose.yaml'));
  if (dockerCompose) {
    sections.push('## docker-compose.yml (first 1500 chars)');
    sections.push('');
    sections.push('```yaml');
    sections.push(dockerCompose.slice(0, 1500));
    sections.push('```');
    sections.push('');
  }

  const readme =
    safeReadFile(join(projectRoot, 'README.md')) ??
    safeReadFile(join(projectRoot, 'README.rst')) ??
    safeReadFile(join(projectRoot, 'README'));
  if (readme) {
    sections.push('## README (first 2000 chars)');
    sections.push('');
    sections.push(readme.slice(0, 2000));
  }

  return sections.join('\n');
}

function safeReadFile(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}
