import type { Constraint, ConstraintsConfig } from '../constraints/schema.js';
import type { CodebaseContext } from '../scanner/types.js';

export interface SharedContent {
  projectName: string;
  projectSummary: string;
  architectureSummary: string;
  criticalRules: string[];
  importantRules: string[];
  helpfulRules: string[];
  commandsBlock: string;
  conventionsBlock: string;
  hooksSummary: string;
  constraintCount: { critical: number; important: number; helpful: number };
  projectMapLines: string[];
}

export function buildSharedContent(
  constraints: Constraint[],
  context: CodebaseContext,
  config: ConstraintsConfig,
): SharedContent {
  const critical = constraints.filter(c => c.severity === 'critical');
  const important = constraints.filter(c => c.severity === 'important');
  const helpful = constraints.filter(c => c.severity === 'helpful');

  const stackParts = [
    ...context.stack.framework,
    ...context.stack.language,
    context.stack.packageManager,
  ].filter(Boolean);

  const projectName = config.project.name;
  const projectSummary = stackParts.length > 0 ? stackParts.join(' + ') : 'unknown';
  const architectureSummary = context.architecture.pattern || 'unknown';

  // Build commands block from context.commands
  const commandsBlock = buildCommandsBlock(context);

  // Build conventions block
  const conventionsBlock = buildConventionsBlock(context);

  // Hooks summary
  const hookConstraints = constraints.filter(c => c.enforcement.hook);
  const blockHooks = hookConstraints.filter(c => c.enforcement.hook_mode === 'block' || !c.enforcement.hook_mode);
  const warnHooks = hookConstraints.filter(c => c.enforcement.hook_mode === 'warn');
  const hooksSummary = hookConstraints.length > 0
    ? `${hookConstraints.length} hooks active (${blockHooks.length} block, ${warnHooks.length} warn)`
    : 'No hooks configured';

  // Project map
  const topDirs = context.structure.directories
    .filter(d => !d.path.includes('/') && !d.path.startsWith('.'))
    .slice(0, 8);
  const projectMapLines = topDirs.map(d => `- \`${d.path}/\``);

  return {
    projectName,
    projectSummary,
    architectureSummary,
    criticalRules: critical.map(c => c.rule),
    importantRules: important.map(c => c.rule),
    helpfulRules: helpful.map(c => c.rule),
    commandsBlock,
    conventionsBlock,
    hooksSummary,
    constraintCount: { critical: critical.length, important: important.length, helpful: helpful.length },
    projectMapLines,
  };
}

function buildCommandsBlock(context: CodebaseContext): string {
  const lines: string[] = [];
  const cmds = context.commands;
  if (!cmds) {
    // Fallback: infer from package manager
    const pm = context.stack.packageManager || 'npm';
    const run = pm === 'npm' ? 'npm run' : pm === 'yarn' ? 'yarn' : `${pm} run`;
    lines.push(`- **Build**: \`${run} build\``);
    if (context.testing.framework) lines.push(`- **Test**: \`${run} test\``);
    lines.push(`- **Lint**: \`${run} lint\``);
    return lines.join('\n');
  }

  const fields: Array<{ key: keyof typeof cmds; label: string }> = [
    { key: 'install', label: 'Install' },
    { key: 'dev', label: 'Dev' },
    { key: 'build', label: 'Build' },
    { key: 'test', label: 'Test' },
    { key: 'lint', label: 'Lint' },
    { key: 'typecheck', label: 'Typecheck' },
    { key: 'format', label: 'Format' },
  ];

  for (const { key, label } of fields) {
    const cmd = cmds[key];
    if (!cmd) continue;
    let annotation = '';
    if (cmd.source === 'user') annotation = ' (declared)';
    else if (cmd.source === 'docs') annotation = ' (from docs)';
    else if (cmd.confidence < 0.7) annotation = ' (may need adjustment)';
    lines.push(`- **${label}**: \`${cmd.command}\`${annotation}`);
  }

  // Add derived commands inline
  if (cmds.lintFix) {
    lines.push(`- **Lint fix**: \`${cmds.lintFix.command}\``);
  }
  if (cmds.testSingle) {
    lines.push(`- **Test single**: \`${cmds.testSingle.command}\``);
  }

  return lines.length > 0 ? lines.join('\n') : '- No commands detected';
}

function buildConventionsBlock(context: CodebaseContext): string {
  const lines: string[] = [];
  if (context.conventions.naming !== 'unknown') {
    lines.push(`- Naming: ${context.conventions.naming}`);
  }
  if (context.conventions.fileStructure !== 'unknown') {
    lines.push(`- File structure: ${context.conventions.fileStructure}`);
  }
  if (context.conventions.importStyle !== 'unknown') {
    lines.push(`- Import style: ${context.conventions.importStyle}`);
  }
  return lines.length > 0 ? lines.join('\n') : '';
}
