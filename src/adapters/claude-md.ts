import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Constraint, ConstraintsConfig } from '../constraints/schema.js';
import type { CodebaseContext } from '../scanner/types.js';
import type { Adapter } from './base-adapter.js';
import { registerAdapter } from './base-adapter.js';
import type { AdapterDefinition, AdapterInput, AdapterOutput } from './base-adapter.js';

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

export const ClaudeCodeAdapter: AdapterDefinition = {
  id: 'claude-code',
  displayName: 'Claude Code',
  description: '→ CLAUDE.md, AGENTS.md, .claude/settings.json',

  detect(projectRoot: string): boolean {
    return existsSync(join(projectRoot, '.claude')) || existsSync(join(projectRoot, 'CLAUDE.md'));
  },

  generate(input: AdapterInput): AdapterOutput[] {
    const { content } = input;
    const outputs: AdapterOutput[] = [];

    // CLAUDE.md
    const lines: string[] = [];
    lines.push(`# ${content.projectName}`);
    lines.push('');
    lines.push(`**Stack**: ${content.projectSummary}`);
    lines.push('');
    lines.push('## Commands');
    lines.push('');
    lines.push(content.commandsBlock || '- No commands detected');
    lines.push('');
    lines.push('## Critical Rules');
    lines.push('');
    if (content.criticalRules.length > 0) {
      lines.push(...content.criticalRules.slice(0, 5).map(r => `- ${r}`));
    } else {
      lines.push('- No critical constraints detected');
    }
    if (content.projectMapLines.length > 0) {
      lines.push('');
      lines.push('## Project Map');
      lines.push('');
      lines.push(...content.projectMapLines);
    }
    lines.push('');
    lines.push('## Reins');
    lines.push('');
    lines.push('- Constraints: `.reins/constraints.yaml`');
    lines.push('- Patterns: `.reins/patterns/`');
    lines.push('- Agent context: `AGENTS.md` (per-directory)');

    outputs.push({ path: 'CLAUDE.md', content: lines.join('\n') + '\n', label: 'Claude Code context' });

    // AGENTS.md (simplified — one for project root)
    const agentsLines: string[] = [];
    agentsLines.push(`# ${content.projectName} — Agent Context`);
    agentsLines.push('');
    agentsLines.push(`Architecture: ${content.architectureSummary}`);
    agentsLines.push('');
    if (content.importantRules.length > 0) {
      agentsLines.push('## Important Rules');
      agentsLines.push('');
      agentsLines.push(...content.importantRules.map(r => `- ${r}`));
      agentsLines.push('');
    }
    if (content.conventionsBlock) {
      agentsLines.push('## Conventions');
      agentsLines.push('');
      agentsLines.push(content.conventionsBlock);
      agentsLines.push('');
    }

    outputs.push({ path: 'AGENTS.md', content: agentsLines.join('\n') + '\n', label: 'Agent context (per-directory)' });

    return outputs;
  },
};

registerAdapter(ClaudeCodeAdapter);
