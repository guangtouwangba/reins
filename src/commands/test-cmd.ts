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
    timeout: 30_000,
    env: {
      ...process.env,
      CLAUDE_HOOK_DATA: JSON.stringify({ event: 'test', files: [] }),
      // Signal to gate implementations that this is a synthetic health-check,
      // not a real tool event. Gates that run expensive work (lint, typecheck,
      // git diff capture) should short-circuit on this flag.
      REINS_GATE_SYNTHETIC: '1',
    },
  });

  // Spawn failure (ENOENT, permission denied, timeout, etc.) = truly broken.
  if (result.error) return 'error';

  // Reins gate exit code protocol:
  //   0 = allow   → hook ran cleanly
  //   2 = block   → hook ran cleanly and made a policy decision
  // Any other code (1, 127, 139, ...) means the script itself crashed.
  // Both 0 and 2 mean "the hook is healthy as a script".
  if (result.status === 0 || result.status === 2) return 'ok';
  return 'error';
}

export async function runTest(): Promise<void> {
  const projectRoot = process.cwd();
  const hooksDir = join(projectRoot, '.reins', 'hooks');

  if (!existsSync(hooksDir)) {
    console.log('No hooks configured yet.');
    console.log('');
    console.log('Hooks are generated during init. Run: reins init');
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
    console.log('');
    console.log('Run reins init to generate hooks from constraints.');
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
    console.log(`Some hooks need attention. Check the scripts in .reins/hooks/ for issues.`);
    console.log('To disable a broken hook: reins hook disable <id>');
    process.exitCode = 1;
  } else {
    console.log('All hooks healthy.');
  }
}
