import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { StackInfo } from './types.js';

const STACK_SIGNALS: Record<string, string> = {
  'package.json': 'javascript',
  'go.mod': 'go',
  'Cargo.toml': 'rust',
  'pyproject.toml': 'python',
  'setup.py': 'python',
  'requirements.txt': 'python',
  'build.gradle': 'java',
  'build.gradle.kts': 'kotlin',
  'pom.xml': 'java',
  'Gemfile': 'ruby',
  'mix.exs': 'elixir',
  'composer.json': 'php',
};

const FRAMEWORK_SIGNALS: Record<string, string> = {
  'next.config.js': 'next.js',
  'next.config.ts': 'next.js',
  'next.config.mjs': 'next.js',
  'nuxt.config.ts': 'nuxt',
  'nuxt.config.js': 'nuxt',
  'vite.config.ts': 'vite',
  'vite.config.js': 'vite',
  'angular.json': 'angular',
  'svelte.config.js': 'svelte',
  'astro.config.mjs': 'astro',
  'remix.config.js': 'remix',
};

const PACKAGE_MANAGER_SIGNALS: Record<string, string> = {
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'package-lock.json': 'npm',
  'bun.lockb': 'bun',
};

const BUILD_TOOL_SIGNALS: Record<string, string> = {
  'webpack.config.js': 'webpack',
  'webpack.config.ts': 'webpack',
  'vite.config.ts': 'vite',
  'vite.config.js': 'vite',
  'esbuild.config.js': 'esbuild',
  'rollup.config.js': 'rollup',
  'Makefile': 'make',
  'CMakeLists.txt': 'cmake',
};

export function detectStack(
  filePaths: string[],
  projectRoot: string,
  level: 'L0' | 'L1',
): Partial<StackInfo> {
  const fileNames = new Set(filePaths.map(f => f.split('/').pop() ?? ''));
  const result: Partial<StackInfo> = {};

  if (level === 'L0' || level === 'L1') {
    // L0: signal-based detection
    const languages = new Set<string>();
    for (const [signal, lang] of Object.entries(STACK_SIGNALS)) {
      if (fileNames.has(signal)) languages.add(lang);
    }
    // Check for TypeScript
    if (fileNames.has('tsconfig.json') || filePaths.some(f => f.endsWith('.ts') || f.endsWith('.tsx'))) {
      languages.add('typescript');
    }
    result.language = [...languages];

    const frameworks: string[] = [];
    for (const [signal, fw] of Object.entries(FRAMEWORK_SIGNALS)) {
      if (fileNames.has(signal)) frameworks.push(fw);
    }
    result.framework = frameworks;

    for (const [signal, pm] of Object.entries(PACKAGE_MANAGER_SIGNALS)) {
      if (fileNames.has(signal)) {
        result.packageManager = pm;
        break;
      }
    }

    for (const [signal, bt] of Object.entries(BUILD_TOOL_SIGNALS)) {
      if (fileNames.has(signal)) {
        result.buildTool = bt;
        break;
      }
    }
  }

  if (level === 'L1') {
    // L1: parse config files for enrichment
    const pkgPath = join(projectRoot, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
        const deps = {
          ...(pkg.dependencies as Record<string, string> | undefined),
          ...(pkg.devDependencies as Record<string, string> | undefined),
        };

        const fwDetections: Record<string, string> = {
          react: 'react', vue: 'vue', svelte: 'svelte', express: 'express',
          fastify: 'fastify', 'hono': 'hono', '@angular/core': 'angular',
          '@nestjs/core': 'nestjs', 'solid-js': 'solid',
        };
        const frameworks = result.framework ? [...result.framework] : [];
        for (const [dep, fw] of Object.entries(fwDetections)) {
          if (deps[dep] && !frameworks.includes(fw)) frameworks.push(fw);
        }
        result.framework = frameworks;

        const testDetections: Record<string, string> = {
          jest: 'jest', vitest: 'vitest', mocha: 'mocha',
          '@playwright/test': 'playwright', cypress: 'cypress',
        };
        for (const [dep, tf] of Object.entries(testDetections)) {
          if (deps[dep]) { result.testFramework = tf; break; }
        }
      } catch {
        // invalid package.json
      }
    }

    const tsconfigPath = join(projectRoot, 'tsconfig.json');
    if (existsSync(tsconfigPath)) {
      try {
        const raw = readFileSync(tsconfigPath, 'utf-8');
        // Strip comments (simple approach for tsconfig)
        const stripped = raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
        const tsconfig = JSON.parse(stripped) as Record<string, unknown>;
        const compilerOptions = tsconfig.compilerOptions as Record<string, unknown> | undefined;
        if (compilerOptions?.strict === true) {
          // This is tracked via existingRules, not stack
        }
      } catch {
        // invalid tsconfig
      }
    }
  }

  return result;
}
