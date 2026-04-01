import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandMap, ResolvedCommand } from './types.js';

/**
 * Extract commands from project documentation files (README.md, CONTRIBUTING.md, etc.).
 * Looks for fenced code blocks containing common command patterns.
 */
export function extractCommandsFromDocs(projectRoot: string): Partial<Record<keyof CommandMap, ResolvedCommand>> {
  const result: Partial<Record<keyof CommandMap, ResolvedCommand>> = {};

  const docFiles = ['README.md', 'readme.md', 'CONTRIBUTING.md', 'contributing.md'];
  let content = '';

  for (const doc of docFiles) {
    const docPath = join(projectRoot, doc);
    if (existsSync(docPath)) {
      try {
        content += readFileSync(docPath, 'utf-8') + '\n';
      } catch {
        // skip unreadable docs
      }
    }
  }

  if (!content) return result;

  // Extract fenced code blocks
  const codeBlockRegex = /```(?:bash|sh|shell|console|zsh)?\n([\s\S]*?)```/g;
  const commands: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const block = match[1];
    if (block) {
      for (const line of block.split('\n')) {
        const trimmed = line.replace(/^\$\s*/, '').trim();
        if (trimmed) commands.push(trimmed);
      }
    }
  }

  // Map recognized patterns to command fields
  const patterns: Array<{ field: keyof CommandMap; regex: RegExp }> = [
    { field: 'install', regex: /^(npm install|yarn install|pnpm install|bun install)/ },
    { field: 'dev', regex: /^(npm run dev|yarn dev|pnpm (?:run )?dev|bun (?:run )?dev)/ },
    { field: 'build', regex: /^(npm run build|yarn build|pnpm (?:run )?build|bun (?:run )?build)/ },
    { field: 'test', regex: /^(npm (?:run )?test|yarn test|pnpm (?:run )?test|bun (?:run )?test)/ },
    { field: 'lint', regex: /^(npm run lint|yarn lint|pnpm (?:run )?lint|bun (?:run )?lint)/ },
    { field: 'typecheck', regex: /^(npm run typecheck|yarn typecheck|pnpm (?:run )?typecheck|bun (?:run )?typecheck)/ },
    { field: 'format', regex: /^(npm run format|yarn format|pnpm (?:run )?format|bun (?:run )?format)/ },
  ];

  for (const cmd of commands) {
    for (const { field, regex } of patterns) {
      if (!result[field] && regex.test(cmd)) {
        result[field] = { command: cmd, source: 'docs', confidence: 0.7 };
      }
    }
  }

  return result;
}
