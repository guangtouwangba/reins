import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import yaml from 'js-yaml';
import type { StackInfo } from '../scanner/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillEntry {
  name: string;
  content: string;
  qualityScore: number;
  scope?: string;
  stack?: string[];
  source?: string;
  file?: string;
}

export interface GlobalSkill extends SkillEntry {
  primaryStack: string;
  extractedFrom: string;
  extractedAt: string;
}

// ---------------------------------------------------------------------------
// Global skills directory
// ---------------------------------------------------------------------------

function getGlobalSkillsDir(): string {
  return join(homedir(), '.reins', 'global-skills');
}

// ---------------------------------------------------------------------------
// extractGlobalSkills
// ---------------------------------------------------------------------------

export function extractGlobalSkills(projectRoot: string, skills: SkillEntry[]): GlobalSkill[] {
  const globalDir = getGlobalSkillsDir();
  const extracted: GlobalSkill[] = [];

  // Filter eligible skills: quality >= 95, scope 'project' or unset
  const eligible = skills.filter(
    s => s.qualityScore >= 95 && (!s.scope || s.scope === 'project'),
  );

  for (const skill of eligible) {
    // Check for project-specific path references
    if (hasProjectSpecificPaths(projectRoot, skill.content)) continue;

    const primaryStack = (skill.stack?.[0] ?? 'general').toLowerCase().replace(/[^a-z0-9]/g, '-');
    const globalSkill: GlobalSkill = {
      ...skill,
      primaryStack,
      source: 'global',
      extractedFrom: projectRoot,
      extractedAt: new Date().toISOString(),
    };

    // Write to ~/.reins/global-skills/<primaryStack>/<skill-name>.yaml
    const stackDir = join(globalDir, primaryStack);
    mkdirSync(stackDir, { recursive: true });

    const safeName = skill.name.replace(/[^a-z0-9-_]/gi, '-').toLowerCase().slice(0, 60);
    const filePath = join(stackDir, `${safeName}.yaml`);
    writeFileSync(filePath, yaml.dump(globalSkill, { lineWidth: 120 }), 'utf-8');

    extracted.push(globalSkill);
  }

  // Append to transfer log
  if (extracted.length > 0) {
    appendTransferLog(extracted);
  }

  return extracted;
}

// ---------------------------------------------------------------------------
// matchGlobalSkills
// ---------------------------------------------------------------------------

export function matchGlobalSkills(
  context: { stack: StackInfo },
  globalSkills: GlobalSkill[],
): GlobalSkill[] {
  const projectLanguages = context.stack.language.map(l => l.toLowerCase());
  const projectFrameworks = context.stack.framework.map(f => f.toLowerCase());

  return globalSkills.filter(skill => {
    if (!skill.stack || skill.stack.length === 0) return true; // universal skills

    const skillStack = skill.stack.map(s => s.toLowerCase());
    return skillStack.some(
      s => projectLanguages.includes(s) || projectFrameworks.includes(s),
    );
  });
}

// ---------------------------------------------------------------------------
// loadGlobalSkills
// ---------------------------------------------------------------------------

export function loadGlobalSkills(primaryStack?: string): GlobalSkill[] {
  const globalDir = getGlobalSkillsDir();
  if (!existsSync(globalDir)) return [];

  const skills: GlobalSkill[] = [];

  const stackDirs = primaryStack
    ? [join(globalDir, primaryStack)]
    : readdirSync(globalDir).map(d => join(globalDir, d));

  for (const stackDir of stackDirs) {
    if (!existsSync(stackDir)) continue;

    let files: string[];
    try {
      files = readdirSync(stackDir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
      try {
        const raw = readFileSync(join(stackDir, file), 'utf-8');
        const parsed = yaml.load(raw) as GlobalSkill | null;
        if (parsed && typeof parsed === 'object' && parsed.name) {
          skills.push(parsed);
        }
      } catch {
        // skip
      }
    }
  }

  return skills;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasProjectSpecificPaths(projectRoot: string, content: string): boolean {
  // Check if content references the project root directly
  if (content.includes(projectRoot)) return true;

  // Heuristic: absolute paths that aren't typical global paths
  const absolutePathPattern = /(?:^|\s)(\/(?:home|Users|workspace|projects|code|dev)\/\S+)/gm;
  return absolutePathPattern.test(content);
}

function appendTransferLog(skills: GlobalSkill[]): void {
  const logPath = join(homedir(), '.reins', 'transfer-log.json');
  const logDir = join(homedir(), '.reins');
  mkdirSync(logDir, { recursive: true });

  let existing: unknown[] = [];
  if (existsSync(logPath)) {
    try {
      const raw = readFileSync(logPath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown[];
      if (Array.isArray(parsed)) existing = parsed;
    } catch {
      // start fresh
    }
  }

  const entries = skills.map(s => ({
    name: s.name,
    primaryStack: s.primaryStack,
    extractedFrom: s.extractedFrom,
    extractedAt: s.extractedAt,
  }));

  writeFileSync(logPath, JSON.stringify([...existing, ...entries], null, 2), 'utf-8');
}
