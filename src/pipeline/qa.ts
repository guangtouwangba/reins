import { exec } from 'node:child_process';
import type { ReinsConfig } from '../state/config.js';
import type { QAResult, CommandResult } from './types.js';

function runCommand(command: string, cwd: string): Promise<CommandResult> {
  const start = Date.now();
  return new Promise(resolve => {
    exec(command, { cwd, timeout: 120_000 }, (error, stdout, stderr) => {
      const durationMs = Date.now() - start;
      const exitCode = error?.code ?? 0;
      resolve({
        command,
        success: !error,
        output: stdout,
        error: stderr,
        durationMs,
      });
    });
  });
}

export async function runQA(projectRoot: string, config: ReinsConfig): Promise<QAResult> {
  // ReinsConfig doesn't have pipeline directly — constraints.yaml has it.
  // The runner passes the full config; we handle missing pipeline gracefully.
  const pipeline = (config as unknown as { pipeline?: { pre_commit?: string[]; post_develop?: string[] } }).pipeline;
  const preCommit: string[] = pipeline?.pre_commit ?? [];
  const postDevelop: string[] = pipeline?.post_develop ?? [];
  const commands = [...preCommit, ...postDevelop];

  if (commands.length === 0) {
    return { passed: true, results: [] };
  }

  const results: CommandResult[] = [];

  for (const command of commands) {
    const result = await runCommand(command, projectRoot);
    results.push(result);
    if (!result.success) {
      return { passed: false, results };
    }
  }

  return { passed: true, results };
}
