# 模块 ②：Scanner（代码库探索器）

## 职责

扫描目标项目，产出结构化的项目理解数据，为后续约束生成提供输入。

**输入**：项目根目录路径 + 扫描配置
**输出**：`context.json` (CodebaseContext) + `manifest.json` (目录快照) + `patterns.json` (检测到的模式)

---

## 核心数据结构

```typescript
interface CodebaseContext {
  // 1. 技术栈识别
  stack: {
    language: string[];          // 文件扩展名 + package.json/go.mod/Cargo.toml
    framework: string[];         // 依赖声明
    buildTool: string;           // webpack/vite/esbuild/make/gradle...
    testFramework: string;       // jest/pytest/go test/cargo test
    packageManager: string;      // npm/pnpm/yarn/pip/cargo
  };

  // 2. 架构模式
  architecture: {
    pattern: string;             // monolith/microservice/monorepo/library
    layers: string[];            // 从目录结构推断 (api/service/repo/model)
    entryPoints: string[];       // main files, route files
  };

  // 3. 代码约定
  conventions: {
    naming: string;              // camelCase/snake_case/PascalCase
    fileStructure: string;       // flat/nested/feature-based/layer-based
    importStyle: string;         // relative/absolute/alias
    configFormat: string;        // env/yaml/json/toml
  };

  // 4. 已有约束
  existingRules: {
    linter: object | null;       // .eslintrc / pylint / clippy config
    formatter: object | null;    // prettier / black / rustfmt config
    typeCheck: boolean;          // tsconfig strict mode etc.
    cicd: object | null;         // .github/workflows, Jenkinsfile
  };

  // 5. 测试模式
  testing: {
    framework: string;
    pattern: string;             // __tests__/foo.test.ts vs test/foo_test.go
    coverage: number | null;     // CI config 或 coverage reports
    fixtures: string[];          // 测试 fixture/mock 位置
  };

  // 6. 目录结构摘要
  structure: DirectoryManifest;

  // 7. 关键文件
  keyFiles: {
    readme: string | null;
    contributing: string | null;
    changelog: string | null;
    lockfile: string | null;
  };
}
```

---

## 6 层扫描深度

| 层级 | 方法 | 成本 | 信息量 | MVP |
|------|------|------|-------|-----|
| **L0** | 文件名/扩展名扫描 | 极低 | 技术栈、测试框架 | Yes |
| **L1** | 配置文件解析 | 低 | 依赖、lint 规则、CI | Yes |
| **L2** | 目录结构分析 | 低 | 架构模式、约定 | Yes |
| **L3** | 采样文件 AST 分析 | 中 | 编码约定、模式 | No |
| **L4** | Git 历史分析 | 中 | 活跃区域、贡献者 | No |
| **L5** | LLM 代码理解 | 高 | 业务逻辑、设计意图 | No |

**MVP 只需 L0-L2**，已经足够生成有用的约束文件。

### L0：文件名/扩展名扫描

```typescript
// 检测信号
const STACK_SIGNALS = {
  'package.json': 'javascript/typescript',
  'go.mod': 'go',
  'Cargo.toml': 'rust',
  'pyproject.toml': 'python',
  'build.gradle': 'java',
  'pom.xml': 'java',
};

const FRAMEWORK_SIGNALS = {
  'next.config.*': 'next.js',
  'nuxt.config.*': 'nuxt',
  'vite.config.*': 'vite',
  'angular.json': 'angular',
  'svelte.config.*': 'svelte',
};

const TEST_SIGNALS = {
  'jest.config.*': 'jest',
  'vitest.config.*': 'vitest',
  'pytest.ini': 'pytest',
  'phpunit.xml': 'phpunit',
};
```

### L1：配置文件解析

```typescript
// 从 package.json 提取
function parsePackageJson(projectRoot: string): StackInfo {
  const pkg = readJson(`${projectRoot}/package.json`);
  return {
    language: pkg.devDependencies?.typescript ? ['typescript'] : ['javascript'],
    framework: detectFramework(pkg.dependencies),
    testFramework: detectTestFramework(pkg.devDependencies),
    packageManager: detectPackageManager(projectRoot), // lock file 推断
    scripts: pkg.scripts || {},
  };
}

// 从 tsconfig.json 提取
function parseTsConfig(projectRoot: string): TypeCheckInfo {
  const tsconfig = readJson(`${projectRoot}/tsconfig.json`);
  return {
    strict: tsconfig.compilerOptions?.strict ?? false,
    paths: tsconfig.compilerOptions?.paths || {},
    target: tsconfig.compilerOptions?.target,
  };
}

// 从 .eslintrc 提取
function parseEslintConfig(projectRoot: string): LinterInfo { ... }

// 从 .github/workflows/*.yml 提取
function parseCIConfig(projectRoot: string): CICDInfo { ... }
```

### L2：目录结构分析

```typescript
// 架构模式推断
function inferArchitecturePattern(dirs: string[]): string {
  // monorepo: 有 packages/ 或 apps/
  if (dirs.some(d => d.match(/^(packages|apps|modules)\//))) return 'monorepo';

  // microservice: 有 docker-compose + 多个 service 目录
  if (hasDockerCompose && dirs.filter(d => d.match(/service/)).length > 1) return 'microservice';

  // layer-based: 有明确的分层目录
  const layers = ['api', 'service', 'repository', 'model', 'controller'];
  if (layers.filter(l => dirs.some(d => d.includes(l))).length >= 3) return 'layered';

  return 'monolith';
}

// 命名约定推断
function inferNamingConvention(files: string[]): string {
  const sourceFiles = files.filter(f => f.match(/\.(ts|js|py|go|rs)$/));
  const camelCount = sourceFiles.filter(f => f.match(/[a-z][A-Z]/)).length;
  const snakeCount = sourceFiles.filter(f => f.match(/[a-z]_[a-z]/)).length;
  const pascalCount = sourceFiles.filter(f => f.match(/^[A-Z][a-z]/)).length;
  // 返回占比最高的
  ...
}
```

### L3-L5（后续 Phase）

- **L3 AST 分析**：采样 5-10 个核心文件，分析 import 模式、错误处理模式、类型使用
- **L4 Git 历史**：活跃区域（最近 30 天最多修改的目录）、贡献者分布
- **L5 LLM 理解**：将采样文件发送给 LLM，理解业务逻辑和设计意图

---

## 环境检测（供评估系统使用）

```typescript
// scanner/environment-detector.ts
interface EnvironmentDetection {
  startCommand: string | null;       // pnpm dev / npm start
  port: number | null;               // 3000
  healthEndpoint: string | null;     // /api/health
  dependencies: ExternalDependency[]; // PostgreSQL, Redis...
  database: DatabaseConfig | null;    // Prisma / TypeORM
  hasDockerCompose: boolean;
  hasPlaywright: boolean;
}

function detectEnvironment(projectRoot: string): EnvironmentDetection {
  // 从 package.json scripts 检测启动命令
  // 从 next.config / vite.config / .env 检测端口
  // 从 app/api/health/ 检测健康检查端点
  // 从 docker-compose.yml 检测外部依赖
  // 从 dependencies 检测数据库 ORM
  // 从 devDependencies 检测 Playwright
}
```

---

## 增量扫描

`/reins update` 不需要全量重扫，通过 manifest diff 实现增量：

```typescript
function incrementalScan(projectRoot: string): IncrementalResult {
  const prevManifest = loadManifest(projectRoot);
  const currManifest = scanDirectories(projectRoot);
  const diff = diffManifest(prevManifest, currManifest);

  return {
    added: diff.addedDirs,       // 新增目录
    removed: diff.removedDirs,   // 删除目录
    modified: diff.modifiedFiles, // 修改文件
    newDependencies: detectNewDeps(prevManifest, currManifest),
    removedDependencies: detectRemovedDeps(prevManifest, currManifest),
  };
}
```

---

## 子模块 & 源码结构

```
src/scanner/
├── directory-scanner.ts      # 目录结构扫描（L0）
├── stack-detector.ts         # 技术栈检测（L0-L1）
├── pattern-analyzer.ts       # 架构模式分析（L2）
├── rule-detector.ts          # 已有 lint/format 规则检测（L1）
├── test-detector.ts          # 测试框架检测（L0-L1）
├── environment-detector.ts   # 运行环境检测（L1-L2）
└── index.ts                  # 统一入口：scan(projectRoot, depth) → CodebaseContext
```

---

## 依赖关系

- **被依赖**：③ Constraint Generator、⑦ Evaluation System
- **依赖**：① State（manifest 读写）
- **外部依赖**：glob (文件匹配), yaml/json (配置解析)

---

## 实施优先级

- **MVP**：L0-L2 扫描 + environment-detector 基础版
- **Phase 4**：L3 AST 分析
- **Phase 5**：L4 Git 历史 + L5 LLM 理解
