import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClaudeRunOptions, ClaudeRunResult } from './types.js';

/**
 * Spawn a headless Claude Code subprocess to implement a feature.
 *
 * Contract:
 * - Never throws — all errors surface via `exitCode`, `timedOut`, or an
 *   empty `stdout`/`stderr`. The ship runner decides retry vs block.
 * - Writes a full attempt log to `opts.logDir/claude-<epochMs>.log`
 *   containing exit code, duration, prompt, stdout, and stderr. This is
 *   what the user reads when debugging a blocked feature.
 * - Propagates `opts.signal` abort to the child via SIGTERM → SIGKILL
 *   escalation (same as timeout handling).
 * - Best-effort token usage parsing from stdout tail; unparseable output
 *   yields `tokenUsage: undefined`, never an error.
 *
 * The default binary is `'claude'` and default args are `['-p', prompt]`.
 * Tests override both via `opts.binary` and `opts.buildArgs` to drive the
 * wrapper with a stand-in process without mocking `node:child_process`.
 */
export async function spawnClaudeHeadless(
  prompt: string,
  opts: ClaudeRunOptions,
): Promise<ClaudeRunResult> {
  const binary = opts.binary ?? 'claude';
  const buildArgs = opts.buildArgs ?? ((p: string) => ['-p', p]);
  const args = buildArgs(prompt);

  const startedAt = Date.now();

  return new Promise<ClaudeRunResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(binary, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...(opts.env ?? {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      const result: ClaudeRunResult = {
        exitCode: -1,
        stdout: '',
        stderr: `spawn error: ${message}`,
        durationMs,
        timedOut: false,
        tokenUsage: undefined,
      };
      writeAttemptLog(opts.logDir, startedAt, binary, args, prompt, result);
      resolve(result);
      return;
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // Handle spawn failure (ENOENT, EACCES, …) via 'error' event.
    child.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      opts.signal?.removeEventListener('abort', onAbort);
      const durationMs = Date.now() - startedAt;
      const result: ClaudeRunResult = {
        exitCode: -1,
        stdout,
        stderr: stderr + (stderr ? '\n' : '') + `spawn error: ${err.message}`,
        durationMs,
        timedOut,
        tokenUsage: parseTokenUsage(stdout),
      };
      writeAttemptLog(opts.logDir, startedAt, binary, args, prompt, result);
      resolve(result);
    });

    let killTimer: NodeJS.Timeout | undefined;
    const kill = () => {
      if (!child.killed) {
        child.kill('SIGTERM');
        // Force-detach the captured streams. Without this, an orphan
        // grandchild that inherited the child's stdio (e.g. `sh -c
        // "sleep 60; …"` where sleep keeps running after sh dies) holds
        // the streams open and the 'close' event never fires.
        child.stdout?.destroy();
        child.stderr?.destroy();
        // Escalate to SIGKILL after 5s if the process itself is still
        // running. `.unref()` so this timer never blocks process exit.
        killTimer = setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 5000);
        killTimer.unref();
      }
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs);

    const onAbort = () => kill();
    opts.signal?.addEventListener('abort', onAbort);

    // Listen on 'close' (fires after stdio streams flush) rather than
    // 'exit' (fires while streams may still be draining). This ensures
    // captured stdout/stderr are complete for chatty children.
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      if (killTimer) clearTimeout(killTimer);
      opts.signal?.removeEventListener('abort', onAbort);
      const durationMs = Date.now() - startedAt;
      // Signal kills leave `code` null; normalize to -1 so the field stays numeric.
      const exitCode = typeof code === 'number' ? code : -1;
      const result: ClaudeRunResult = {
        exitCode,
        stdout,
        stderr,
        durationMs,
        timedOut,
        tokenUsage: parseTokenUsage(stdout),
      };
      writeAttemptLog(opts.logDir, startedAt, binary, args, prompt, result);
      resolve(result);
    });
  });
}

/**
 * Best-effort parse of token usage from a Claude Code `-p` run's stdout
 * tail. The output format is unstable across releases, so any parse
 * failure returns `undefined` — never throws, never breaks ship.
 *
 * Accepts common shapes we've observed:
 *   - "Input: 1234 tokens  Output: 567 tokens"
 *   - "input_tokens: 1234, output_tokens: 567"
 *   - "1234 input, 567 output"
 */
export function parseTokenUsage(
  text: string,
): { input: number; output: number } | undefined {
  if (!text) return undefined;
  const tail = text.slice(-4000);

  const patterns: Array<RegExp> = [
    /input[_\s]*tokens?[^\d]*(\d+)[\s\S]*?output[_\s]*tokens?[^\d]*(\d+)/i,
    /input[^\d]*(\d+)[\s\S]*?output[^\d]*(\d+)/i,
    /(\d+)\s*input[\s\S]*?(\d+)\s*output/i,
  ];

  for (const re of patterns) {
    const m = re.exec(tail);
    if (m && m[1] && m[2]) {
      const input = Number(m[1]);
      const output = Number(m[2]);
      if (Number.isFinite(input) && Number.isFinite(output)) {
        return { input, output };
      }
    }
  }
  return undefined;
}

function writeAttemptLog(
  logDir: string,
  startedAt: number,
  binary: string,
  args: string[],
  prompt: string,
  result: ClaudeRunResult,
): void {
  try {
    const path = join(logDir, `claude-${startedAt}.log`);
    const lines: string[] = [];
    lines.push(`BINARY: ${binary}`);
    lines.push(`ARGS: ${JSON.stringify(args)}`);
    lines.push(`EXIT: ${result.exitCode}`);
    lines.push(`DURATION_MS: ${result.durationMs}`);
    lines.push(`TIMED_OUT: ${result.timedOut}`);
    if (result.tokenUsage) {
      lines.push(`TOKENS_IN: ${result.tokenUsage.input}`);
      lines.push(`TOKENS_OUT: ${result.tokenUsage.output}`);
    }
    lines.push('');
    lines.push('--- PROMPT ---');
    lines.push(prompt);
    lines.push('');
    lines.push('--- STDOUT ---');
    lines.push(result.stdout);
    lines.push('');
    lines.push('--- STDERR ---');
    lines.push(result.stderr);
    writeFileSync(path, lines.join('\n'), 'utf-8');
  } catch {
    // Logging failure is non-fatal — the run result is still returned.
  }
}
