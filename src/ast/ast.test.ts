import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseFile, detectLanguage, isSupportedFile } from './parser.js';
import { runQuery } from './query-runner.js';
import { classifyNamingStyle } from './utils.js';
import { extractFacts } from './fact-extractor.js';
import { runAstCheck } from './constraint-checker.js';
import { getQuery, listQueries } from './queries/index.js';
import { buildProjectIndex, aggregateFacts } from './project-index.js';
import { queryImportStyle, queryFilesWithPattern } from './project-query.js';

describe('detectLanguage', () => {
  it('detects .ts as typescript', () => {
    expect(detectLanguage('src/index.ts')).toBe('typescript');
  });
  it('detects .tsx as tsx', () => {
    expect(detectLanguage('App.tsx')).toBe('tsx');
  });
  it('detects .py as python', () => {
    expect(detectLanguage('main.py')).toBe('python');
  });
  it('detects .js as javascript', () => {
    expect(detectLanguage('index.js')).toBe('javascript');
  });
  it('returns null for .css', () => {
    expect(detectLanguage('style.css')).toBeNull();
  });
  it('returns null for .html', () => {
    expect(detectLanguage('index.html')).toBeNull();
  });
});

describe('isSupportedFile', () => {
  it('returns true for .ts', () => {
    expect(isSupportedFile('foo.ts')).toBe(true);
  });
  it('returns false for .md', () => {
    expect(isSupportedFile('README.md')).toBe(false);
  });
});

describe('classifyNamingStyle', () => {
  it('classifies camelCase', () => {
    expect(classifyNamingStyle('myVariable')).toBe('camelCase');
  });
  it('classifies PascalCase', () => {
    expect(classifyNamingStyle('MyClass')).toBe('PascalCase');
  });
  it('classifies snake_case', () => {
    expect(classifyNamingStyle('my_variable')).toBe('snake_case');
  });
  it('classifies UPPER_SNAKE', () => {
    expect(classifyNamingStyle('MAX_COUNT')).toBe('UPPER_SNAKE');
  });
  it('classifies kebab-case', () => {
    expect(classifyNamingStyle('my-component')).toBe('kebab-case');
  });
  it('classifies single lowercase as camelCase', () => {
    expect(classifyNamingStyle('name')).toBe('camelCase');
  });
  it('classifies _ prefix as other', () => {
    expect(classifyNamingStyle('_private')).toBe('other');
  });
  it('returns other for empty', () => {
    expect(classifyNamingStyle('')).toBe('other');
  });
});

describe('parseFile', () => {
  it('parses TypeScript code', async () => {
    const code = 'export function hello(): string { return "hi"; }';
    const result = await parseFile('test.ts', code);
    expect(result).not.toBeNull();
    expect(result!.langId).toBe('typescript');
    expect(result!.tree.rootNode.type).toBe('program');
  });

  it('parses Python code', async () => {
    const code = 'def hello():\n    return "hi"';
    const result = await parseFile('test.py', code);
    expect(result).not.toBeNull();
    expect(result!.langId).toBe('python');
    expect(result!.tree.rootNode.type).toBe('module');
  });

  it('parses JavaScript code', async () => {
    const code = 'const x = 42;';
    const result = await parseFile('test.js', code);
    expect(result).not.toBeNull();
    expect(result!.langId).toBe('javascript');
  });

  it('returns null for unsupported file types', async () => {
    const result = await parseFile('style.css', 'body { color: red; }');
    expect(result).toBeNull();
  });

  it('returns null for files over 200KB', async () => {
    const bigContent = 'x'.repeat(200_001);
    const result = await parseFile('big.ts', bigContent);
    expect(result).toBeNull();
  });

  it('handles syntax errors gracefully (tree-sitter is error-tolerant)', async () => {
    const code = 'function { broken syntax !!!';
    const result = await parseFile('broken.ts', code);
    // tree-sitter parses even broken code (with ERROR nodes)
    expect(result).not.toBeNull();
  });
});

describe('runQuery', () => {
  it('finds import statements in TypeScript', async () => {
    const code = `import { foo } from './bar';\nimport { baz } from 'react';`;
    const parsed = await parseFile('test.ts', code);
    expect(parsed).not.toBeNull();
    const matches = runQuery(parsed!, '(import_statement) @match');
    expect(matches.length).toBe(2);
  });

  it('finds function declarations', async () => {
    const code = 'function hello() {}\nfunction world() {}';
    const parsed = await parseFile('test.ts', code);
    expect(parsed).not.toBeNull();
    const matches = runQuery(parsed!, '(function_declaration name: (identifier) @name) @fn');
    expect(matches.length).toBe(2);
    const names = matches.map(m => m.captures.find(c => c.name === 'name')?.node.text);
    expect(names).toContain('hello');
    expect(names).toContain('world');
  });

  it('finds try/catch statements', async () => {
    const code = 'try { foo(); } catch (e) { bar(); }';
    const parsed = await parseFile('test.ts', code);
    expect(parsed).not.toBeNull();
    const matches = runQuery(parsed!, '(try_statement) @match');
    expect(matches.length).toBe(1);
  });

  it('does NOT match try/catch in comments', async () => {
    const code = '// try { foo(); } catch (e) { bar(); }\nconst x = 1;';
    const parsed = await parseFile('test.ts', code);
    expect(parsed).not.toBeNull();
    const matches = runQuery(parsed!, '(try_statement) @match');
    expect(matches.length).toBe(0);
  });

  it('returns empty array for invalid S-expression', async () => {
    const parsed = await parseFile('test.ts', 'const x = 1;');
    expect(parsed).not.toBeNull();
    const matches = runQuery(parsed!, '(invalid_nonsense @@@');
    expect(matches).toEqual([]);
  });

  it('returns empty array for empty query', async () => {
    const parsed = await parseFile('test.ts', 'const x = 1;');
    expect(parsed).not.toBeNull();
    const matches = runQuery(parsed!, '');
    expect(matches).toEqual([]);
  });

  it('finds class declarations', async () => {
    const code = 'class Foo { bar() {} }';
    const parsed = await parseFile('test.ts', code);
    expect(parsed).not.toBeNull();
    const matches = runQuery(parsed!, '(class_declaration) @match');
    expect(matches.length).toBe(1);
  });

  it('works with Python try/except', async () => {
    const code = 'try:\n    pass\nexcept:\n    pass';
    const parsed = await parseFile('test.py', code);
    expect(parsed).not.toBeNull();
    const matches = runQuery(parsed!, '(try_statement) @match');
    expect(matches.length).toBe(1);
  });
});

describe('extractFacts', () => {
  it('extracts imports, functions, and try/catch from TypeScript', async () => {
    const code = `
import { foo } from './bar';
import { baz } from 'react';

function fetchData() {
  try {
    return foo();
  } catch (e) {
    return null;
  }
}

function processItem() {
  return baz();
}
`;
    const parsed = await parseFile('test.ts', code);
    expect(parsed).not.toBeNull();
    const facts = extractFacts(parsed!);

    expect(facts.imports).toHaveLength(2);
    expect(facts.imports[0]!.source).toBe('./bar');
    expect(facts.imports[0]!.style).toBe('relative');
    expect(facts.imports[1]!.source).toBe('react');
    expect(facts.imports[1]!.style).toBe('package');
    expect(facts.tryCatchCount).toBe(1);
    expect(facts.functionNames).toHaveLength(2);
    expect(facts.functionNames.map(f => f.name)).toContain('fetchData');
    expect(facts.functionNames.map(f => f.name)).toContain('processItem');
  });

  it('extracts try/catch count and class count from Python', async () => {
    const code = `
class MyService:
    def run(self):
        try:
            self.execute()
        except Exception:
            pass

class MyRepo:
    pass
`;
    const parsed = await parseFile('test.py', code);
    expect(parsed).not.toBeNull();
    const facts = extractFacts(parsed!);

    expect(facts.tryCatchCount).toBe(1);
    expect(facts.classCount).toBe(2);
  });
});

describe('runAstCheck', () => {
  it('returns violations for TS code with try/catch using predefined query', async () => {
    const code = 'try { foo(); } catch (e) { bar(); }';
    const result = await runAstCheck('try-catch', 'test.ts', code, 'No try/catch allowed');
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.violations).toHaveLength(1);
    expect(result!.violations[0]!.line).toBe(1);
    expect(result!.violations[0]!.message).toBe('No try/catch allowed');
  });

  it('returns passed:true for clean code with try-catch query', async () => {
    const code = 'const x = 1;\nfunction foo() { return x; }';
    const result = await runAstCheck('try-catch', 'test.ts', code, 'No try/catch');
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
    expect(result!.violations).toHaveLength(0);
  });

  it('detects classes using predefined class-declarations query', async () => {
    const code = 'class Foo {}\nclass Bar extends Foo {}';
    const result = await runAstCheck('class-declarations', 'test.ts', code, 'No classes');
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.violations).toHaveLength(2);
  });

  it('works with inline S-expression query', async () => {
    const code = 'function hello() {}\nfunction world() {}';
    const result = await runAstCheck(
      '(function_declaration) @match',
      'test.ts',
      code,
      'No function declarations',
    );
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.violations).toHaveLength(2);
  });

  it('returns null for unsupported .css file', async () => {
    const result = await runAstCheck('try-catch', 'style.css', 'body {}', 'rule');
    expect(result).toBeNull();
  });
});

describe('getQuery', () => {
  it('returns S-expression for known query + language', () => {
    const q = getQuery('try-catch', 'typescript');
    expect(q).toBe('(try_statement) @match');
  });

  it('returns null for unknown query ID', () => {
    const q = getQuery('nonexistent-query', 'typescript');
    expect(q).toBeNull();
  });

  it('returns null for known query but unsupported language', () => {
    const q = getQuery('try-catch', 'python');
    // try-catch is TS-only; python has try-except
    expect(q).toBeNull();
  });
});

describe('listQueries', () => {
  it('returns all registered queries', () => {
    const queries = listQueries();
    expect(queries.length).toBeGreaterThan(0);
    const ids = queries.map(q => q.id);
    expect(ids).toContain('try-catch');
    expect(ids).toContain('class-declarations');
  });
});

describe('buildProjectIndex', () => {
  it('indexes a temp directory with multiple files and returns correct aggregated facts', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'reins-ast-test-'));

    writeFileSync(join(tmpDir, 'main.ts'), `
import { helper } from './helper';
function processData() {
  try { helper(); } catch (e) {}
}
`);
    writeFileSync(join(tmpDir, 'helper.ts'), `
export function helper() { return 42; }
export function formatOutput() { return ''; }
`);
    writeFileSync(join(tmpDir, 'app.py'), `
class App:
    def run(self):
        pass
`);

    try {
      const index = await buildProjectIndex(tmpDir, ['main.ts', 'helper.ts', 'app.py']);

      expect(index.aggregated.totalFiles).toBe(3);
      expect(index.aggregated.languageBreakdown['typescript']).toBe(2);
      expect(index.aggregated.languageBreakdown['python']).toBe(1);
      expect(index.aggregated.importStyle.relative).toBeGreaterThanOrEqual(1);
      expect(index.aggregated.classCount).toBe(1);
      expect(index.files).toHaveLength(3);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('queryImportStyle', () => {
  it('returns correct dominant style', () => {
    const index = {
      version: 1,
      projectRoot: '/tmp',
      generatedAt: new Date().toISOString(),
      files: [],
      aggregated: {
        totalFiles: 3,
        languageBreakdown: { typescript: 3 },
        importStyle: { relative: 10, alias: 2, package: 5 },
        tryCatchDensity: 0,
        namingStyle: {},
        typeCoverage: { typed: 0, untyped: 0 },
        classCount: 0,
      },
    };
    const result = queryImportStyle(index);
    expect(result.dominant).toBe('relative');
    expect(result.breakdown.relative).toBe(10);
  });
});

describe('queryFilesWithPattern', () => {
  it('filters files by predicate on facts', () => {
    const index = {
      version: 1,
      projectRoot: '/tmp',
      generatedAt: new Date().toISOString(),
      files: [
        { filePath: 'a.ts', langId: 'typescript', contentHash: '', mtime: 0, facts: { imports: [], exports: [], tryCatchCount: 2, classCount: 0, functionNames: [], apiUsages: [] } },
        { filePath: 'b.ts', langId: 'typescript', contentHash: '', mtime: 0, facts: { imports: [], exports: [], tryCatchCount: 0, classCount: 0, functionNames: [], apiUsages: [] } },
        { filePath: 'c.ts', langId: 'typescript', contentHash: '', mtime: 0, facts: { imports: [], exports: [], tryCatchCount: 1, classCount: 0, functionNames: [], apiUsages: [] } },
      ],
      aggregated: {
        totalFiles: 3,
        languageBreakdown: { typescript: 3 },
        importStyle: { relative: 0, alias: 0, package: 0 },
        tryCatchDensity: 1,
        namingStyle: {},
        typeCoverage: { typed: 0, untyped: 0 },
        classCount: 0,
      },
    };
    const result = queryFilesWithPattern(index, f => f.tryCatchCount > 0);
    expect(result).toEqual(['a.ts', 'c.ts']);
  });
});
