import { exec } from 'node:child_process';
import type { QAResult, CommandResult } from './types.js';

export interface QAConfig {
  pre_commit: string[];
  post_develop: string[];
}

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

export async function runQA(projectRoot: string, qaConfig: QAConfig): Promise<QAResult> {
  const commands = [...qaConfig.pre_commit, ...qaConfig.post_develop];

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
