## Context

This change adds a tree-sitter-based AST analysis engine to Reins, replacing regex-based code analysis with multi-language syntax tree queries. The engine serves two consumers: the Scanner (during `reins init`, for accurate pattern detection) and the Gate (at runtime, for semantic constraint checking).

Relevant existing structures:

- `analyzePatterns()` in `src/scanner/pattern-analyzer.ts` is the current regex-based pattern analyzer — to be rewritten internally.
- `PatternResult` contains `architecture` and `conventions` — the output interface stays the same, but the analysis quality improves.
- `ConstraintEnforcement` in `src/constraints/schema.ts` has `hook_check?: string` for regex — we add `ast_pattern?: string` alongside it.
- `gatePostEdit()` in `src/gate/post-edit.ts` (from `2026-04-02-reins-gate-subcommand`) uses `hook_check` regex — extended to prefer `ast_pattern` when available.

## Goals / Non-Goals

**Goals:**
- **递归扫描整个仓库**，解析所有支持语言的源文件，构建项目级 AST 索引。
- Parse source files into CST using tree-sitter (via `web-tree-sitter` WASM build).
- Support TypeScript, JavaScript, Python, Go, Rust out of the box.
- Provide predefined tree-sitter queries for common constraint checks.
- Allow constraints to declare `ast_pattern` (a tree-sitter S-expression query) for semantic checking.
- **增量解析**：基于文件修改时间，只重新解析变化的文件，缓存未变化文件的解析结果。
- **跨文件聚合查询**：支持项目级别的模式统计（如"项目中 73% 的 import 使用 alias 风格"）。
- Integrate into Scanner L2 to replace regex-based pattern analysis with full-repo analysis.
- Integrate into Gate post-edit to support AST-backed constraint checking.
- Graceful fallback: if parsing fails or language is unsupported, fall back to regex.

**Non-Goals:**
- Type checking or type inference (tree-sitter does syntax, not types).
- Code modification or auto-fix.
- Supporting all 40+ tree-sitter languages immediately (start with 5).
- Building a custom query language — use tree-sitter's native S-expression queries.
- Full import resolution or call graph construction（但支持统计 import 来源和使用频率）.

## Decisions

### 1. web-tree-sitter (WASM) vs node-tree-sitter (native)

Use `web-tree-sitter` (WASM build) for all analysis.

```ts
import Parser from 'web-tree-sitter';

let parser: Parser | null = null;
const loadedLanguages = new Map<string, Parser.Language>();

async function initParser(): Promise<Parser> {
  if (parser) return parser;
  await Parser.init();
  parser = new Parser();
  return parser;
}

async function loadLanguage(langId: string): Promise<Parser.Language> {
  if (loadedLanguages.has(langId)) return loadedLanguages.get(langId)!;
  const wasmPath = require.resolve(`tree-sitter-${langId}/tree-sitter-${langId}.wasm`);
  const lang = await Parser.Language.load(wasmPath);
  loadedLanguages.set(langId, lang);
  return lang;
}
```

Trade-offs:
- WASM is ~60-70% native speed, but still < 10ms/file — fast enough for gate hooks.
- No C compiler or node-gyp needed — `pnpm install` just works everywhere.
- WASM files are ~500KB-2MB per language, loaded lazily.

Alternatives considered:
- `node-tree-sitter` (native C binding): rejected because it requires node-gyp and C toolchain, causing install failures on many setups.
- TypeScript Compiler API: rejected because it only supports TS/JS, not multi-language. Also slower (50ms vs 10ms).
- babel parser: rejected because JavaScript-only and large dependency.

### 2. Language detection from file extension

```ts
const LANG_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
};

function detectLanguage(filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();
  return LANG_MAP[ext] ?? null;
}
```

Files with unsupported extensions get no AST analysis — fallback to regex.

### 3. Parsing API: parse once, query many

```ts
// src/ast/parser.ts

export interface ParsedFile {
  tree: Parser.Tree;
  language: Parser.Language;
  langId: string;
  filePath: string;
}

export async function parseFile(filePath: string, content: string): Promise<ParsedFile | null> {
  const langId = detectLanguage(filePath);
  if (!langId) return null;

  // File size guard
  if (content.length > 200_000) return null; // 200KB limit

  const p = await initParser();
  const language = await loadLanguage(langId);
  p.setLanguage(language);
  const tree = p.parse(content);

  return { tree, language, langId, filePath };
}
```

The caller parses once and runs multiple queries against the same tree. This matters for gate (1 file, N constraints) and scanner (N files, M queries).

### 4. Query system: tree-sitter native S-expressions

tree-sitter has a built-in query language using S-expressions. Each query describes a pattern to match against the syntax tree:

```ts
// src/ast/query-runner.ts

export interface QueryMatch {
  pattern: number;
  captures: { name: string; node: Parser.SyntaxNode }[];
}

export function runQuery(
  parsed: ParsedFile,
  querySource: string,
): QueryMatch[] {
  const query = parsed.language.query(querySource);
  const matches = query.matches(parsed.tree.rootNode);
  return matches.map(m => ({
    pattern: m.pattern,
    captures: m.captures.map(c => ({ name: c.name, node: c.node })),
  }));
}
```

Example queries:

```scheme
; Find all try/catch in TypeScript/JavaScript
(try_statement
  handler: (catch_clause) @catch) @try

; Find export functions without return type
(export_statement
  declaration: (function_declaration
    name: (identifier) @name
    !return_type)) @match

; Find import statements with relative paths
(import_statement
  source: (string (string_fragment) @source)
  (#match? @source "^\\.\\.?/")) @match

; Find class declarations
(class_declaration
  name: (type_identifier) @name) @match

; Find new expressions (e.g., new PrismaClient())
(new_expression
  constructor: (_) @constructor) @match
```

```scheme
; Python: find bare except
(except_clause
  !type) @match

; Go: find panic() calls
(call_expression
  function: (identifier) @fn
  (#eq? @fn "panic")) @match

; Rust: find unwrap() calls
(call_expression
  function: (field_expression
    field: (field_identifier) @method)
  (#eq? @method "unwrap")) @match
```

### 5. Predefined query library

Queries are organized by language in a registry:

```ts
// src/ast/queries/index.ts

export interface QueryDef {
  id: string;                    // "no-try-catch"
  description: string;
  languages: string[];           // ["typescript", "javascript", "tsx"]
  queries: Record<string, string>; // langId → S-expression query
}

const QUERY_REGISTRY: QueryDef[] = [
  {
    id: 'try-catch',
    description: 'Find try/catch statements',
    languages: ['typescript', 'tsx', 'javascript'],
    queries: {
      typescript: '(try_statement handler: (catch_clause) @catch) @try',
      tsx: '(try_statement handler: (catch_clause) @catch) @try',
      javascript: '(try_statement handler: (catch_clause) @catch) @try',
    },
  },
  {
    id: 'try-except',
    description: 'Find try/except statements',
    languages: ['python'],
    queries: {
      python: '(try_statement (except_clause) @except) @try',
    },
  },
  // ... more queries
];

export function getQuery(id: string, langId: string): string | null {
  const def = QUERY_REGISTRY.find(q => q.id === id);
  if (!def) return null;
  return def.queries[langId] ?? null;
}
```

### 6. Constraint checker: ast_pattern → tree-sitter query

Two modes for `ast_pattern`:

**Mode A — Query ID reference:**
```yaml
enforcement:
  ast_pattern: 'try-catch'    # references predefined query by ID
```

**Mode B — Inline S-expression:**
```yaml
enforcement:
  ast_pattern: '(try_statement) @match'   # inline tree-sitter query
```

The checker resolves the pattern:

```ts
// src/ast/constraint-checker.ts

export interface AstCheckResult {
  passed: boolean;
  violations: { line: number; column: number; message: string; nodeText: string }[];
}

export async function runAstCheck(
  astPattern: string,
  filePath: string,
  content: string,
  constraintRule: string,
): Promise<AstCheckResult | null> {
  const parsed = await parseFile(filePath, content);
  if (!parsed) return null; // unsupported language or parse error

  // Resolve pattern: try as query ID first, then as inline S-expression
  let querySource = getQuery(astPattern, parsed.langId);
  if (!querySource) {
    // Treat as inline S-expression
    querySource = astPattern;
  }

  try {
    const matches = runQuery(parsed, querySource);
    if (matches.length === 0) {
      return { passed: true, violations: [] };
    }

    return {
      passed: false,
      violations: matches.map(m => {
        const node = m.captures.find(c => c.name === 'match' || c.name === 'try')?.node
          ?? m.captures[0]?.node;
        return {
          line: (node?.startPosition.row ?? 0) + 1,
          column: (node?.startPosition.column ?? 0) + 1,
          message: constraintRule,
          nodeText: node?.text?.slice(0, 80) ?? '',
        };
      }),
    };
  } catch {
    return null; // invalid query, fallback to regex
  }
}
```

### 7. Project Index: recursive full-repo scan

核心架构变化：**不再采样，而是递归扫描整个仓库构建项目级索引。**

```ts
// src/ast/project-index.ts

export interface FileAstEntry {
  filePath: string;
  langId: string;
  contentHash: string;          // sha256, for incremental cache
  mtime: number;                // file modification time
  facts: FileFacts;             // extracted facts from this file
}

export interface FileFacts {
  imports: { source: string; style: 'relative' | 'alias' | 'package'; isTypeOnly: boolean }[];
  exports: { name: string; kind: string; hasReturnType: boolean }[];
  tryCatchCount: number;
  classCount: number;
  functionNames: { name: string; style: string }[];
  apiUsages: { name: string; line: number }[];
}

export interface ProjectIndex {
  version: number;
  projectRoot: string;
  generatedAt: string;
  files: FileAstEntry[];
  aggregated: AggregatedFacts;  // project-level rollup
}

export interface AggregatedFacts {
  totalFiles: number;
  languageBreakdown: Record<string, number>;   // langId → file count
  importStyle: { relative: number; alias: number; package: number };
  tryCatchDensity: number;                      // total tryCatch / totalFiles
  namingStyle: Record<string, number>;           // style → count
  typeCoverage: { typed: number; untyped: number }; // export functions
  classCount: number;
}
```

#### 递归扫描流程

```ts
// src/ast/scanner.ts

export async function buildProjectIndex(
  projectRoot: string,
  filePaths: string[],          // from existing directory scanner
  existingIndex?: ProjectIndex, // for incremental update
): Promise<ProjectIndex> {
  const entries: FileAstEntry[] = [];

  // Reuse existing scanner's file list (already excludes node_modules, .git, etc.)
  const sourceFiles = filePaths.filter(f => detectLanguage(f) !== null);

  for (const filePath of sourceFiles) {
    const absPath = resolve(projectRoot, filePath);
    const stat = statSync(absPath);

    // Incremental: skip unchanged files
    if (existingIndex) {
      const existing = existingIndex.files.find(e => e.filePath === filePath);
      if (existing && existing.mtime === stat.mtimeMs) {
        entries.push(existing);  // reuse cached entry
        continue;
      }
    }

    // Parse and extract facts
    const content = readFileSync(absPath, 'utf-8');
    const parsed = await parseFile(filePath, content);
    if (!parsed) continue;

    const facts = extractFacts(parsed);
    entries.push({
      filePath,
      langId: parsed.langId,
      contentHash: createHash('sha256').update(content).digest('hex'),
      mtime: stat.mtimeMs,
      facts,
    });
  }

  // Aggregate across all files
  const aggregated = aggregateFacts(entries);

  return {
    version: 1,
    projectRoot,
    generatedAt: new Date().toISOString(),
    files: entries,
    aggregated,
  };
}
```

#### 每个文件提取 facts

```ts
function extractFacts(parsed: ParsedFile): FileFacts {
  const facts: FileFacts = {
    imports: [],
    exports: [],
    tryCatchCount: 0,
    classCount: 0,
    functionNames: [],
    apiUsages: [],
  };

  // Run all fact-extraction queries against this file's tree
  // Imports
  const importMatches = runQuery(parsed, FACT_QUERIES[parsed.langId]?.imports ?? '');
  for (const m of importMatches) {
    const src = m.captures.find(c => c.name === 'src')?.node.text ?? '';
    facts.imports.push({
      source: src,
      style: src.startsWith('.') ? 'relative' : src.startsWith('@/') || src.startsWith('~/') ? 'alias' : 'package',
      isTypeOnly: m.captures.some(c => c.name === 'type_only'),
    });
  }

  // Try/catch
  const tryCatches = runQuery(parsed, FACT_QUERIES[parsed.langId]?.tryCatch ?? '');
  facts.tryCatchCount = tryCatches.length;

  // Classes
  const classes = runQuery(parsed, FACT_QUERIES[parsed.langId]?.classes ?? '');
  facts.classCount = classes.length;

  // Functions (for naming + type coverage)
  const funcs = runQuery(parsed, FACT_QUERIES[parsed.langId]?.functions ?? '');
  for (const m of funcs) {
    const name = m.captures.find(c => c.name === 'name')?.node.text ?? '';
    facts.functionNames.push({ name, style: classifyNamingStyle(name) });
  }

  // Exports with return type info
  const exports = runQuery(parsed, FACT_QUERIES[parsed.langId]?.exports ?? '');
  for (const m of exports) {
    facts.exports.push({
      name: m.captures.find(c => c.name === 'name')?.node.text ?? '',
      kind: m.captures.find(c => c.name === 'kind')?.node.type ?? 'unknown',
      hasReturnType: m.captures.some(c => c.name === 'return_type'),
    });
  }

  return facts;
}
```

#### 项目级聚合

```ts
function aggregateFacts(entries: FileAstEntry[]): AggregatedFacts {
  const langBreakdown: Record<string, number> = {};
  let relativeImports = 0, aliasImports = 0, packageImports = 0;
  let totalTryCatch = 0, totalClasses = 0;
  let typedExports = 0, untypedExports = 0;
  const namingStyles: Record<string, number> = {};

  for (const entry of entries) {
    // Language breakdown
    langBreakdown[entry.langId] = (langBreakdown[entry.langId] ?? 0) + 1;

    // Import aggregation
    for (const imp of entry.facts.imports) {
      if (imp.style === 'relative') relativeImports++;
      else if (imp.style === 'alias') aliasImports++;
      else packageImports++;
    }

    // Error handling density
    totalTryCatch += entry.facts.tryCatchCount;
    totalClasses += entry.facts.classCount;

    // Naming
    for (const fn of entry.facts.functionNames) {
      namingStyles[fn.style] = (namingStyles[fn.style] ?? 0) + 1;
    }

    // Type coverage
    for (const exp of entry.facts.exports) {
      if (exp.hasReturnType) typedExports++;
      else untypedExports++;
    }
  }

  return {
    totalFiles: entries.length,
    languageBreakdown: langBreakdown,
    importStyle: { relative: relativeImports, alias: aliasImports, package: packageImports },
    tryCatchDensity: entries.length > 0 ? totalTryCatch / entries.length : 0,
    namingStyle: namingStyles,
    typeCoverage: { typed: typedExports, untyped: untypedExports },
    classCount: totalClasses,
  };
}
```

#### 索引持久化和增量更新

```ts
// 索引持久化到 .reins/ast-index.json
export function saveProjectIndex(projectRoot: string, index: ProjectIndex): void {
  const indexPath = join(projectRoot, '.reins', 'ast-index.json');
  // 只保存 facts 和 aggregated，不保存 tree（不可序列化）
  writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

export function loadProjectIndex(projectRoot: string): ProjectIndex | null {
  const indexPath = join(projectRoot, '.reins', 'ast-index.json');
  if (!existsSync(indexPath)) return null;
  return JSON.parse(readFileSync(indexPath, 'utf-8'));
}
```

增量流程：
```
reins init (首次)
  → 递归扫描全部文件 → 解析 → 提取 facts → 聚合 → 写入 ast-index.json

reins update / reins gate context (后续)
  → 加载 ast-index.json → 对比 mtime → 只重新解析变化的文件 → 更新聚合 → 写入
```

#### 进度反馈

`reins init` 涉及多个阶段（扫描目录、检测技术栈、AST 解析全仓库、生成约束、写出文件），总耗时可能 10-40 秒。必须给用户实时进度反馈，否则用户会以为命令行卡死。

进度回调贯穿整个 init 流程，不局限于 AST 阶段：

```ts
export interface InitProgress {
  phase: 'scan' | 'detect' | 'ast-parse' | 'constraints' | 'context' | 'hooks' | 'done';
  message: string;
  current?: number;
  total?: number;
}

export type ProgressCallback = (progress: InitProgress) => void;
```

`buildProjectIndex` 通过同一回调报告 AST 阶段的详细进度：

```ts
export async function buildProjectIndex(
  projectRoot: string,
  filePaths: string[],
  existingIndex?: ProjectIndex,
  onProgress?: ProgressCallback,
): Promise<ProjectIndex> {
  const sourceFiles = filePaths.filter(f => detectLanguage(f) !== null);

  for (let i = 0; i < sourceFiles.length; i++) {
    onProgress?.({
      phase: 'ast-parse',
      message: `Analyzing code`,
      current: i + 1,
      total: sourceFiles.length,
    });
    // ... parse logic ...
  }
  // ...
}
```

CLI 端在 `initCommand` 中统一渲染：

```ts
await initPipeline(projectRoot, options, (progress) => {
  if (progress.current && progress.total) {
    const pct = Math.round((progress.current / progress.total) * 100);
    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    process.stdout.write(`\r  ${progress.message} [${bar}] ${pct}% (${progress.current}/${progress.total})`);
  } else {
    process.stdout.write(`\r  ${progress.message}...`);
  }
  if (progress.phase === 'done') {
    process.stdout.write('\n');
  }
});
```

输出效果：
```
Reins: Initializing project...
  Scanning directory...
  Detecting stack...
  ✓ Stack: typescript + pnpm
  ✓ Architecture: monolith
  Analyzing code [████████████████░░░░] 82% (164/200)
  Generating constraints...
  ✓ Constraints: 12 generated
  ✓ 5 hooks generated
  ✓ .claude/settings.json

  Reins initialized successfully.
```

增量模式下（`reins update`），AST 阶段跳过缓存命中的文件，进度条几乎瞬间跑完。

#### 跨文件查询 API

```ts
// src/ast/project-query.ts

// "项目中使用了哪些 import 风格？" → 从 index.aggregated 直接读
export function queryImportStyle(index: ProjectIndex): { dominant: string; breakdown: Record<string, number> } {
  const { relative, alias, package: pkg } = index.aggregated.importStyle;
  const max = Math.max(relative, alias, pkg);
  const dominant = max === alias ? 'alias' : max === relative ? 'relative' : 'package';
  return { dominant, breakdown: { relative, alias, package: pkg } };
}

// "哪些文件使用了 try/catch？" → 从 index.files 过滤
export function queryFilesWithPattern(index: ProjectIndex, predicate: (f: FileFacts) => boolean): string[] {
  return index.files.filter(e => predicate(e.facts)).map(e => e.filePath);
}

// "src/auth/ 目录的类型覆盖率是多少？" → 按目录过滤后聚合
export function queryDirectoryFacts(index: ProjectIndex, dirPrefix: string): AggregatedFacts {
  const filtered = index.files.filter(e => e.filePath.startsWith(dirPrefix));
  return aggregateFacts(filtered);
}
```

### 8. Scanner integration

Scanner L2 不再自己做模式分析，而是消费 Project Index：

```ts
// src/scanner/pattern-analyzer.ts — rewritten

import { buildProjectIndex, loadProjectIndex, saveProjectIndex } from '../ast/project-index.js';
import { queryImportStyle } from '../ast/project-query.js';

export async function analyzePatterns(
  filePaths: string[],
  dirPaths: string[],
  projectRoot: string,
): Promise<PatternResult> {
  // Build or incrementally update the project AST index
  const existingIndex = loadProjectIndex(projectRoot);
  const index = await buildProjectIndex(projectRoot, filePaths, existingIndex ?? undefined);
  saveProjectIndex(projectRoot, index);

  return {
    architecture: inferArchitecture(dirPaths, filePaths),  // unchanged (directory-based)
    conventions: inferConventionsFromIndex(index),          // from full-repo AST index
  };
}

function inferConventionsFromIndex(index: ProjectIndex): Partial<ConventionsInfo> {
  const agg = index.aggregated;

  // Naming: dominant style from ALL functions across ALL files
  const namingEntries = Object.entries(agg.namingStyle);
  const dominantNaming = namingEntries.sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';

  // Import style: from ALL imports across ALL files
  const { dominant: importDominant } = queryImportStyle(index);

  // Type coverage: from ALL exported functions
  const total = agg.typeCoverage.typed + agg.typeCoverage.untyped;
  const typeCoverageRatio = total > 0 ? agg.typeCoverage.typed / total : 0;

  return {
    naming: dominantNaming as any,
    importStyle: importDominant,
    tryCatchDensity: agg.tryCatchDensity,
    typeCoverage: typeCoverageRatio,
    classUsage: agg.classCount > 0,
    // ... map to existing ConventionsInfo fields
  };
}
```

### 9. Gate integration

```ts
// In src/gate/post-edit.ts — extension

import { runAstCheck } from '../ast/constraint-checker.js';

// For each constraint in the check loop:
if (constraint.enforcement.ast_pattern) {
  const astResult = await runAstCheck(
    constraint.enforcement.ast_pattern,
    filePath,
    content,
    constraint.rule,
  );
  if (astResult !== null) {
    if (!astResult.passed) {
      const mode = constraint.enforcement.hook_mode ?? 'block';
      if (mode === 'block') {
        return {
          action: 'block',
          messages: [],
          blockReason: `reins [block] ${constraint.id}: ${astResult.violations.map(v =>
            `L${v.line}: ${v.message}`).join('; ')}`,
        };
      } else {
        result.messages.push(
          `reins [warn] ${constraint.id}: ${astResult.violations.map(v =>
            `L${v.line}: ${v.message}`).join('; ')}`
        );
      }
    }
    continue; // AST handled it, skip regex
  }
  // AST returned null → fall through to hook_check regex
}
```

### 10. Performance budget

| Operation | Budget | Mechanism |
|-----------|--------|-----------|
| `Parser.init()` (WASM bootstrap) | ~50ms | Once per process, cached |
| Language WASM load | ~30ms | Once per language, cached |
| Single file parse + fact extraction | < 15ms | tree-sitter parse + queries |
| Gate post-edit (1 file, 5 constraints) | < 100ms | Parse once, run 5 queries |
| Full repo scan — 500 files (first run) | < 10s | Parallel-ready, sequential OK |
| Full repo scan — 2000 files (first run) | < 40s | Acceptable for `reins init` |
| Incremental update — 10 changed files | < 200ms | mtime check + re-parse changed only |
| Project index load from cache | < 50ms | JSON parse of ast-index.json |
| File size limit | 200KB | Larger files skipped (facts = empty) |

**关键设计约束**：
- `reins init` 可以花 10-40 秒做全量扫描（一次性成本）
- `reins gate` 必须 < 2 秒（每次 tool use 都触发）
- Gate 对单文件做实时 AST 检查，不依赖 project index
- Gate context 可以加载 project index（JSON 缓存）提供聚合数据，不需要重新扫描

## File Structure

```
src/ast/
├── parser.ts                 # initParser(), loadLanguage(), parseFile(), detectLanguage()
├── query-runner.ts           # runQuery(): execute S-expression query against parsed tree
├── project-index.ts          # buildProjectIndex(): recursive full-repo scan + incremental cache
├── project-query.ts          # queryImportStyle(), queryFilesWithPattern(), queryDirectoryFacts()
├── fact-extractor.ts         # extractFacts(): per-file fact extraction via tree-sitter queries
├── constraint-checker.ts     # runAstCheck(): ast_pattern → parse + query → AstCheckResult
├── queries/
│   ├── index.ts              # QueryDef registry + getQuery() + FACT_QUERIES per language
│   ├── typescript.ts         # TypeScript/JavaScript predefined + fact queries
│   ├── python.ts             # Python predefined + fact queries
│   └── go.ts                 # Go predefined + fact queries
├── utils.ts                  # classifyNamingStyle(), nodeToLocation(), helpers
├── types.ts                  # ParsedFile, QueryMatch, AstCheckResult, ProjectIndex, FileFacts, etc.
└── ast.test.ts               # Tests for parser, index, queries, constraint checker
```

Output artifacts:
```
.reins/
├── ast-index.json            # Project AST index (full-repo facts + aggregated stats)
└── ...
```

## Risks / Trade-offs

- [Full repo scan on large projects (5000+ files)] → tree-sitter 解析单文件 < 15ms, 5000 files ≈ 75s。Mitigate: 并行解析（Worker threads）可降至 15-20s。`reins init` 是一次性操作，可接受。后续 `reins update` 用增量模式 < 1s。
- [ast-index.json 可能很大] → 5000 文件 × ~500 bytes/entry ≈ 2.5MB。可接受。Mitigate: 只存 facts（聚合数据），不存 tree（不可序列化也不需要持久化）。
- [WASM file size ~500KB-2MB per language] → Mitigate: lazy loading — only load languages actually used in the project (从 languageBreakdown 判断). Total for 5 languages ~5-8MB, acceptable for a CLI tool.
- [web-tree-sitter requires async init] → Mitigate: `Parser.init()` called once and cached. All AST functions are async but gate can await them (budget is 2s, init takes 50ms).
- [tree-sitter grammar WASM files must be distributed] → Mitigate: use published npm packages (`tree-sitter-typescript`, etc.) which include pre-built WASM files. No build step needed.
- [S-expression queries have a learning curve] → Mitigate: predefined query library covers common cases. Users only write raw S-expressions for advanced custom constraints.
- [tree-sitter produces CST not AST] → The concrete syntax tree includes all tokens (parentheses, commas, etc.). Queries must account for this. Mitigate: predefined queries handle CST details; users reference queries by ID.
- [Language grammar updates] → Pin grammar package versions in package.json. Update with Reins releases.
- [增量更新的正确性] → 依赖 mtime 判断文件是否变化。极端情况下 mtime 不变但内容变化（git checkout）。Mitigate: `reins init --force` 强制全量重建。contentHash 作为二次校验。
