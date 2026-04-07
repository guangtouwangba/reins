import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { GateInput, GateResult } from './types.js';
import type { ConstraintsConfig } from '../constraints/schema.js';
import { loadConfig } from '../state/config.js';
import { generateId, generateFilename, saveEntry } from '../knowledge/store.js';
import type { KnowledgeEntry } from '../knowledge/types.js';

interface CapturedKnowledge {
  type: KnowledgeEntry['type'];
  summary: string;
  files: string[];
  confidence: number;
}

/**
 * Load `pipeline.pre_commit` commands from constraints.yaml. Returns an empty
 * array when the file is absent, unreadable, or has no pre_commit entries.
 *
 * These commands are written by the AI during `/reins-setup` (see
 * `.reins/SETUP.prompt.md`). The gate is intentionally dumb: it does not
 * guess what to run based on package.json, monorepo layout, or stack
 * detection. If you want verification at Stop, configure it in
 * constraints.yaml.
 */
function loadPreCommitCommands(projectRoot: string): string[] {
  const path = join(projectRoot, '.reins', 'constraints.yaml');
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = yaml.load(raw) as ConstraintsConfig | null;
    return parsed?.pipeline?.pre_commit ?? [];
  } catch {
    return [];
  }
}

interface CommandFailure {
  cmd: string;
  output: string;
}

function runShellCommand(cmd: string, cwd: string): { ok: true } | { ok: false; output: string } {
  try {
    execSync(cmd, { cwd, encoding: 'utf-8', timeout: 60_000, stdio: 'pipe', shell: '/bin/sh' });
    return { ok: true };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: unknown; stderr?: unknown };
    const stdout = typeof e.stdout === 'string' ? e.stdout : '';
    const stderr = typeof e.stderr === 'string' ? e.stderr : '';
    const combined = `${stdout}\n${stderr}`.trim() || (e.message ?? 'unknown error');
    return { ok: false, output: combined.slice(0, 800) };
  }
}

export async function gateStop(projectRoot: string, _input: GateInput): Promise<GateResult> {
  const result: GateResult = { action: 'allow', messages: [] };

  // Synthetic health-check from `reins test`: just prove the script runs.
  // Don't kick off any project commands or git-diff capture.
  if (process.env.REINS_GATE_SYNTHETIC === '1') {
    return result;
  }

  const config = loadConfig(projectRoot);
  const gateConfig = config.gate ?? {};

  // 1. L0 verification — run whatever pipeline.pre_commit specifies, verbatim.
  //
  // If the user (or `/reins-setup`) hasn't populated pre_commit yet, we run
  // nothing. That's deliberate: we'd rather let agents keep working than
  // false-block on heuristic guesses about lint/typecheck commands.
  if (!gateConfig.stop_skip_lint) {
    const commands = loadPreCommitCommands(projectRoot);
    const failures: CommandFailure[] = [];

    for (const cmd of commands) {
      const res = runShellCommand(cmd, projectRoot);
      if (!res.ok) failures.push({ cmd, output: res.output });
    }

    if (failures.length > 0) {
      const lines = failures.map(f => `  $ ${f.cmd}\n${indent(f.output, '    ')}`);
      return {
        action: 'block',
        messages: [],
        blockReason: `reins [block] L0 verification failed:\n${lines.join('\n\n')}`,
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

function indent(text: string, prefix: string): string {
  return text.split('\n').map(line => prefix + line).join('\n');
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
