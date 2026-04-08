#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('reins')
  .description('AI coding agent constraint governance tool')
  .version('0.1.0')
  // Positional options are required so subcommands like `feature` can
  // use `.passThroughOptions()` — without this commander would eat flags
  // like `--title` before the subcommand's own parser sees them.
  .enablePositionalOptions();

program
  .command('init')
  .description('Initialize project constraints')
  .option('-d, --depth <depth>', 'Scan depth (L0, L0-L1, L0-L2)', 'L0-L2')
  .option('--dry-run', 'Preview changes without writing files')
  .option('--adapters <ids>', 'Adapters to generate (comma-separated: claude-code,cursor,copilot,...)')
  .option('--no-input', 'Non-interactive mode')
  .action(async (options) => {
    const { initCommand } = await import('./commands/init.js');
    await initCommand(process.cwd(), options);
  });

program
  .command('status')
  .description('View constraint status and statistics')
  .option('-f, --filter <severity>', 'Filter by severity')
  .option('--format <format>', 'Output format (human, json, markdown)', 'human')
  .option('--since <period>', 'Show trends since period (e.g. 7d)')
  .action(async (options) => {
    const { runStatus } = await import('./commands/status.js');
    await runStatus(options);
  });

program
  .command('update')
  .description('Incrementally update constraints')
  .option('--auto-apply', 'Auto-apply high-confidence changes')
  .action(async (options) => {
    const { runUpdate } = await import('./commands/update.js');
    await runUpdate(options);
  });

program
  .command('test')
  .description('Test constraints and hooks')
  .action(async () => {
    const { runTest } = await import('./commands/test-cmd.js');
    await runTest();
  });

program
  .command('rollback')
  .description('Rollback constraint changes')
  .option('--to <snapshot>', 'Rollback to specific snapshot')
  .action(async (options) => {
    const { runRollback } = await import('./commands/rollback.js');
    await runRollback(options);
  });

program
  .command('analyze')
  .description('Analyze execution history and surface improvement suggestions')
  .option('--json', 'Emit the full analysis as JSON (used by /reins:learn)')
  .action(async (options) => {
    const { analyzeExecutions } = await import('./learn/analyzer.js');
    const projectRoot = process.cwd();
    const result = await analyzeExecutions(projectRoot);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Analysis complete:`);
    console.log(`  Success rate: ${result.metrics.successRate.toFixed(1)}%`);
    console.log(`  Avg duration: ${Math.round(result.metrics.avgDuration)}ms`);
    console.log(`  Recurring errors: ${result.patterns.recurringErrors.length}`);
    console.log(`  Suggested actions: ${result.suggestedActions.length}`);
  });

program
  .command('hook')
  .description('Manage hooks')
  .argument('[action]', 'Action: add, list, disable')
  .argument('[args...]', 'Action arguments')
  .action(async (action, args) => {
    const { runHook } = await import('./commands/hook-cmd.js');
    await runHook(action, args);
  });

program
  .command('feature')
  .description('Manage the feature queue consumed by `reins ship`')
  .argument('[action]', 'Action: list, show, new, status, set-status, next')
  .argument('[args...]', 'Action arguments')
  // passThroughOptions: stop commander from interpreting flags like
  // `--title` or `--json` as feature-command options. feature-cmd.ts
  // parses them from the positional args itself.
  .passThroughOptions()
  .allowUnknownOption()
  .action(async (action, args) => {
    const { runFeature } = await import('./commands/feature-cmd.js');
    await runFeature(action, args);
  });

program
  .command('ship')
  .description('Batch-execute the todo features in .reins/features/ end to end')
  .option('--only <ids>', 'Comma-separated feature ids to run (default: all todo features)')
  .option('--dry-run', 'Plan the run without spawning claude or running verify')
  .option('--max-attempts <n>', 'Per-feature retry budget override', (v) => parseInt(v, 10))
  .option('--parallel <n>', 'Max concurrent features (1 = strict serial, disables planner)', (v) => parseInt(v, 10))
  .option('--no-commit', 'Skip auto-commit after feature_verify passes')
  .action(async (opts) => {
    const { runShipCommand } = await import('./commands/ship-cmd.js');
    await runShipCommand(opts);
  });

program
  .command('gate <event>')
  .description('Run gate check (internal, called by hooks)')
  .action(async (event) => {
    const { runGate } = await import('./gate/index.js');
    await runGate(event);
  });

program
  .command('skill')
  .description('Manage skills')
  .argument('[action]', 'Action: create, list')
  .argument('[args...]', 'Action arguments')
  .action(async (action, args) => {
    const { runSkill } = await import('./commands/skill-cmd.js');
    await runSkill(action, args);
  });

program
  .command('skills')
  .description('List all indexed skills')
  .action(async () => {
    const { runSkillList } = await import('./commands/skill-cmd.js');
    await runSkillList();
  });

program.parse();

export { program };
