import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CodebaseContext } from '../scanner/types.js';

export async function runSkillCreate(name: string): Promise<void> {
  const projectRoot = process.cwd();

  // Sanitize name
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) {
    console.log('Invalid skill name.');
    return;
  }

  const outputDir = join(projectRoot, '.claude', 'commands');
  const outputPath = join(outputDir, `${slug}.md`);

  if (existsSync(outputPath)) {
    console.log(`Skill already exists: ${outputPath}`);
    console.log('Edit it directly to update.');
    return;
  }

  // Detect project context for scaffolding hints
  const hints = detectHints(projectRoot, slug);

  // Generate skill file
  const lines: string[] = [];
  lines.push('---');
  lines.push('triggers:');
  lines.push(`  keywords: [${hints.keywords.join(', ')}]`);
  if (hints.files.length > 0) {
    lines.push(`  files: [${hints.files.map(f => `"${f}"`).join(', ')}]`);
  }
  if (hints.commands.length > 0) {
    lines.push(`  commands: [${hints.commands.join(', ')}]`);
  }
  lines.push('---');
  lines.push('');
  lines.push(`# ${name}`);
  lines.push('');
  if (hints.detected.length > 0) {
    lines.push('## Detected');
    lines.push('');
    for (const d of hints.detected) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }
  lines.push('## Patterns');
  lines.push('');
  lines.push('<!-- Describe the patterns and conventions for this skill -->');
  lines.push('');
  lines.push('## Examples');
  lines.push('');
  lines.push('<!-- Add code examples -->');
  lines.push('');
  lines.push('## Anti-patterns');
  lines.push('');
  lines.push('<!-- What to avoid -->');
  lines.push('');

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, lines.join('\n'), 'utf-8');

  console.log(`Created: ${outputPath}`);
  console.log('');
  console.log('  Edit the file to add your patterns, examples, and anti-patterns.');
  console.log('  Run `reins init` to index the skill for auto-loading.');
}

interface SkillHints {
  keywords: string[];
  files: string[];
  commands: string[];
  detected: string[];
}

function detectHints(projectRoot: string, slug: string): SkillHints {
  const keywords = slug.split('-').filter(s => s.length > 1);
  const files: string[] = [];
  const commands: string[] = [];
  const detected: string[] = [];

  // Check for common tool configs based on skill name
  const slugLower = slug.toLowerCase();

  if (slugLower.includes('test') || slugLower.includes('e2e')) {
    if (existsSync(join(projectRoot, 'playwright.config.ts')) || existsSync(join(projectRoot, 'playwright.config.js'))) {
      detected.push('Test runner: Playwright');
      keywords.push('playwright');
      files.push('"tests/**"');
    }
    if (existsSync(join(projectRoot, 'cypress.config.ts')) || existsSync(join(projectRoot, 'cypress.config.js'))) {
      detected.push('Test runner: Cypress');
      keywords.push('cypress');
      files.push('"cypress/**"');
    }
    if (existsSync(join(projectRoot, 'vitest.config.ts'))) {
      detected.push('Test runner: Vitest');
      keywords.push('vitest');
    }
    commands.push('test');
    files.push('"*.spec.ts"', '"*.test.ts"');
  }

  if (slugLower.includes('deploy') || slugLower.includes('ci')) {
    if (existsSync(join(projectRoot, 'Dockerfile'))) {
      detected.push('Docker detected');
      keywords.push('docker');
    }
    if (existsSync(join(projectRoot, '.github', 'workflows'))) {
      detected.push('GitHub Actions detected');
      keywords.push('github', 'ci');
    }
  }

  if (slugLower.includes('api') || slugLower.includes('route')) {
    keywords.push('api', 'endpoint', 'route');
    files.push('"src/api/**"', '"app/api/**"');
  }

  if (slugLower.includes('db') || slugLower.includes('migration') || slugLower.includes('database')) {
    if (existsSync(join(projectRoot, 'prisma', 'schema.prisma'))) {
      detected.push('ORM: Prisma');
      keywords.push('prisma');
    }
    keywords.push('database', 'migration');
  }

  return {
    keywords: [...new Set(keywords)],
    files: [...new Set(files)],
    commands: [...new Set(commands)],
    detected,
  };
}

export async function runSkillList(): Promise<void> {
  const projectRoot = process.cwd();
  const indexPath = join(projectRoot, '.reins', 'skill-index.json');

  if (!existsSync(indexPath)) {
    console.log('No skills indexed yet.');
    console.log('');
    console.log('Run `reins init` to scan and index skills.');
    return;
  }

  try {
    const index = JSON.parse(readFileSync(indexPath, 'utf-8')) as { skills: Array<{ id: string; title: string; sourceType: string; sourcePath: string; triggers: { keywords: string[] } }> };
    const skills = index.skills;

    if (skills.length === 0) {
      console.log('No skills found.');
      console.log('');
      console.log('Create a skill: reins skill create <name>');
      return;
    }

    // Group by sourceType
    const groups: Record<string, typeof skills> = {};
    for (const s of skills) {
      const key = s.sourceType;
      if (!groups[key]) groups[key] = [];
      groups[key]!.push(s);
    }

    console.log('');
    console.log(`${'Source'.padEnd(12)} ${'Skill'.padEnd(25)} ${'Triggers'.padEnd(30)} Path`);
    console.log('-'.repeat(90));

    const typeLabels: Record<string, string> = { project: 'project', team: 'team', user: 'global' };

    for (const [type, items] of Object.entries(groups)) {
      for (const s of items!) {
        const label = typeLabels[type] ?? type;
        const triggers = s.triggers.keywords.slice(0, 4).join(', ');
        console.log(`${label.padEnd(12)} ${s.id.padEnd(25)} ${triggers.padEnd(30)} ${s.sourcePath}`);
      }
    }

    console.log('');
    console.log(`Total: ${skills.length} skills indexed`);
  } catch {
    console.log('Could not read skill index. Run `reins init` to rebuild.');
  }
}

export async function runSkill(action: string | undefined, args: string[]): Promise<void> {
  switch (action) {
    case 'create': {
      const name = args.join(' ');
      if (!name) {
        console.log('Usage: reins skill create <name>');
        return;
      }
      await runSkillCreate(name);
      break;
    }
    case 'list':
      await runSkillList();
      break;
    default:
      if (action) {
        console.log(`Unknown action: ${action}`);
        console.log('');
      }
      console.log('Usage: reins skill <create|list> [args...]');
      console.log('');
      console.log('  reins skill create <name>   Create a new skill');
      console.log('  reins skill list             List all indexed skills');
      console.log('  reins skills                 Alias for skill list');
      break;
  }
}
