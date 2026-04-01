import { readFileSync, existsSync } from 'node:fs';
import type { CodebaseContext } from '../scanner/types.js';
import type { SkillEntry, SkillIndex, ScoredSkill } from '../scanner/skill-types.js';

interface MatchConfig {
  max_tokens: number;
  max_skills: number;
}

export function matchSkills(
  task: string,
  context: CodebaseContext,
  index: SkillIndex,
  config: MatchConfig,
): ScoredSkill[] {
  const taskLower = task.toLowerCase();
  const scored: Array<{ entry: SkillEntry; score: number }> = [];

  for (const entry of index.skills) {
    let score = 0;

    // Keyword match: +10 per keyword found in task
    for (const kw of entry.triggers.keywords) {
      if (taskLower.includes(kw.toLowerCase())) {
        score += 10;
      }
    }

    // File pattern match: +5 if project has files matching skill's file triggers
    for (const pattern of entry.triggers.files) {
      const globToRegex = pattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '{{GLOBSTAR}}')
        .replace(/\*/g, '[^/]*')
        .replace(/\{\{GLOBSTAR\}\}/g, '.*');
      try {
        const re = new RegExp(globToRegex);
        if (context.structure.files.some(f => re.test(f.path))) {
          score += 5;
        }
      } catch {
        // Invalid pattern, skip
      }
    }

    // Command match: +3 if skill references commands that exist in context
    const cmds = context.commands;
    if (cmds) {
      for (const cmd of entry.triggers.commands) {
        if (cmds[cmd as keyof typeof cmds]) {
          score += 3;
        }
      }
    }

    if (score > 0) {
      scored.push({ entry, score });
    }
  }

  // Sort by score descending, break ties by priority ascending
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.priority - b.entry.priority;
  });

  // Apply max_skills limit
  const candidates = scored.slice(0, config.max_skills);

  // Apply token budget — load content and accumulate
  const result: ScoredSkill[] = [];
  let usedTokens = 0;

  for (const { entry, score } of candidates) {
    if (!existsSync(entry.sourcePath)) continue;
    try {
      const content = readFileSync(entry.sourcePath, 'utf-8');
      const tokens = Math.ceil(content.length / 4);
      if (usedTokens + tokens > config.max_tokens) {
        // Try next (smaller) skill
        continue;
      }
      usedTokens += tokens;
      result.push({ entry, score, content });
    } catch {
      // Skip unreadable files
    }
  }

  return result;
}
