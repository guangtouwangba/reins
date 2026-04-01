import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import type { SkillEntry, SkillTrigger, SkillSource } from './skill-types.js';

// Known tool vocabulary for trigger inference
const TOOL_VOCABULARY = new Set([
  'playwright', 'cypress', 'puppeteer', 'selenium',
  'jest', 'vitest', 'mocha', 'ava',
  'eslint', 'prettier', 'biome', 'oxlint',
  'prisma', 'drizzle', 'typeorm', 'sequelize', 'knex',
  'docker', 'kubernetes', 'k8s', 'helm',
  'react', 'vue', 'angular', 'svelte', 'solid',
  'nextjs', 'nuxt', 'remix', 'astro',
  'express', 'fastify', 'koa', 'hono',
  'fastapi', 'django', 'flask', 'gin', 'echo',
  'graphql', 'trpc', 'grpc', 'rest',
  'postgres', 'mysql', 'mongodb', 'redis', 'sqlite',
  'aws', 's3', 'lambda', 'cloudflare',
  'github', 'gitlab', 'bitbucket',
  'terraform', 'pulumi', 'cdk',
]);

/**
 * Discover skill source files from multiple directories in priority order.
 */
export function discoverSkills(projectRoot: string, sources: string[]): SkillSource[] {
  const result: SkillSource[] = [];
  const home = homedir();

  // Priority 1: Project .claude/commands/ and .claude/skills/
  scanDir(join(projectRoot, '.claude', 'commands'), 'project', 1, result);
  scanDir(join(projectRoot, '.claude', 'skills'), 'project', 1, result);

  // Priority 2: Project .reins/skills/
  scanDir(join(projectRoot, '.reins', 'skills'), 'team', 2, result);

  // Priority 3: User-configured directories
  for (const source of sources) {
    const resolved = source.startsWith('~') ? join(home, source.slice(1)) : resolve(source);
    scanDir(resolved, 'team', 3, result);
  }

  // Priority 4: User global ~/.claude/commands/ and ~/.claude/skills/
  scanDir(join(home, '.claude', 'commands'), 'user', 4, result);
  scanDir(join(home, '.claude', 'skills'), 'user', 4, result);

  return result;
}

function scanDir(dir: string, sourceType: SkillSource['sourceType'], priority: number, out: SkillSource[]): void {
  if (!existsSync(dir)) return;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push({ path: join(dir, entry.name), sourceType, priority });
      }
    }
  } catch {
    // Skip unreadable directories
  }
}

/**
 * Extract metadata from a skill file, including YAML frontmatter parsing.
 */
export function extractSkillMetadata(source: SkillSource): SkillEntry {
  const content = readFileSync(source.path, 'utf-8');
  const id = basename(source.path, '.md').toLowerCase().replace(/[^a-z0-9]+/g, '-');

  // Parse YAML frontmatter
  const { frontmatter, body } = parseFrontmatter(content);

  // Extract title from first # heading or filename
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1]!.trim() : basename(source.path, '.md');

  // Extract triggers: prefer frontmatter, fallback to inference
  let triggers: SkillTrigger;
  if (frontmatter?.triggers) {
    const ft = frontmatter.triggers as Partial<SkillTrigger>;
    triggers = {
      keywords: Array.isArray(ft.keywords) ? ft.keywords.map(String) : [],
      files: Array.isArray(ft.files) ? ft.files.map(String) : [],
      commands: Array.isArray(ft.commands) ? ft.commands.map(String) : [],
    };
  } else {
    triggers = inferTriggers(basename(source.path, '.md'), body);
  }

  const contentHash = createHash('sha256').update(content).digest('hex');
  const tokenEstimate = Math.ceil(content.length / 4);

  return {
    id,
    title,
    sourcePath: source.path,
    sourceType: source.sourceType,
    priority: source.priority,
    triggers,
    contentHash,
    tokenEstimate,
  };
}

/**
 * Infer triggers from filename and content when no frontmatter is present.
 */
export function inferTriggers(filename: string, content: string): SkillTrigger {
  const keywords: string[] = [];
  const files: string[] = [];
  const commands: string[] = [];

  // Keywords from filename segments
  const segments = filename.toLowerCase().split(/[-_]+/).filter(s => s.length > 1);
  keywords.push(...segments);

  // Keywords from tool vocabulary found in content
  const contentLower = content.toLowerCase();
  for (const tool of TOOL_VOCABULARY) {
    if (contentLower.includes(tool) && !keywords.includes(tool)) {
      keywords.push(tool);
    }
  }

  // File patterns from content (inside backticks or code blocks)
  const filePatterns = content.match(/[`"]([*][^`"]*\.[a-z]+)[`"]/g);
  if (filePatterns) {
    for (const match of filePatterns) {
      const pattern = match.replace(/[`"]/g, '');
      if (pattern.includes('*') || pattern.includes('/')) {
        files.push(pattern);
      }
    }
  }

  // Also look for directory patterns like tests/**, src/api/**
  const dirPatterns = content.match(/[`"]([a-z][a-z0-9_-]*\/\*\*(?:\/[*][^`"]*)?)[`"]/g);
  if (dirPatterns) {
    for (const match of dirPatterns) {
      files.push(match.replace(/[`"]/g, ''));
    }
  }

  return {
    keywords: [...new Set(keywords)].slice(0, 10),
    files: [...new Set(files)].slice(0, 5),
    commands,
  };
}

/**
 * Simple YAML frontmatter parser (avoids dependency on yaml for this).
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, unknown> | null; body: string } {
  if (!content.startsWith('---')) return { frontmatter: null, body: content };

  const endIndex = content.indexOf('\n---', 3);
  if (endIndex === -1) return { frontmatter: null, body: content };

  const yamlBlock = content.slice(4, endIndex);
  const body = content.slice(endIndex + 4).trim();

  // Minimal YAML parsing for the triggers field
  try {
    const result: Record<string, unknown> = {};
    const triggersMatch = yamlBlock.match(/triggers:\s*\n((?:\s+.+\n?)*)/);
    if (triggersMatch) {
      const triggersBlock = triggersMatch[1]!;
      const triggers: Record<string, string[]> = {};
      let currentKey = '';
      for (const line of triggersBlock.split('\n')) {
        const keyMatch = line.match(/^\s+(keywords|files|commands):\s*\[([^\]]*)\]/);
        if (keyMatch) {
          const values = keyMatch[2]!.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
          triggers[keyMatch[1]!] = values;
          continue;
        }
        const keyMatchArray = line.match(/^\s+(keywords|files|commands):/);
        if (keyMatchArray) {
          currentKey = keyMatchArray[1]!;
          triggers[currentKey] = [];
          continue;
        }
        const itemMatch = line.match(/^\s+-\s+(.+)/);
        if (itemMatch && currentKey) {
          triggers[currentKey]!.push(itemMatch[1]!.trim().replace(/^['"]|['"]$/g, ''));
        }
      }
      result['triggers'] = triggers;
    }
    return { frontmatter: result, body };
  } catch {
    return { frontmatter: null, body: content };
  }
}
