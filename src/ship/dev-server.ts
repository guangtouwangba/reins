import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { ChildProcess } from 'node:child_process';
import type { BrowserVerifyConfig, DevServerConfig, ConstraintsConfig } from '../constraints/schema.js';
import { buildDevServerDiscoveryPrompt } from './prompt-builder.js';
import type { ClaudeRunOptions, ClaudeRunResult } from './types.js';

/**
 * Handle returned by `startDevServer`. Carries enough state for the
 * caller to later stop the process cleanly via `stopDevServer(handle)`.
 */
export interface DevServerHandle {
  pid: number | undefined;
  child: ChildProcess;
  command: string;
  stop: () => void;
}

/**
 * Start the dev server as a detached background process. Does NOT
 * wait for the server to be ready — call `waitForUrl` with the
 * configured `wait_for_url` afterwards to block until it's healthy.
 *
 * Detached so Ctrl+C on the parent reins process doesn't accidentally
 * orphan the server inside a pgroup we can't kill. The returned
 * `stop()` callback is idempotent — safe to call multiple times in a
 * finally block.
 */
export function startDevServer(
  config: DevServerConfig,
  cwd: string,
  env?: Record<string, string>,
): DevServerHandle {
  const child = spawn('sh', ['-c', config.command], {
    cwd,
    env: { ...process.env, ...(env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  // Swallow stdout/stderr so chatty servers don't flood reins's own
  // console. A real debug path would pipe them to a log file; for v1
  // we just drop them.
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', () => {});
  // Suppress unhandled 'error' events so a failed spawn doesn't crash ship.
  child.on('error', () => {});

  const signal = config.kill_signal ?? 'SIGTERM';
  let stopped = false;
  let killTimer: NodeJS.Timeout | undefined;

  // Clear the escalation timer as soon as the child actually exits
  // (natural or via our SIGTERM). Without this the timer fires on a
  // dead pgroup 5s later and spams stderr from the kill(2) ENOENT.
  child.once('exit', () => {
    if (killTimer) {
      clearTimeout(killTimer);
      killTimer = undefined;
    }
  });

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    try {
      if (child.pid !== undefined && !child.killed) {
        // Kill the whole process group (negative pid) so the dev
        // server's child processes (next dev → next build → node) also
        // die. A plain child.kill() leaves grandchildren orphaned.
        try {
          process.kill(-child.pid, signal);
        } catch {
          // fall back to the direct child kill if the pgroup doesn't exist
          child.kill(signal);
        }
        // Escalate to SIGKILL after a short grace period if still alive.
        killTimer = setTimeout(() => {
          if (child.killed) return;
          try {
            if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
          } catch {
            try { child.kill('SIGKILL'); } catch { /* gone */ }
          }
        }, 5000);
        killTimer.unref();
      }
    } catch {
      // Non-fatal — if the process is already gone, stop() is a no-op.
    }
  };

  return { pid: child.pid, child, command: config.command, stop };
}

/**
 * Idempotent stop helper. Prefer calling `handle.stop()` directly; this
 * wrapper exists for symmetry with `startDevServer` in import lists and
 * for tests that inject different DevServerHandle shapes.
 */
export function stopDevServer(handle: Pick<DevServerHandle, 'stop'>): void {
  handle.stop();
}

/**
 * Dependency hook for `waitForUrl`. Defaults to the platform `fetch`.
 * Tests inject a fake that counts calls and returns canned responses.
 */
export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number }>;

/**
 * Poll `url` until it responds with any HTTP status (2xx/3xx/4xx all
 * count as "server is answering"). Returns `true` on first response,
 * `false` when `timeoutMs` elapses.
 *
 * 4xx counts as healthy because many dev servers return 404 on `/`
 * before the route table is loaded; we just want to know the TCP
 * listener is up and the HTTP layer is serving SOMETHING.
 */
export async function waitForUrl(
  url: string,
  timeoutMs: number,
  deps: { fetch?: FetchLike; sleep?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const fetchFn: FetchLike = deps.fetch ?? defaultFetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise(r => setTimeout(r, ms)));

  const deadline = Date.now() + timeoutMs;
  const pollInterval = 250;

  while (Date.now() < deadline) {
    try {
      const res = await fetchFn(url);
      if (res.status >= 200 && res.status < 500) return true;
    } catch {
      // Server not up yet — sleep and retry.
    }
    if (Date.now() + pollInterval >= deadline) break;
    await sleep(pollInterval);
  }
  return false;
}

async function defaultFetch(url: string): Promise<{ ok: boolean; status: number }> {
  const res = await globalThis.fetch(url, { method: 'GET' });
  return { ok: res.ok, status: res.status };
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export interface DiscoverDevServerDeps {
  spawn?: (prompt: string, opts: ClaudeRunOptions) => Promise<ClaudeRunResult>;
  timeoutMs?: number;
}

/**
 * Ask headless Claude Code to identify how to start this project's
 * dev server. On success the returned config is also persisted back
 * to `.reins/constraints.yaml` under `pipeline.browser_verify.dev_server`
 * so subsequent ships reuse it instead of re-asking.
 *
 * Returns `null` on any failure: spawn error, invalid JSON, missing
 * required fields, constraints.yaml unreadable, the model explicitly
 * returning `null`. Never throws. Never partially-persists.
 */
export async function discoverDevServer(
  projectRoot: string,
  runDir: string,
  deps: DiscoverDevServerDeps = {},
): Promise<DevServerConfig | null> {
  // Lazy import so tests that don't exercise discovery don't drag the
  // real spawn into their module graph.
  const { spawnClaudeHeadless } = await import('./claude-spawn.js');
  const spawnFn = deps.spawn ?? spawnClaudeHeadless;

  const prompt = buildDevServerDiscoveryPrompt(projectRoot);
  let claudeResult: ClaudeRunResult;
  try {
    claudeResult = await spawnFn(prompt, {
      cwd: projectRoot,
      timeoutMs: deps.timeoutMs ?? 120_000,
      logDir: runDir,
    });
  } catch {
    return null;
  }

  if (claudeResult.exitCode !== 0) return null;

  const parsed = parseDevServerResponse(claudeResult.stdout);
  if (!parsed) return null;

  // Persistence failure is non-fatal: we still return the discovered
  // config for THIS run. The next run will re-discover because nothing
  // got saved. `persistDevServerConfig` never throws, so ignore its
  // return value — there's no recovery path and the alternative is
  // silently dropping the discovery for the current attempt.
  persistDevServerConfig(projectRoot, parsed);
  return parsed;
}

function parseDevServerResponse(stdout: string): DevServerConfig | null {
  if (!stdout) return null;
  const candidate = extractJsonObject(stdout);
  if (!candidate) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }

  // Model may explicitly return null to mean "no dev server in this project"
  if (parsed === null) return null;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const obj = parsed as Record<string, unknown>;
  const command = obj['command'];
  const waitForUrl = obj['wait_for_url'];
  const timeoutMs = obj['timeout_ms'];

  if (typeof command !== 'string' || command.trim() === '') return null;
  if (typeof waitForUrl !== 'string' || waitForUrl.trim() === '') return null;
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return null;

  return {
    command,
    wait_for_url: waitForUrl,
    timeout_ms: timeoutMs,
  };
}

function extractJsonObject(text: string): string | null {
  // Fenced block has priority — models often ignore "no fences" instructions.
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/i.exec(text);
  if (fenced && fenced[1]) return fenced[1].trim();

  // Otherwise scan for the first balanced top-level `{...}`.
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Merge a discovered DevServerConfig into
 * `.reins/constraints.yaml → pipeline.browser_verify.dev_server`,
 * preserving all other fields in the file (constraints, other
 * pipeline settings, comments YAML-parser can't preserve, whatever).
 *
 * Returns true on successful write, false on any failure. Never
 * throws — the caller decides whether persistence failure matters.
 */
function persistDevServerConfig(projectRoot: string, config: DevServerConfig): boolean {
  const path = join(projectRoot, '.reins', 'constraints.yaml');
  if (!existsSync(path)) return false;

  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = yaml.load(raw) as ConstraintsConfig | null;
    if (!parsed || typeof parsed !== 'object') return false;

    const pipeline = (parsed.pipeline ?? {}) as ConstraintsConfig['pipeline'];
    const existingBrowserVerify = (pipeline.browser_verify ?? {
      command: '',
      spec_dir: '',
    }) as BrowserVerifyConfig;

    const merged: ConstraintsConfig = {
      ...parsed,
      pipeline: {
        ...pipeline,
        browser_verify: {
          ...existingBrowserVerify,
          dev_server: config,
        },
      },
    };

    writeFileSync(path, yaml.dump(merged, { lineWidth: 120, quotingType: '"' }), 'utf-8');
    return true;
  } catch {
    return false;
  }
}
