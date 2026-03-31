import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';

export interface EnvironmentStartConfig {
  command: string;
  port: number;
  health_check: string;
  startup_timeout: number;
}

export interface EnvironmentDetection {
  command: string | null;
  port: number | null;
  healthEndpoint: string | null;
  detected: boolean;
}

export interface ServiceHandle {
  process: ChildProcess;
  port: number;
  healthUrl: string;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export function detectEnvironment(projectRoot: string): EnvironmentDetection {
  const pkgPath = join(projectRoot, 'package.json');
  if (!existsSync(pkgPath)) {
    return { command: null, port: null, healthEndpoint: null, detected: false };
  }

  let pkg: { scripts?: Record<string, string> } = {};
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { scripts?: Record<string, string> };
  } catch {
    return { command: null, port: null, healthEndpoint: null, detected: false };
  }

  const scripts = pkg.scripts ?? {};
  let command: string | null = null;

  // Prefer dev > start > serve
  for (const key of ['dev', 'start', 'serve']) {
    const val = scripts[key];
    if (val && !val.trim().startsWith('echo')) {
      command = `pnpm run ${key}`;
      break;
    }
  }

  // Try to detect port from common environment patterns
  let port: number | null = null;
  for (const val of Object.values(scripts)) {
    const portMatch = val.match(/PORT[=\s]+(\d{4,5})/);
    if (portMatch) {
      port = parseInt(portMatch[1] ?? '3000', 10);
      break;
    }
  }
  if (!port) port = 3000; // default

  const healthEndpoint = `http://localhost:${port}/health`;

  return {
    command,
    port,
    healthEndpoint,
    detected: command !== null,
  };
}

// ---------------------------------------------------------------------------
// Service lifecycle
// ---------------------------------------------------------------------------

async function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  const interval = 500;

  while (Date.now() - start < timeoutMs) {
    try {
      // Use dynamic import to support ESM; fall back gracefully if unavailable
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  return false;
}

export async function startService(config: EnvironmentStartConfig): Promise<ServiceHandle | null> {
  const parts = config.command.split(' ');
  const cmd = parts[0] ?? '';
  const args = parts.slice(1);

  if (!cmd) return null;

  const proc = spawn(cmd, args, {
    stdio: 'pipe',
    detached: false,
  });

  const healthy = await waitForHealth(config.health_check, config.startup_timeout * 1000);
  if (!healthy) {
    proc.kill('SIGTERM');
    return null;
  }

  return {
    process: proc,
    port: config.port,
    healthUrl: config.health_check,
  };
}

export function stopService(handle: ServiceHandle): void {
  try {
    handle.process.kill('SIGTERM');
  } catch {
    // already stopped
  }
}
