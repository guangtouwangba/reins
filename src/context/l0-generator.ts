import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CodebaseContext } from '../scanner/types.js';
import type { Constraint } from '../constraints/schema.js';

const MARKER_START = '<!-- reins-managed -->';
const MARKER_END = '<!-- /reins-managed -->';

function inferCommands(context: CodebaseContext): string[] {
  // If command discovery has populated context.commands, use those
  if (context.commands) {
    const lines: string[] = [];
    const labels: Array<{ key: keyof typeof context.commands; label: string }> = [
      { key: 'install', label: 'Install' },
      { key: 'dev', label: 'Dev' },
      { key: 'build', label: 'Build' },
      { key: 'test', label: 'Test' },
      { key: 'testSingle', label: 'Test (single)' },
      { key: 'lint', label: 'Lint' },
      { key: 'lintFix', label: 'Lint fix' },
      { key: 'typecheck', label: 'Typecheck' },
      { key: 'format', label: 'Format' },
      { key: 'formatCheck', label: 'Format check' },
      { key: 'clean', label: 'Clean' },
    ];

    for (const { key, label } of labels) {
      const cmd = context.commands[key];
      if (!cmd) continue;

      let annotation = '';
      if (cmd.source === 'user') annotation = ' (declared)';
      else if (cmd.source === 'docs') annotation = ' (from docs)';
      if (cmd.confidence < 0.7) annotation = ' (may need adjustment)';

      lines.push(`- **${label}**: \`${cmd.command}\`${annotation}`);
    }

    if (lines.length > 0) return lines;
  }

  // Fallback: infer from package manager
  const pm = context.stack.packageManager || 'npm';
  const run = pm === 'npm' ? 'npm run' : pm === 'yarn' ? 'yarn' : `${pm} run`;
  const lines: string[] = [];

  // dev
  lines.push(`- **Dev**: \`${run} dev\``);
  // build
  lines.push(`- **Build**: \`${run} build\``);
  // test
  if (context.testing.framework) {
    lines.push(`- **Test**: \`${run} test\``);
  }
  // lint
  lines.push(`- **Lint**: \`${run} lint\``);
  // typecheck (if typescript)
  if (context.stack.language.includes('typescript')) {
    lines.push(`- **Typecheck**: \`${run} typecheck\``);
  }

  return lines;
}

function buildProjectMap(context: CodebaseContext, maxLines: number): string[] {
  const topDirs = context.structure.directories
    .filter(d => !d.path.includes('/') && !d.path.startsWith('.'))
    .slice(0, maxLines);

  if (topDirs.length === 0) return [];

  return topDirs.map(d => `- \`${d.path}/\``);
}

function renderManagedSection(context: CodebaseContext, constraints: Constraint[]): string {
  const criticals = constraints.filter(c => c.severity === 'critical').slice(0, 5);
  const projectName = context.keyFiles.readme
    ? context.keyFiles.readme.replace(/^.*\//, '').replace(/\.[^.]+$/, '')
    : 'Project';

  const commandLines = inferCommands(context);
  const stackLine = [
    ...context.stack.framework,
    ...context.stack.language,
    context.stack.packageManager,
  ]
    .filter(Boolean)
    .join(' + ');

  const lines: string[] = [];
  lines.push(MARKER_START);
  lines.push(`# ${projectName}`);
  lines.push('');
  lines.push(stackLine ? `**Stack**: ${stackLine}` : '**Stack**: unknown');
  lines.push('');
  lines.push('## Commands');
  lines.push('');
  lines.push(...commandLines);
  lines.push('');
  lines.push('## Critical Rules');
  lines.push('');

  let rules = criticals;
  const mapLines = buildProjectMap(context, 8);

  // Build all sections and check line count
  const mapSection = mapLines.length > 0
    ? ['', '## Project Map', '', ...mapLines]
    : [];

  const footer = [
    '',
    '## Reins',
    '',
    '- Constraints: `.reins/constraints.yaml`',
    '- Patterns: `.reins/patterns/`',
    '- Agent context: `AGENTS.md` (per-directory)',
  ];

  // Calculate projected total
  const ruleLines = rules.map(c => `- ${c.rule}`);
  let total =
    lines.length + ruleLines.length + mapSection.length + footer.length + 1; // +1 for MARKER_END

  // Truncate project map first if over 50
  let trimmedMap = mapSection;
  if (total > 50 && mapSection.length > 0) {
    trimmedMap = [];
    total -= mapSection.length;
  }

  // Truncate rules to 3 if still over 50
  if (total > 50) {
    rules = rules.slice(0, 3);
  }

  lines.push(...rules.map(c => `- ${c.rule}`));
  if (rules.length === 0) lines.push('- No critical constraints detected');
  lines.push(...trimmedMap);
  lines.push(...footer);
  lines.push(MARKER_END);

  return lines.join('\n');
}

/**
 * Generate or update CLAUDE.md in projectRoot.
 *
 * - If CLAUDE.md does not exist: write the full managed section as the file.
 * - If CLAUDE.md exists without the marker: append the managed section.
 * - If CLAUDE.md exists with the marker: replace content between markers.
 */
export function generateL0(
  projectRoot: string,
  context: CodebaseContext,
  constraints: Constraint[],
): void {
  const outputPath = join(projectRoot, 'CLAUDE.md');
  const managed = renderManagedSection(context, constraints);

  if (!existsSync(outputPath)) {
    writeFileSync(outputPath, managed + '\n', 'utf-8');
    return;
  }

  const existing = readFileSync(outputPath, 'utf-8');

  if (existing.includes(MARKER_START)) {
    // Replace between markers
    const startIdx = existing.indexOf(MARKER_START);
    const endIdx = existing.indexOf(MARKER_END);
    if (endIdx === -1) {
      // Malformed — just append
      writeFileSync(outputPath, existing.trimEnd() + '\n\n' + managed + '\n', 'utf-8');
      return;
    }
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + MARKER_END.length);
    writeFileSync(outputPath, before + managed + after, 'utf-8');
  } else {
    // Append
    writeFileSync(outputPath, existing.trimEnd() + '\n\n' + managed + '\n', 'utf-8');
  }
}
