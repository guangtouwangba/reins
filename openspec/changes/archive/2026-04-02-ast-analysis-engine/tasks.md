## 1. 依赖安装和 tree-sitter 引导

- [ ] **Task 1.1: 安装 tree-sitter 依赖**
  - Description: 添加 `web-tree-sitter` 到 dependencies。添加语言 grammar 包到 dependencies：`tree-sitter-typescript`（含 TS 和 TSX）、`tree-sitter-javascript`、`tree-sitter-python`、`tree-sitter-go`、`tree-sitter-rust`。这些包自带预编译的 WASM 文件，无需原生编译。运行 `pnpm install` 确认安装成功。
  - Files: `package.json`
  - Tests: `pnpm install` 成功，无原生编译错误。`pnpm build` 通过。
  - Done when: 所有 tree-sitter 依赖安装完成，构建通过。

- [ ] **Task 1.2: 验证 WASM 文件可加载**
  - Description: 写一个最小测试脚本确认 `web-tree-sitter` 可以初始化，language WASM 文件可以加载。确认 `Parser.init()` 成功，`Parser.Language.load(wasmPath)` 对 TypeScript 语言成功。记录 WASM 文件的实际路径解析方式（`require.resolve` 或 `import.meta.resolve`）。
  - Files: `src/ast/ast.test.ts`（初始测试）
  - Tests: 测试 `Parser.init()` 不抛错。测试加载 typescript WASM 成功。测试解析一行 TypeScript 代码返回有效 tree。
  - Done when: tree-sitter WASM 引导在测试环境中通过。

## 2. AST 核心：解析器

- [ ] **Task 2.1: 创建类型定义 `src/ast/types.ts`**
  - Description: 定义核心类型：`ParsedFile`（tree, language, langId, filePath）、`QueryMatch`（pattern, captures[]）、`AstCheckResult`（passed, violations[]）、`QueryDef`（id, description, languages, queries）。导出语言映射常量 `LANG_MAP`（扩展名 → 语言 ID）。
  - Files: `src/ast/types.ts`
  - Tests: `pnpm typecheck` 通过。
  - Done when: 所有核心类型定义完整。

- [ ] **Task 2.2: 创建解析器 `src/ast/parser.ts`**
  - Description: 实现 `initParser()`（单例，调用 `Parser.init()` 并缓存实例）、`loadLanguage(langId)`（按需加载语言 WASM 并缓存）、`detectLanguage(filePath)`（从文件扩展名查 LANG_MAP）、`parseFile(filePath, content): Promise<ParsedFile | null>`（检测语言 → 加载语言 → 设置 parser → 解析 → 返回 ParsedFile）。文件超过 200KB 返回 null。不支持的扩展名返回 null。
  - Files: `src/ast/parser.ts`
  - Tests: 测试 `.ts` 文件检测为 typescript。测试 `.py` 文件检测为 python。测试 `.css` 文件返回 null（不支持）。测试解析 TypeScript 代码返回有效 ParsedFile。测试解析 Python 代码返回有效 ParsedFile。测试超过 200KB 的内容返回 null。测试语法错误的文件仍可解析（tree-sitter 容错解析）。
  - Done when: 解析器支持 TS/TSX/JS/JSX/Python/Go/Rust，优雅降级。

- [ ] **Task 2.3: 创建查询执行器 `src/ast/query-runner.ts`**
  - Description: 实现 `runQuery(parsed, querySource): QueryMatch[]`。用 `parsed.language.query(querySource)` 编译 S-expression 查询，用 `query.matches(parsed.tree.rootNode)` 执行。将 tree-sitter 的匹配结果映射为 `QueryMatch` 类型（保留 capture name 和 SyntaxNode）。无效查询 S-expression 捕获异常返回空数组。
  - Files: `src/ast/query-runner.ts`
  - Tests: 测试对 TypeScript 代码执行 `(import_statement) @match` 返回匹配数。测试对无匹配的查询返回空数组。测试无效的 S-expression 返回空数组（不崩溃）。
  - Done when: 查询执行可靠，错误处理完善。

## 3. 预置查询库

- [ ] **Task 3.1: TypeScript/JavaScript 查询 `src/ast/queries/typescript.ts`**
  - Description: 导出 TypeScript/JavaScript 预置查询数组 `TS_QUERIES: QueryDef[]`。包含以下查询：
    - `try-catch`: `(try_statement handler: (catch_clause) @catch) @try`
    - `untyped-export-functions`: `(export_statement declaration: (function_declaration name: (identifier) @name !return_type)) @match`
    - `relative-imports`: `(import_statement source: (string (string_fragment) @src) (#match? @src "^\\.\\.?/")) @match`
    - `class-declarations`: `(class_declaration name: (type_identifier) @name) @match`
    - `new-expressions`: `(new_expression constructor: (_) @ctor) @match`
    - `type-only-imports`: `(import_statement "type" source: (string (string_fragment) @src)) @match`
  - Files: `src/ast/queries/typescript.ts`
  - Tests: 对每个查询写 1 个正例（有匹配）和 1 个反例（无匹配）。测试 try-catch 查询不匹配注释中的 try。测试 relative-imports 匹配 `'./foo'` 不匹配 `'react'`。
  - Done when: 6 个 TypeScript 查询可用且经过测试。

- [ ] **Task 3.2: Python 查询 `src/ast/queries/python.ts`**
  - Description: 导出 Python 预置查询数组 `PY_QUERIES: QueryDef[]`。包含：
    - `try-except`: `(try_statement (except_clause) @except) @try`
    - `bare-except`: `(except_clause !type) @match`（无类型的 except，即 `except:`）
    - `class-definitions`: `(class_definition name: (identifier) @name) @match`
    - `import-statements`: `(import_statement) @match` 和 `(import_from_statement) @match`
  - Files: `src/ast/queries/python.ts`
  - Tests: 测试 bare-except 匹配 `except:` 不匹配 `except ValueError:`。测试 try-except 匹配 Python try/except 结构。
  - Done when: 4 个 Python 查询可用。

- [ ] **Task 3.3: Go 查询 `src/ast/queries/go.ts`**
  - Description: 导出 Go 预置查询数组 `GO_QUERIES: QueryDef[]`。包含：
    - `panic-calls`: `(call_expression function: (identifier) @fn (#eq? @fn "panic")) @match`
    - `bare-returns`: `(return_statement) @match`（用于检测错误忽略模式）
    - `type-declarations`: `(type_declaration (type_spec name: (type_identifier) @name)) @match`
  - Files: `src/ast/queries/go.ts`
  - Tests: 测试 panic-calls 匹配 `panic("msg")` 不匹配 `fmt.Println("panic")`。
  - Done when: 3 个 Go 查询可用。

- [ ] **Task 3.4: 查询注册表 `src/ast/queries/index.ts`**
  - Description: 合并所有语言查询为统一的 `QUERY_REGISTRY: QueryDef[]`。导出 `getQuery(id, langId): string | null` 函数，按 ID + 语言查找查询 S-expression。导出 `listQueries(): QueryDef[]` 列出所有可用查询。处理同一 ID 在不同语言中对应不同 S-expression 的情况（如 `try-catch` 在 TS 和 Python 中不同）。
  - Files: `src/ast/queries/index.ts`
  - Tests: 测试 `getQuery('try-catch', 'typescript')` 返回有效 S-expression。测试 `getQuery('bare-except', 'typescript')` 返回 null（Python only）。测试 `getQuery('unknown', 'typescript')` 返回 null。测试 `listQueries()` 返回完整列表。
  - Done when: 注册表统一管理所有语言查询。

## 4. 约束检查器

- [ ] **Task 4.1: 实现约束检查器 `src/ast/constraint-checker.ts`**
  - Description: 导出 `runAstCheck(astPattern, filePath, content, constraintRule): Promise<AstCheckResult | null>`。逻辑：1) 调用 `parseFile()` 解析文件，失败返回 null。2) 解析 `astPattern`：先尝试 `getQuery(astPattern, langId)` 查预置查询 ID，找不到则把 `astPattern` 当作内联 S-expression。3) 调用 `runQuery()` 执行查询。4) 无匹配 → passed: true。有匹配 → passed: false，从匹配节点提取行号、列号、节点文本作为 violations。5) 查询编译失败（无效 S-expression）返回 null。
  - Files: `src/ast/constraint-checker.ts`
  - Tests: 测试预置 ID `try-catch` 对有 try/catch 的 TS 代码返回 passed: false。测试对干净代码返回 passed: true。测试内联 S-expression `(class_declaration) @match` 检测到 class。测试对 Python 文件用 `bare-except` 查询能检测 `except:`。测试不支持的文件扩展名返回 null。测试无效 S-expression 返回 null。
  - Done when: 支持预置 ID 和内联 S-expression 两种模式。

## 5. 约束 Schema 扩展

- [ ] **Task 5.1: 在 ConstraintEnforcement 中添加 `ast_pattern` 字段**
  - Description: 在 `src/constraints/schema.ts` 的 `ConstraintEnforcement` 接口添加 `ast_pattern?: string`。值可以是预置查询 ID（如 `try-catch`）或内联 tree-sitter S-expression（如 `(class_declaration) @match`）。现有约束无此字段时行为不变。
  - Files: `src/constraints/schema.ts`
  - Tests: `pnpm typecheck` 通过。现有约束正常工作。
  - Done when: Schema 扩展完成，向后兼容。

- [ ] **Task 5.2: 更新约束模板添加 `ast_pattern`**
  - Description: 在 TypeScript 约束模板中为适合 AST 检查的约束添加 `ast_pattern` 字段，同时保留 `hook_check` 作为 fallback。在 Python 约束模板中添加 `bare-except` 等查询。示例：`no-try-catch` 约束同时有 `hook_check: 'try\s*\{'` 和 `ast_pattern: try-catch`。
  - Files: `src/constraints/templates/` 下相关模板文件
  - Tests: 测试生成的约束包含 `ast_pattern` 字段。测试无 AST 引擎时 `hook_check` 仍然生效。
  - Done when: TS 和 Python 模板使用 AST 查询，其他语言保持正则。

## 6. Project Index：递归全仓库扫描

- [ ] **Task 6.1: 实现 fact 提取器 `src/ast/fact-extractor.ts`**
  - Description: 导出 `extractFacts(parsed: ParsedFile): FileFacts`。对单个已解析文件，执行多个 tree-sitter 查询提取结构化事实：imports（来源、风格、是否 type-only）、exports（名称、类型、是否有返回类型）、tryCatchCount、classCount、functionNames（名称 + 命名风格）、apiUsages。查询从 `FACT_QUERIES[langId]` 获取（每种语言一组专用 fact 查询）。某种查询不适用于当前语言时跳过（如 import style 对 Go 不适用）。
  - Files: `src/ast/fact-extractor.ts`
  - Tests: 测试对 TypeScript 文件提取 imports（relative/alias/package 分类正确）。测试提取 exports（hasReturnType 正确）。测试提取 tryCatchCount。测试对 Python 文件提取 class 和 try/except。测试空文件返回全零 facts。
  - Done when: 每种支持语言的 fact 提取完整，覆盖所有 FileFacts 字段。

- [ ] **Task 6.2: 实现项目索引构建 `src/ast/project-index.ts`**
  - Description: 导出 `buildProjectIndex(projectRoot, filePaths, existingIndex?): Promise<ProjectIndex>`。递归处理 filePaths 中所有支持语言的文件（filePaths 来自现有 directory scanner，已排除 node_modules 等）。对每个文件：检查 mtime，如果与 existingIndex 中一致则复用缓存的 FileAstEntry；否则读取文件内容、调用 `parseFile()` + `extractFacts()`、构建新 entry。跳过超过 200KB 的文件。所有文件处理完后调用 `aggregateFacts()` 生成项目级聚合数据。导出 `saveProjectIndex()` 和 `loadProjectIndex()` 用于持久化到 `.reins/ast-index.json`。
  - Files: `src/ast/project-index.ts`
  - Tests: 测试对含 5 个 TS 文件的临时项目构建索引 → 5 个 entries + 正确的 aggregated。测试增量更新：修改 1 个文件的 mtime → 只重新解析该文件，其余复用缓存。测试不支持的文件被跳过。测试超大文件被跳过。测试 saveProjectIndex + loadProjectIndex 往返正确。
  - Done when: 全仓库递归扫描 + 增量缓存 + 持久化完整。

- [ ] **Task 6.3: 实现聚合函数 `aggregateFacts()`**
  - Description: 在 `src/ast/project-index.ts` 中实现。遍历所有 FileAstEntry，聚合：languageBreakdown（每种语言多少文件）、importStyle（relative/alias/package 总计）、tryCatchDensity（总 tryCatch / 总文件数）、namingStyle（各风格计数）、typeCoverage（typed/untyped exports）、classCount。返回 `AggregatedFacts`。
  - Files: `src/ast/project-index.ts`
  - Tests: 测试 3 个文件（2 个 TS + 1 个 Python）聚合后 languageBreakdown 正确。测试 import 风格聚合（5 relative + 3 alias → importStyle.relative = 5）。测试空 entries → 全零聚合。
  - Done when: 聚合逻辑覆盖所有 AggregatedFacts 字段。

- [ ] **Task 6.4: 实现跨文件查询 API `src/ast/project-query.ts`**
  - Description: 导出 `queryImportStyle(index): { dominant, breakdown }`（从聚合数据判断主要 import 风格）。导出 `queryFilesWithPattern(index, predicate): string[]`（按条件过滤文件，如"所有有 try/catch 的文件"）。导出 `queryDirectoryFacts(index, dirPrefix): AggregatedFacts`（按目录前缀过滤后重新聚合，如 `src/auth/` 的类型覆盖率）。
  - Files: `src/ast/project-query.ts`
  - Tests: 测试 queryImportStyle 返回正确的 dominant 风格。测试 queryFilesWithPattern 过滤 tryCatchCount > 0 的文件。测试 queryDirectoryFacts 按目录聚合。测试空 index 不报错。
  - Done when: 跨文件查询 API 可用，支持目录级聚合。

- [ ] **Task 6.5: 实现 init 全流程进度反馈**
  - Description: 定义 `InitProgress` 类型（phase: 'scan' | 'detect' | 'ast-parse' | 'constraints' | 'context' | 'hooks' | 'done', message, current?, total?）和 `ProgressCallback`。`buildProjectIndex()` 接受可选的 `onProgress` 参数，在 ast-parse 阶段每处理一个文件调用一次。在 `src/commands/init.ts` 中，整个 init 流程的各阶段（目录扫描、技术栈检测、AST 解析、约束生成、上下文生成、Hook 生成）都通过同一回调报告进度。CLI 端用 `\r` 覆盖式渲染：无 total 时显示 `message...`，有 total 时显示进度条 `[████░░░░] 65% (130/200)`。增量模式下缓存命中的文件也计入进度。阶段结束后输出换行，不影响后续 summary。
  - Files: `src/ast/types.ts`, `src/ast/project-index.ts`, `src/commands/init.ts`
  - Tests: 测试 onProgress 在 ast-parse 阶段被调用正确次数。测试不传 onProgress 时不报错。测试 CLI 输出包含进度百分比（可通过捕获 stdout 验证）。
  - Done when: `reins init` 全流程有实时进度反馈，用户在任何阶段都能看到当前状态，不会以为命令行卡死。

## 7. Scanner L2 集成

- [ ] **Task 7.1: 重写 `analyzePatterns()` 消费 Project Index**
  - Description: 重写 `src/scanner/pattern-analyzer.ts`。`analyzePatterns()` 改为 async。调用 `buildProjectIndex()` 构建/增量更新全仓库索引，调用 `saveProjectIndex()` 持久化。`inferConventions()` 改为 `inferConventionsFromIndex(index)`，从 `index.aggregated` 读取聚合数据映射到 `ConventionsInfo` 字段。不再采样——数据来自全量扫描。保留 `inferArchitecture()` 不变（目录结构分析不需要 AST）。
  - Files: `src/scanner/pattern-analyzer.ts`
  - Tests: 测试对含 TS+Python 文件的临时项目，命名风格、import 风格、tryCatch 密度从全量索引正确计算。测试返回类型兼容现有 ConventionsInfo。测试 `.reins/ast-index.json` 被写入。
  - Done when: Scanner L2 使用全仓库 AST 索引，不再采样。

## 8. Gate 集成

- [ ] **Task 8.1: 在 gate post-edit 中添加 AST 检查**
  - Description: 修改 `src/gate/post-edit.ts`（依赖 `2026-04-02-reins-gate-subcommand`）。在约束检查循环中，如果约束有 `ast_pattern` 字段，优先调用 `runAstCheck()`。`runAstCheck` 返回非 null 且 passed: false → 根据 hook_mode 决定 block 或 warn，输出 violation 的行号和消息。返回 null → fallback 到 `hook_check` 正则。注意：gate post-edit 需要改为 async（因为 tree-sitter 初始化是 async 的）。Gate 对单文件做实时 AST 分析，不依赖 project index（保证 < 100ms）。
  - Files: `src/gate/post-edit.ts`
  - Tests: 测试约束有 `ast_pattern: 'try-catch'` 且 TS 文件有 try/catch → block。测试同一约束对 `.py` 文件有 try/except → 也能 block（多语言）。测试 `.css` 文件 → 跳过 AST，fallback 到正则。测试无效 ast_pattern → fallback 到 hook_check 正则。
  - Done when: Gate 支持 AST 检查，多语言，正确 fallback。

- [ ] **Task 8.2: gate context 加载 Project Index 提供聚合上下文**
  - Description: 修改 `src/gate/context.ts`（依赖 `2026-04-02-reins-gate-subcommand`）。在上下文注入时，如果 `.reins/ast-index.json` 存在，加载 Project Index 并在注入文本中附加项目代码特征摘要：主要语言、import 风格、命名规范、类型覆盖率、tryCatch 密度。格式如 `[Reins Code Profile] 142 TS files, alias imports (87%), camelCase, 92% typed exports`。
  - Files: `src/gate/context.ts`
  - Tests: 测试有 ast-index.json 时输出包含 `[Reins Code Profile]`。测试无 ast-index.json 时不报错，不输出 profile。
  - Done when: Gate context 注入项目代码特征。

## 9. 工具函数

- [ ] **Task 9.1: 创建 `src/ast/utils.ts`**
  - Description: 导出 `classifyNamingStyle(name): string`（判断 camelCase/PascalCase/snake_case/UPPER_SNAKE/kebab-case/other）。导出 `nodeToLocation(node): { line: number; column: number }`（从 SyntaxNode 提取 1-based 行号和列号）。导出 `isSupportedFile(filePath): boolean`（检查扩展名在 LANG_MAP 中）。
  - Files: `src/ast/utils.ts`
  - Tests: 测试 classifyNamingStyle 覆盖所有风格。测试 nodeToLocation 返回正确行号。
  - Done when: 工具函数完整。

## 10. 测试和验证

- [ ] **Task 10.1: 解析器和查询执行器测试**
  - Description: 在 `src/ast/ast.test.ts` 中编写测试。覆盖：tree-sitter 初始化、多语言解析（TS/Python/Go）、查询执行（正例 + 反例）、错误处理（无效查询、不支持的文件）。至少 20 个测试用例。使用内联代码字符串作为输入。
  - Files: `src/ast/ast.test.ts`
  - Tests: 所有测试通过。
  - Done when: 核心解析和查询经过充分测试。

- [ ] **Task 10.2: Project Index 集成测试**
  - Description: 创建临时目录，写入 10 个多语言源文件（TS/Python/Go），运行 `buildProjectIndex()`。验证：所有文件被解析、facts 正确、aggregated 正确。修改 2 个文件，再次运行 → 验证只有 2 个文件被重新解析（增量）。验证 save/load 往返正确。验证 `queryDirectoryFacts()` 按目录聚合正确。
  - Files: `src/ast/ast.test.ts`
  - Tests: 全仓库扫描 + 增量更新 + 查询 API 的集成测试。
  - Done when: Project Index 端到端测试通过。

- [ ] **Task 10.3: 约束检查器集成测试**
  - Description: 测试 `runAstCheck()` 的完整流程。对 TypeScript、Python、Go 各写 2-3 个测试用例：预置查询 ID 匹配、内联 S-expression 匹配、不支持的文件 fallback。测试结果的 violations 包含正确的行号和消息。
  - Files: `src/ast/ast.test.ts`
  - Tests: 约束检查器对多语言均可工作。
  - Done when: 检查器集成测试覆盖核心场景。

- [ ] **Task 10.4: 回归测试和完整验证**
  - Description: 运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`。确认无回归。在 Reins 自身代码上运行 `buildProjectIndex()` 验证：所有 TS 文件被解析、aggregated 数据合理（import 风格、命名规范、try/catch 密度）。验证 gate post-edit 在有 `ast_pattern` 的约束下正确工作。验证 `.reins/ast-index.json` 大小合理。
  - Files: 无（验证）
  - Tests: 全部通过。
  - Done when: lint、typecheck、test 全绿；Reins 自身的 AST 索引数据合理。
