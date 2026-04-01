#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('reins')
  .description('AI coding agent constraint governance tool')
  .version('0.1.0');

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
  .command('develop <task>')
  .description('Auto-develop under constraints (spec generation available)')
  .option('-p, --profile <profile>', 'Constraint profile', 'default')
  .option('--skip <stages>', 'Skip pipeline stages (comma-separated: spec,design,qa,planning)')
  .option('--spec <path>', 'Load existing spec from path')
  .option('--no-input', 'Non-interactive mode (skip all prompts)')
  .option('--dry-run', 'Generate plan only, no code changes')
  .action(async (task, options) => {
    const { runPipeline } = await import('./pipeline/runner.js');
    const skipStages: string[] = [];
    if (options.skip) {
      const parts = (options.skip as string).split(',').map((s: string) => s.trim());
      for (const part of parts) {
        if (part === 'spec') skipStages.push('requirementRefine');
        else if (part === 'design') skipStages.push('designGenerate');
        else if (part === 'planning') { skipStages.push('requirementRefine'); skipStages.push('designGenerate'); }
        else if (part === 'qa') skipStages.push('qa');
        else skipStages.push(part);
      }
    }
    const result = await runPipeline(task, process.cwd(), {
      profile: options.profile ?? 'default',
      skipStages,
      specPath: options.spec,
      noInput: options.noInput ?? !process.stdin.isTTY,
      onStageChange: (stage, status) => {
        if (status === 'start') console.log(`  [${stage}] starting...`);
        else if (status === 'complete') console.log(`  [${stage}] ✓`);
        else if (status === 'skip') console.log(`  [${stage}] skipped`);
        else if (status === 'fail') console.log(`  [${stage}] ✗`);
      },
    });
    if (result.success) {
      console.log('');
      console.log('Pipeline completed successfully.');
    } else {
      console.log('');
      console.log(`Pipeline failed at stage: ${result.failedStage}`);
      if (result.error) console.log(`Error: ${result.error}`);
      process.exitCode = 1;
    }
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
  .command('learn')
  .description('Save learned knowledge from current session')
  .option('--auto', 'Run full OBSERVE → ANALYZE → LEARN pipeline non-interactively')
  .action(async (options) => {
    if (options.auto) {
      const { analyzeExecutions } = await import('./learn/analyzer.js');
      const { executeActions } = await import('./learn/learner.js');
      const projectRoot = process.cwd();
      const result = await analyzeExecutions(projectRoot);
      const executed = await executeActions(projectRoot, result.suggestedActions);
      const auto = executed.filter(e => e.disposition === 'auto_applied').length;
      const suggested = executed.filter(e => e.disposition === 'suggested').length;
      console.log(`reins learn --auto: ${auto} auto-applied, ${suggested} suggested`);
    } else {
      console.log('reins learn — run with --auto to trigger full pipeline');
    }
  });

program
  .command('analyze')
  .description('Analyze execution history and surface improvement suggestions')
  .action(async () => {
    const { analyzeExecutions } = await import('./learn/analyzer.js');
    const projectRoot = process.cwd();
    const result = await analyzeExecutions(projectRoot);
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

program.parse();

export { program };
