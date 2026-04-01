## Why

Reins 当前的代码分析完全基于正则表达式。`src/scanner/pattern-analyzer.ts` 用 `inferConventions()` 统计文件名命名风格，用简单字符串匹配推断架构模式。约束检查（`hook_check` 字段）也是正则：`grep -qE 'try.*catch'`。

这在三个层面上不够：

1. **约束检查不准确**：`try.*catch` 正则会匹配注释、字符串、变量名中包含 "try" 和 "catch" 的代码。它无法区分 `try { } catch` 语句和 `// Don't use try/catch, use Result` 这样的注释。结果：误报导致 Hook 被忽略，block 模式不敢开。

2. **模式分析太粗糙**：当前 L2 scanner 声称能检测 "import style"（relative vs alias）、"error handling pattern"（try/catch vs Result），但实际是用正则在采样文件上跑。它分不清 `import type { Foo }` 和 `import { Foo }`，分不清 `catch(e) { throw e }` 和 `catch(e) { return Result.err(e) }`。推断出的约束缺乏可信度。

3. **Gate 需要语义检查**：`reins gate post-edit`（见 `2026-04-02-reins-gate-subcommand`）目前只能用正则检查编辑后的文件。如果能做 AST 分析，gate 就可以检查："这个文件是否有未标注返回类型的导出函数"、"这个模块是否直接 import 了另一个模块的内部文件"。

4. **只支持一种语言**：TypeScript Compiler API 只能分析 TS/JS。Reins 声称支持 Python、Go、Rust、Java 项目，但对这些语言没有任何代码分析能力，只能做文件名和目录名匹配。

**AST 分析引擎是 Reins 从"字符串匹配工具"升级为"语义理解工具"的关键。**

具体受限的场景：

| 场景 | 正则能做 | AST 能做 |
|------|---------|---------|
| 检测 try/catch 使用 | 匹配字符串 `try {`，误报注释 | 精确找到 try_statement 节点 |
| 检测未标注类型的函数 | 无法做 | 查询无 return_type 的 function_declaration |
| 检测跨模块导入 | 匹配 `import.*from` 字符串 | 解析 import_statement 的 source 路径 |
| 检测 Python 的 bare except | 匹配 `except:` 字符串，误报 | 精确找到无类型的 except_clause |
| 检测错误处理模式 | 匹配 `catch` 字符串 | 分析 catch_clause 内的处理逻辑 |

## What Changes

### 1. AST 分析引擎 (`src/ast/`)

基于 **tree-sitter** 的多语言代码分析层。tree-sitter 是一个增量解析框架，支持 40+ 种语言，解析速度极快（单文件 < 10ms），且不需要项目配置或编译器工具链。

通过 `web-tree-sitter`（WASM 版本）使用，无需原生编译，跨平台兼容。

首批支持的语言：
- TypeScript / TSX
- JavaScript / JSX
- Python
- Go
- Rust

### 2. 双层查询接口

**底层：tree-sitter S-expression 查询**

tree-sitter 自带查询语言，用 S-expression 描述要匹配的语法树模式：

```scheme
; 找到所有 try/catch 语句
(try_statement
  body: (statement_block) @try_body
  handler: (catch_clause
    parameter: (_)? @catch_param
    body: (statement_block) @catch_body))
```

**上层：约束模式语法（ast_pattern）**

面向约束作者的简化语法，约束可直接在 YAML 中声明 tree-sitter 查询模式：

```yaml
constraints:
  - id: no-try-catch
    rule: Use Result<T,E> for error handling, not try/catch
    enforcement:
      hook: true
      hook_type: post_edit
      hook_check: 'try\s*\{'                           # fallback: regex
      ast_pattern: '(try_statement) @match'             # preferred: tree-sitter query
```

### 3. 预置查询库 (`src/ast/queries/`)

按语言组织的预置查询集合，覆盖常见约束场景：

| 查询 ID | 支持语言 | 检测内容 |
|---------|---------|---------|
| `try-catch` | TS/JS/Python/Go/Rust | try/catch 或 try/except 语句 |
| `untyped-exports` | TS | 无返回类型标注的导出函数 |
| `import-style` | TS/JS | 导入风格（relative/alias/package） |
| `class-declarations` | TS/JS/Python | 类定义 |
| `api-usage` | all | 特定 API 调用（可配参数） |
| `error-handling` | TS/JS/Python | 错误处理模式分类 |
| `naming-conventions` | all | 标识符命名风格 |

### 4. Project Index — 递归全仓库扫描 (`src/ast/project-index.ts`)

**不再采样 30 个文件，而是递归扫描整个仓库所有源文件**，构建项目级 AST 索引：

- 递归遍历所有支持语言的源文件（排除 node_modules、.git 等）
- 对每个文件解析 AST，提取结构化 facts（imports、exports、try/catch、class、命名）
- 聚合为项目级统计（import 风格占比、命名规范、类型覆盖率、错误处理密度）
- 索引持久化到 `.reins/ast-index.json`
- 增量更新：基于文件 mtime，只重新解析变化的文件

### 5. Scanner L2 升级 (`src/scanner/pattern-analyzer.ts`)

Scanner L2 不再自己做模式分析，而是消费 Project Index 的全量聚合数据：

- Import 风格：从全量 import 统计判断（而非 30 个文件的采样）
- 错误处理密度：全仓库 try/catch 总量 / 文件数
- 类型覆盖率：全仓库导出函数的有/无返回类型比例
- 命名规范：从 AST 提取的全部函数名/变量名统计，而不是文件名

### 5. Gate 集成

`reins gate post-edit` 可以使用 AST 检查器代替正则检查。当约束有 `ast_pattern` 字段时，调用 tree-sitter 查询；没有时 fallback 到 `hook_check` 正则。

### 6. 约束 Schema 扩展

在 `ConstraintEnforcement` 中添加 `ast_pattern?: string` 字段，值为 tree-sitter S-expression 查询。Gate 对支持的语言文件执行查询，有匹配则触发约束。

## Capabilities

### New Capabilities
- `ast-engine`: tree-sitter 驱动的多语言 AST 解析引擎
- `ast-queries`: 按语言组织的预置查询库
- `ast-constraint-checker`: 基于 tree-sitter 查询的约束检查，替代正则
- `ast-scanner`: L2 模式分析的 AST 升级

### Modified Capabilities
- `pattern-analyzer`: L2 模式分析使用 AST 代替正则（渐进式，非破坏性）
- `gate-post-edit`: 支持 `ast_pattern` 查询（`2026-04-02-reins-gate-subcommand` 依赖）
- `constraint-schema`: 新增 `ast_pattern` 字段

## Impact

- Affected code: `src/ast/` (new directory), `src/scanner/pattern-analyzer.ts` (rewrite internals), `src/constraints/schema.ts` (add ast_pattern field), `src/gate/post-edit.ts` (use AST checker when available)
- Affected systems: Scanner (L2 analysis), Hook/Gate system (constraint checking), Constraint schema
- New dependencies: `web-tree-sitter`, `tree-sitter-typescript`, `tree-sitter-javascript`, `tree-sitter-python`, `tree-sitter-go`, `tree-sitter-rust` (all WASM, no native compilation)
- APIs/UX: No user-facing CLI changes. Constraints gain optional `ast_pattern` field. Scanner output becomes more accurate. Multi-language support automatic.
- Phase: P3 — builds on gate subcommand (P2) and existing scanner infrastructure
- Dependencies: `2026-04-02-reins-gate-subcommand` (gate post-edit integration)

## Design Principles

1. **多语言原生支持**：tree-sitter 支持 40+ 语言，用同一套引擎分析 TS、Python、Go、Rust。不需要为每种语言维护独立的分析器。
2. **WASM，无原生依赖**：使用 `web-tree-sitter`（WASM 编译版本），不需要 C 编译器、不需要 node-gyp。`npm install` 即可用。
3. **渐进式替换**：AST 和正则共存。约束可以同时声明 `ast_pattern` 和 `hook_check`，优先用 AST，fallback 到正则。
4. **声明式约束**：约束作者直接写 tree-sitter 查询模式，不需要写代码。`ast_pattern: '(try_statement) @match'` 就是一个完整的约束检查。
5. **极快**：tree-sitter 解析单文件 < 10ms（比 TypeScript Compiler API 的 50ms 快 5 倍）。Gate hook 中零感知。
6. **只读**：AST 引擎只读取和分析代码，不修改代码。

## Risks / Trade-offs

- [WASM 文件增加包体积] → 每个语言的 WASM 文件约 500KB-2MB。5 种语言约 5-8MB。Mitigate: 按需加载（只加载项目实际使用的语言），lazy import。
- [tree-sitter 查询语法学习成本] → Mitigate: 提供预置查询库覆盖常见场景。用户只需在 `ast_pattern` 中填查询 ID 或简单的 S-expression。
- [tree-sitter 的 CST 比 AST 更底层] → tree-sitter 生成具体语法树（保留所有 token），节点类型名因语言而异。Mitigate: 预置查询封装了语言差异，用户不需要关心。
- [web-tree-sitter 比 native tree-sitter 慢] → WASM 版本约为 native 的 60-70% 速度，但仍然 < 10ms/文件。对 Reins 的场景完全足够。
- [语言 grammar 版本需要跟踪更新] → Mitigate: 锁定具体版本，随 Reins 版本更新。grammar 不频繁变化。
