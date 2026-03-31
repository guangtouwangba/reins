import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Constraint, ConstraintsConfig } from '../constraints/schema.js';
import type { CodebaseContext } from '../scanner/types.js';
import type { Adapter } from './base-adapter.js';
import { buildDirectoryProfiles, generateL1 } from '../context/l1-generator.js';

function renderRootAgentsMd(constraints: Constraint[], config: ConstraintsConfig): string {
  const important = constraints.filter(
    c => c.severity === 'important' && c.scope === 'global',
  );

  const lines: string[] = [];
  lines.push(`# ${config.project.name} — Root Agent Context`);
  lines.push('');
  lines.push('## Purpose');
  lines.push('');
  lines.push('Root-level agent context for this project.');
  lines.push('');
  lines.push('## Rules');
  lines.push('');

  if (important.length > 0) {
    lines.push(...important.slice(0, 5).map(c => `- ${c.rule}`));
  } else {
    lines.push('- No root-level important constraints defined.');
  }

  lines.push('');
  lines.push('## Patterns');
  lines.push('');
  lines.push('See `.reins/patterns/` for detailed pattern documentation.');

  return lines.join('\n') + '\n';
}

export const AgentsMdAdapter: Adapter & {
  generateAll(projectRoot: string, constraints: Constraint[], context: CodebaseContext): void;
} = {
  name: 'agents-md',
  outputPath: 'AGENTS.md',

  generate(constraints: Constraint[], context: CodebaseContext, config: ConstraintsConfig): string {
    return renderRootAgentsMd(constraints, config);
  },

  generateAll(projectRoot: string, constraints: Constraint[], context: CodebaseContext): void {
    const profiles = buildDirectoryProfiles(context, constraints);
    generateL1(projectRoot, constraints, profiles);
  },
};
