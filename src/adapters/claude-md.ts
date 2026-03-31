import type { Constraint, ConstraintsConfig } from '../constraints/schema.js';
import type { CodebaseContext } from '../scanner/types.js';
import type { Adapter } from './base-adapter.js';

function inferCommands(context: CodebaseContext): string[] {
  const pm = context.stack.packageManager || 'npm';
  const run = pm === 'npm' ? 'npm run' : pm === 'yarn' ? 'yarn' : `${pm} run`;
  const lines: string[] = [];
  lines.push(`- **Dev**: \`${run} dev\``);
  lines.push(`- **Build**: \`${run} build\``);
  if (context.testing.framework) lines.push(`- **Test**: \`${run} test\``);
  lines.push(`- **Lint**: \`${run} lint\``);
  if (context.stack.language.includes('typescript')) {
    lines.push(`- **Typecheck**: \`${run} typecheck\``);
  }
  return lines;
}

export const ClaudeMdAdapter: Adapter = {
  name: 'claude-md',
  outputPath: 'CLAUDE.md',

  generate(constraints: Constraint[], context: CodebaseContext, config: ConstraintsConfig): string {
    const criticals = constraints.filter(c => c.severity === 'critical').slice(0, 5);
    const projectName = config.project.name;
    const stackLine = [
      ...context.stack.framework,
      ...context.stack.language,
      context.stack.packageManager,
    ]
      .filter(Boolean)
      .join(' + ');

    const commandLines = inferCommands(context);

    const lines: string[] = [];
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

    const topDirs = context.structure.directories
      .filter(d => !d.path.includes('/') && !d.path.startsWith('.'))
      .slice(0, 8);

    const mapSection =
      topDirs.length > 0
        ? ['', '## Project Map', '', ...topDirs.map(d => `- \`${d.path}/\``)]
        : [];

    const footer = [
      '',
      '## Reins',
      '',
      '- Constraints: `.reins/constraints.yaml`',
      '- Patterns: `.reins/patterns/`',
      '- Agent context: `AGENTS.md` (per-directory)',
    ];

    const ruleLines = rules.map(c => `- ${c.rule}`);
    let total = lines.length + ruleLines.length + mapSection.length + footer.length;

    let trimmedMap = mapSection;
    if (total > 50 && mapSection.length > 0) {
      trimmedMap = [];
      total -= mapSection.length;
    }

    if (total > 50) {
      rules = rules.slice(0, 3);
    }

    lines.push(...(rules.length > 0 ? rules.map(c => `- ${c.rule}`) : ['- No critical constraints detected']));
    lines.push(...trimmedMap);
    lines.push(...footer);

    return lines.join('\n') + '\n';
  },
};
