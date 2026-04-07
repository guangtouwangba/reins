import { runShip, type RunShipOptions } from '../ship/index.js';
import type { RunSummary } from '../ship/types.js';

/**
 * Options for `reins ship` at the CLI level. Mirrors `RunShipOptions`
 * plus the parsed flags from commander.
 */
export interface ShipCommandOptions {
  only?: string;
  dryRun?: boolean;
  maxAttempts?: number;
  parallel?: number;
  noCommit?: boolean;
}

/**
 * CLI entry for `reins ship`. Parses the CLI-shaped options into the
 * runtime-shaped `RunShipOptions`, invokes `runShip`, and pretty-prints
 * the result. Exits 1 when any feature is blocked so CI pipelines can
 * detect partial runs.
 */
export async function runShipCommand(opts: ShipCommandOptions): Promise<void> {
  const projectRoot = process.cwd();

  const shipOpts: RunShipOptions = {};
  if (opts.only) {
    shipOpts.only = opts.only.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (opts.dryRun) shipOpts.dryRun = true;
  if (opts.maxAttempts !== undefined) shipOpts.maxAttempts = opts.maxAttempts;
  if (opts.parallel !== undefined) shipOpts.maxParallelism = opts.parallel;
  if (opts.noCommit) shipOpts.noCommit = true;

  let summary: RunSummary;
  try {
    summary = await runShip(projectRoot, shipOpts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`reins ship: ${msg}`);
    process.exitCode = 1;
    return;
  }

  printSummary(summary, Boolean(opts.dryRun));

  if (summary.totals.blocked > 0) {
    process.exitCode = 1;
  }
}

function printSummary(summary: RunSummary, dryRun: boolean): void {
  const { totals, features } = summary;

  console.log('');
  if (dryRun) {
    console.log(`Reins ship — dry run (${summary.id})`);
    console.log('');
    console.log('Plan written to: .reins/runs/' + summary.id + '/plan.json');
    console.log('No subprocesses were spawned. Re-run without --dry-run to execute.');
    return;
  }

  console.log(`Reins ship — ${summary.id}`);
  console.log(`Duration: ${formatDuration(totals.duration_ms)}`);
  console.log(`Features: ${totals.done} done, ${totals.blocked} blocked`);
  console.log('');

  if (features.length === 0) {
    console.log('No todo features in queue.');
    console.log('Add one with: reins feature new <id>');
    return;
  }

  const done = features.filter(f => f.status === 'done');
  const blocked = features.filter(f => f.status === 'blocked');

  if (done.length > 0) {
    console.log('Done:');
    for (const r of done) {
      const sha = r.commit_sha ? ` (${r.commit_sha.slice(0, 8)})` : '';
      console.log(`  ✓ ${r.id}${sha} — ${r.attempts} attempt(s), ${formatDuration(r.duration_ms)}`);
    }
    console.log('');
  }

  if (blocked.length > 0) {
    console.log('Blocked:');
    for (const r of blocked) {
      console.log(`  ✗ ${r.id} — ${r.attempts} attempt(s), ${formatDuration(r.duration_ms)}`);
      if (r.failure) {
        console.log(`      stage:   ${r.failure.stage}`);
        console.log(`      command: ${r.failure.command}`);
        const tail = r.failure.output.split('\n').slice(-5).join('\n        ');
        console.log(`      output:  ${tail}`);
      }
    }
    console.log('');
    console.log(`Review logs in .reins/runs/${summary.id}/<feature>/attempt-N/`);
    console.log('Blocked features stay in the queue — rerun `reins ship` to retry.');
  } else if (done.length > 0) {
    console.log('All features shipped. Review the diff and push when ready.');
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m${remaining}s`;
}
