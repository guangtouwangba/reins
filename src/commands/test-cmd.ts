import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

interface HookTestResult {
  hookId: string;
  hookPath: string;
  exists: boolean;
  executable: boolean;
  syntheticPass: 'ok' | 'error' | 'skipped';
  verdict: 'healthy' | 'broken' | 'disabled';
}

function isExecutable(filePath: string): boolean {
  try {
    const stat = statSync(filePath);
    // Check owner execute bit
    return (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function runHookSynthetic(hookPath: string): 'ok' | 'error' {
  const result = spawnSync(hookPath, [], {
    input: JSON.stringify({ event: 'test', files: [] }),
    encoding: 'utf-8',
    timeout: 5000,
    env: { ...process.env, CLAUDE_HOOK_DATA: JSON.stringify({ event: 'test', files: [] }) },
  });

  if (result.error) return 'error';
  // For synthetic healthy test, exit 0 means ok
  return result.status === 0 ? 'ok' : 'error';
}

export async function runTest(): Promise<void> {
  const projectRoot = process.cwd();
  const hooksDir = join(projectRoot, '.reins', 'hooks');

  if (!existsSync(hooksDir)) {
    console.log('No .reins/hooks/ directory found. Run `reins init` first.');
    return;
  }

  let entries: string[];
  try {
    entries = readdirSync(hooksDir).filter(f => f.endsWith('.sh'));
  } catch {
    console.log('Could not read hooks directory.');
    return;
  }

  if (entries.length === 0) {
    console.log('No hook scripts found in .reins/hooks/.');
    return;
  }

  const results: HookTestResult[] = [];

  for (const entry of entries) {
    const hookPath = join(hooksDir, entry);
    const hookId = entry.replace('.sh', '');
    const exists = existsSync(hookPath);
    const executable = exists && isExecutable(hookPath);

    let syntheticPass: 'ok' | 'error' | 'skipped' = 'skipped';
    let verdict: 'healthy' | 'broken' | 'disabled' = 'broken';

    if (!exists) {
      verdict = 'broken';
    } else if (!executable) {
      verdict = 'broken';
    } else {
      syntheticPass = runHookSynthetic(hookPath);
      verdict = syntheticPass === 'ok' ? 'healthy' : 'broken';
    }

    results.push({ hookId, hookPath, exists, executable, syntheticPass, verdict });
  }

  // Print results table
  console.log('Hook Test Results');
  console.log('=================');
  console.log('');
  console.log(`${'Hook'.padEnd(35)} ${'Exists'.padEnd(8)} ${'Exec'.padEnd(6)} ${'Synthetic'.padEnd(10)} ${'Verdict'}`);
  console.log('-'.repeat(75));

  let anyBroken = false;
  for (const r of results) {
    if (r.verdict === 'broken') anyBroken = true;
    const exists = r.exists ? 'yes' : 'NO';
    const exec = r.executable ? 'yes' : 'NO';
    const verdict = r.verdict === 'healthy' ? 'healthy' : r.verdict === 'disabled' ? 'disabled' : 'BROKEN';
    console.log(`${r.hookId.padEnd(35)} ${exists.padEnd(8)} ${exec.padEnd(6)} ${r.syntheticPass.padEnd(10)} ${verdict}`);
  }

  console.log('');
  if (anyBroken) {
    console.log(`Some hooks are broken. Run 'reins hook fix' to repair them.`);
    process.exitCode = 1;
  } else {
    console.log('All hooks healthy.');
  }
}
