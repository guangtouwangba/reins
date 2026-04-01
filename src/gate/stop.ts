import { execSync } from 'node:child_process';
import type { GateInput, GateResult } from './types.js';
import { loadConstraints } from './shared.js';
import { loadConfig } from '../state/config.js';
import { generateId, generateFilename, saveEntry } from '../knowledge/store.js';
import type { KnowledgeEntry } from '../knowledge/types.js';

interface CapturedKnowledge {
  type: KnowledgeEntry['type'];
  summary: string;
  files: string[];
  confidence: number;
}

export async function gateStop(projectRoot: string, _input: GateInput): Promise<GateResult> {
  const result: GateResult = { action: 'allow', messages: [] };
  const config = loadConfig(projectRoot);
  const gateConfig = config.gate ?? {};

  // 1. L0 Static checks (lint + typecheck, skip test by default)
  const constraints = loadConstraints(projectRoot);

  // Only run L0 checks if constraints exist (project is initialized)
  if (constraints.length > 0) {
    const l0Failures: string[] = [];

    // Try lint (skip if configured)
    if (!gateConfig.stop_skip_lint) {
      try {
        execSync('npm run lint 2>&1 || pnpm lint 2>&1 || yarn lint 2>&1', {
          cwd: projectRoot, encoding: 'utf-8', timeout: 30000, stdio: 'pipe',
        });
      } catch (err) {
        const output = err instanceof Error && 'stdout' in err ? String((err as NodeJS.ErrnoException & { stdout: unknown }).stdout) : '';
        // Only count as failure if lint script exists (not "missing script" error)
        if (!output.includes('Missing script') && !output.includes('not found')) {
          l0Failures.push(`lint: ${output.slice(0, 200)}`);
        }
      }
    }

    // Try typecheck
    try {
      execSync('npm run typecheck 2>&1 || pnpm typecheck 2>&1 || yarn typecheck 2>&1', {
        cwd: projectRoot, encoding: 'utf-8', timeout: 30000, stdio: 'pipe',
      });
    } catch (err) {
      const output = err instanceof Error && 'stdout' in err ? String((err as NodeJS.ErrnoException & { stdout: unknown }).stdout) : '';
      if (!output.includes('Missing script') && !output.includes('not found')) {
        l0Failures.push(`typecheck: ${output.slice(0, 200)}`);
      }
    }

    if (l0Failures.length > 0) {
      return {
        action: 'block',
        messages: [],
        blockReason: `reins [block] L0 verification failed:\n${l0Failures.map(f => `  - ${f}`).join('\n')}`,
      };
    }
  }

  // 2. Auto-capture knowledge from git diff
  const captured = captureKnowledgeFromDiff(projectRoot);
  if (captured.length > 0) {
    result.messages.push('');
    result.messages.push(`[Reins] Captured ${captured.length} knowledge entries:`);
    for (const entry of captured) {
      result.messages.push(`  - [${entry.type}] ${entry.summary}`);
    }
  }

  return result;
}

function captureKnowledgeFromDiff(projectRoot: string): CapturedKnowledge[] {
  const captured: CapturedKnowledge[] = [];

  let diff: string;
  try {
    diff = execSync('git diff --cached --name-only 2>/dev/null || git diff --name-only 2>/dev/null', {
      cwd: projectRoot, encoding: 'utf-8', timeout: 5000, stdio: 'pipe',
    }).trim();
  } catch {
    return captured;
  }

  if (!diff) return captured;

  const changedFiles = diff.split('\n').filter(Boolean);

  // Detect coupling: files from different modules changed together
  const modules = new Map<string, string[]>();
  for (const file of changedFiles) {
    const parts = file.split('/');
    const module = parts.length >= 2 ? parts.slice(0, 2).join('/') : parts[0]!;
    if (!modules.has(module)) modules.set(module, []);
    modules.get(module)!.push(file);
  }
  if (modules.size >= 2) {
    const moduleNames = [...modules.keys()];
    captured.push({
      type: 'coupling',
      summary: `${moduleNames.join(' and ')} were modified together`,
      files: changedFiles,
      confidence: 50,
    });
  }

  // Detect decisions: dependency changes
  for (const file of changedFiles) {
    if (file === 'package.json' || file === 'go.mod' || file === 'Cargo.toml' || file === 'requirements.txt') {
      captured.push({
        type: 'decision',
        summary: `Dependencies changed in ${file}`,
        files: [file],
        confidence: 40,
      });
    }
  }

  // Save captured entries to knowledge store
  const now = new Date().toISOString();
  for (const c of captured) {
    try {
      const id = generateId(projectRoot);
      const file = generateFilename(c.type, c.summary);
      const entry: KnowledgeEntry = {
        id,
        type: c.type,
        summary: c.summary,
        detail: '',
        source: 'reflection',
        confidence: c.confidence,
        related_files: c.files,
        tags: [],
        created: now,
        last_validated: now,
        last_injected: now,
        injection_outcomes: { success: 0, failure: 0 },
        file,
      };
      saveEntry(projectRoot, entry);
    } catch {
      // Knowledge save failure is non-fatal
    }
  }

  return captured;
}
