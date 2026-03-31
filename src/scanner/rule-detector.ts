import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ExistingRulesInfo } from './types.js';

const ESLINT_CONFIGS = [
  '.eslintrc.json', '.eslintrc.js', '.eslintrc.yaml', '.eslintrc.yml', '.eslintrc',
  'eslint.config.js', 'eslint.config.ts', 'eslint.config.mjs',
];

const PRETTIER_CONFIGS = [
  '.prettierrc', '.prettierrc.json', '.prettierrc.yaml', '.prettierrc.yml',
  '.prettierrc.js', '.prettierrc.mjs', 'prettier.config.js', 'prettier.config.mjs',
];

export function detectRules(filePaths: string[], projectRoot: string): ExistingRulesInfo {
  const fileNames = new Set(filePaths.map(f => f.split('/').pop() ?? ''));

  const result: ExistingRulesInfo = {
    linter: null,
    formatter: null,
    typeCheck: false,
    cicd: null,
  };

  // Detect linter
  for (const config of ESLINT_CONFIGS) {
    if (fileNames.has(config)) {
      const fullPath = join(projectRoot, config);
      if (existsSync(fullPath) && config.endsWith('.json')) {
        try {
          result.linter = JSON.parse(readFileSync(fullPath, 'utf-8')) as Record<string, unknown>;
        } catch {
          result.linter = { detected: config };
        }
      } else {
        result.linter = { detected: config };
      }
      break;
    }
  }

  // Detect formatter
  for (const config of PRETTIER_CONFIGS) {
    if (fileNames.has(config)) {
      const fullPath = join(projectRoot, config);
      if (existsSync(fullPath) && (config.endsWith('.json') || config === '.prettierrc')) {
        try {
          result.formatter = JSON.parse(readFileSync(fullPath, 'utf-8')) as Record<string, unknown>;
        } catch {
          result.formatter = { detected: config };
        }
      } else {
        result.formatter = { detected: config };
      }
      break;
    }
  }

  // Detect TypeScript strict mode
  const tsconfigPath = join(projectRoot, 'tsconfig.json');
  if (existsSync(tsconfigPath)) {
    try {
      const raw = readFileSync(tsconfigPath, 'utf-8');
      const stripped = raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
      const tsconfig = JSON.parse(stripped) as Record<string, unknown>;
      const opts = tsconfig.compilerOptions as Record<string, unknown> | undefined;
      result.typeCheck = opts?.strict === true;
    } catch {
      // invalid tsconfig
    }
  }

  // Detect CI/CD
  const ciFiles = filePaths.filter(f =>
    f.startsWith('.github/workflows/') && (f.endsWith('.yml') || f.endsWith('.yaml'))
  );
  if (ciFiles.length > 0) {
    result.cicd = { type: 'github-actions', files: ciFiles };
  } else if (filePaths.some(f => f === 'Jenkinsfile')) {
    result.cicd = { type: 'jenkins' };
  } else if (filePaths.some(f => f === '.gitlab-ci.yml')) {
    result.cicd = { type: 'gitlab-ci' };
  } else if (filePaths.some(f => f === '.circleci/config.yml')) {
    result.cicd = { type: 'circleci' };
  }

  return result;
}
