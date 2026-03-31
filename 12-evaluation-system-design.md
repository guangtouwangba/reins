# 评估系统设计

## 核心问题

```
测试通过 ≠ 功能正确 ≠ 需求满足 ≠ 可以上线
```

当前 Reins 的 QA 阶段只覆盖了 L0（lint + typecheck + test）。Ralph loop 的退出条件需要覆盖 L0-L4 全部层级，否则"自动化开发"只是"自动化写代码"，不是"自动化交付可工作的功能"。

---

## 分层评估模型

```
┌──────────────────────────────────────────────────────────┐
│                                                           │
│  L0: Static Check (< 30s, 确定性, 每次都跑)               │
│  ┌─────────────────────────────────────────────┐          │
│  │ build + lint + typecheck + 现有测试通过       │          │
│  │ → "代码没有语法/类型/风格错误"                 │          │
│  └─────────────────────────────────────────────┘          │
│                        ↓ 通过                             │
│  L1: Coverage Gate (< 2min, 确定性)                       │
│  ┌─────────────────────────────────────────────┐          │
│  │ 新代码有测试 + 测试覆盖核心路径 + 无 any/skip  │          │
│  │ → "变更被测试覆盖了"                          │          │
│  └─────────────────────────────────────────────┘          │
│                        ↓ 通过                             │
│  L2: Integration Verify (< 5min, 项目特异)                │
│  ┌─────────────────────────────────────────────┐          │
│  │ 启动服务 + 真实 HTTP 请求 + 验证响应          │          │
│  │ → "API/服务实际能工作"                        │          │
│  └─────────────────────────────────────────────┘          │
│                        ↓ 通过                             │
│  L3: E2E Verify (< 10min, 需要浏览器)                     │
│  ┌─────────────────────────────────────────────┐          │
│  │ Playwright 启动浏览器 + 完整用户流程          │          │
│  │ → "用户能完成完整操作"                        │          │
│  └─────────────────────────────────────────────┘          │
│                        ↓ 通过                             │
│  L4: Semantic Review (LLM 驱动)                           │
│  ┌─────────────────────────────────────────────┐          │
│  │ 需求 vs 实现对比 + 截图审查 + 契约验证        │          │
│  │ → "功能符合最初意图"                          │          │
│  └─────────────────────────────────────────────┘          │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

### 各层级适用场景

| 层级 | 耗时 | 适用 | Profile 映射 |
|------|------|------|-------------|
| L0 | < 30s | 所有变更 | relaxed/default/strict |
| L1 | < 2min | 所有非文档变更 | default/strict |
| L2 | < 5min | 后端 API / 服务变更 | strict |
| L3 | < 10min | 全栈 / UI 变更 | strict |
| L4 | < 1min | 重要功能 / 模糊需求 | strict |

---

## L0: Static Check — 确定性基线

这部分已在当前设计中覆盖，不再展开。

```bash
# 自动检测并运行
pnpm lint && pnpm typecheck && pnpm test
```

---

## L1: Coverage Gate — 测试覆盖保障

### 问题

agent 写了代码，也写了测试，但测试可能：
- 只测了 happy path
- 用 mock 绕过了关键逻辑
- 包含 `test.skip` 或空断言
- 覆盖率看起来高但实际没测核心分支

### 检查项

```typescript
interface CoverageGate {
  checks: [
    // 1. 新文件必须有测试
    { type: "new_file_has_test", rule: "每个新 .ts 文件有对应 .test.ts" },

    // 2. 测试不能是空壳
    { type: "no_empty_tests", rule: "不允许 test.skip / test.todo / 空 expect" },

    // 3. 核心路径覆盖
    { type: "branch_coverage", rule: "新代码分支覆盖率 >= 70%", tool: "c8/istanbul" },

    // 4. 错误路径覆盖
    { type: "error_path_tested", rule: "catch/error handler 必须有对应测试" },

    // 5. mock 审计
    { type: "mock_audit", rule: "mock 了外部依赖但没 mock 被测模块自身" },
  ]
}
```

### 实现方式

```bash
#!/bin/bash
# .reins/hooks/coverage-gate.sh (Stop hook)

# 检查 1: 新文件有测试
NEW_SRC=$(git diff --cached --name-only --diff-filter=A | grep -E '\.(ts|tsx)$' | grep -vE '\.test\.|\.spec\.|__tests__')
for f in $NEW_SRC; do
  BASE="${f%.ts}"
  BASE="${BASE%.tsx}"
  if ! ls "${BASE}.test.ts" "${BASE}.test.tsx" "${BASE}.spec.ts" 2>/dev/null | head -1 > /dev/null; then
    echo "⛔ L1: 新文件 $f 缺少测试" >&2; exit 2
  fi
done

# 检查 2: 空壳测试
EMPTY_TESTS=$(grep -rn 'test\.skip\|test\.todo\|it\.skip\|expect()$' --include='*.test.*' .)
if [ -n "$EMPTY_TESTS" ]; then
  echo "⛔ L1: 发现空壳测试:" >&2
  echo "$EMPTY_TESTS" >&2; exit 2
fi

# 检查 3: 覆盖率 (需要项目配置了 coverage)
if command -v npx &>/dev/null && [ -f "jest.config.*" ]; then
  COVERAGE=$(npx jest --coverage --coverageReporters=json-summary 2>/dev/null | jq '.total.branches.pct // 0')
  if [ "$(echo "$COVERAGE < 70" | bc)" = "1" ]; then
    echo "⛔ L1: 分支覆盖率 ${COVERAGE}% < 70%" >&2; exit 2
  fi
fi

echo "✅ L1: 覆盖度检查通过"
exit 0
```

---

## L2: Integration Verify — 集成验证（重点设计）

这是最难也最有价值的层级。核心挑战：**项目特异性**。

### 设计思路：验证配方（Verification Recipe）

`/reins init` 阶段不仅检测约束，还检测**项目的运行方式**，生成一个**可执行的验证配方**。

```yaml
# .reins/verification.yaml — 项目的验证配方
version: 1
generated_at: "2026-03-31"

# 项目运行环境
environment:
  # 如何启动项目
  start:
    command: "pnpm dev"
    port: 3000
    health_check: "http://localhost:3000/api/health"
    startup_timeout: 15s
    env_file: ".env.test"          # 测试用环境变量

  # 外部依赖
  dependencies:
    - name: "PostgreSQL"
      check: "pg_isready -h localhost -p 5432"
      setup: "docker compose up -d postgres"
      teardown: "docker compose down postgres"
    - name: "Redis"
      check: "redis-cli ping"
      setup: "docker compose up -d redis"
      teardown: "docker compose down redis"

  # 测试数据库
  database:
    type: "postgresql"
    setup: "pnpm prisma migrate reset --force"
    seed: "pnpm prisma db seed"
    teardown: "pnpm prisma migrate reset --force"

# 验证策略（按项目类型自动生成）
strategies:
  backend_api:
    enabled: true
    tool: "curl"                   # curl / httpie / playwright
    base_url: "http://localhost:3000"
    auth:
      type: "bearer"
      obtain: "curl -s -X POST /api/auth/login -d '{\"email\":\"test@test.com\",\"password\":\"test\"}' | jq -r '.token'"

  frontend_ui:
    enabled: true
    tool: "playwright"
    base_url: "http://localhost:3000"
    screenshots: true
    viewport: { width: 1280, height: 720 }

  e2e_flow:
    enabled: true
    tool: "playwright"
    base_url: "http://localhost:3000"
```

### Init 阶段的检测逻辑

```typescript
// scanner/environment-detector.ts

interface EnvironmentDetection {
  startCommand: string | null;
  port: number | null;
  healthEndpoint: string | null;
  dependencies: ExternalDependency[];
  database: DatabaseConfig | null;
  hasDockerCompose: boolean;
  hasPlaywright: boolean;
}

function detectEnvironment(projectRoot: string): EnvironmentDetection {
  const pkg = readPackageJson(projectRoot);
  const result: EnvironmentDetection = {
    startCommand: null, port: null, healthEndpoint: null,
    dependencies: [], database: null,
    hasDockerCompose: false, hasPlaywright: false,
  };

  // 检测启动命令
  if (pkg?.scripts?.dev) result.startCommand = `${pkg.packageManager || 'npm'} run dev`;
  if (pkg?.scripts?.start) result.startCommand ??= `${pkg.packageManager || 'npm'} start`;

  // 检测端口
  // 从 next.config.js / vite.config.ts / .env 中提取
  result.port = detectPort(projectRoot) || 3000;

  // 检测健康检查端点
  // 从 app/api/health/route.ts 或 routes/health.ts 中检测
  result.healthEndpoint = detectHealthEndpoint(projectRoot);

  // 检测外部依赖
  if (existsSync('docker-compose.yml') || existsSync('docker-compose.yaml')) {
    result.hasDockerCompose = true;
    result.dependencies = parseDockerCompose(projectRoot);
  }
  // 从 .env / .env.example 中检测 DATABASE_URL, REDIS_URL 等
  result.dependencies.push(...detectFromEnvFile(projectRoot));

  // 检测数据库
  if (pkg?.dependencies?.prisma || pkg?.dependencies?.['@prisma/client']) {
    result.database = { type: 'prisma', setup: 'npx prisma migrate reset --force' };
  } else if (pkg?.dependencies?.typeorm) {
    result.database = { type: 'typeorm', setup: 'npx typeorm migration:run' };
  }

  // 检测 Playwright
  result.hasPlaywright = !!(pkg?.devDependencies?.['@playwright/test'] || pkg?.devDependencies?.playwright);

  return result;
}
```

### 验证执行流程

```
/reins develop "添加头像上传 API"
    ↓
  ... coding 阶段 ...
    ↓
  L0: lint + typecheck + test ✓
  L1: coverage gate ✓
    ↓
  L2 触发（检测到涉及 API route）
    ↓
  ┌─────────────────────────────────────────────────┐
  │ L2 Integration Verify                           │
  │                                                  │
  │ 1. 准备环境                                      │
  │    ├── 检查外部依赖 (PostgreSQL ✓, Redis ✓)      │
  │    ├── 重置测试数据库 (prisma migrate reset)     │
  │    └── 准备测试数据 (prisma db seed)             │
  │                                                  │
  │ 2. 启动服务                                      │
  │    ├── pnpm dev (background)                    │
  │    ├── 等待 health check 通过 (max 15s)          │
  │    └── 服务就绪 ✓                                │
  │                                                  │
  │ 3. 执行验证                                      │
  │    ├── POST /api/avatar (multipart/form-data)   │
  │    │   → 期望 200 + { id, url }                 │
  │    │   → 实际 200 + { id, url } ✓               │
  │    ├── POST /api/avatar (无文件)                 │
  │    │   → 期望 400                               │
  │    │   → 实际 400 ✓                             │
  │    ├── POST /api/avatar (超大文件)               │
  │    │   → 期望 413                               │
  │    │   → 实际 413 ✓                             │
  │    ├── GET /api/avatar/:id                      │
  │    │   → 期望 200 + image                       │
  │    │   → 实际 200 + image ✓                     │
  │    └── GET /api/avatar/999 (不存在)              │
  │        → 期望 404                               │
  │        → 实际 404 ✓                             │
  │                                                  │
  │ 4. 清理                                          │
  │    ├── 停止服务                                  │
  │    └── 重置数据库                                │
  │                                                  │
  │ 结果: 5/5 通过 ✓                                 │
  └─────────────────────────────────────────────────┘
```

### 验证用例自动生成

关键问题：**谁来写这些验证用例？**

```
方案 A: Planning 阶段 LLM 生成
  任务描述 → LLM 生成验收标准 → 转为 verification cases
  优点：无需人工，覆盖度高
  缺点：LLM 可能遗漏边界情况

方案 B: 从代码推断
  检测到新增 POST /api/avatar route → 自动生成 happy/error/edge case
  优点：与实现精确对应
  缺点：只能生成技术层面的用例，不懂业务

方案 C: 混合（推荐）
  Planning 阶段生成业务级验收标准（A）
  Coding 完成后从代码推断技术级测试（B）
  两者合并为完整验证集
```

### Verification Case 格式

```yaml
# .reins/verification-cases/avatar-upload.yaml
# 由 Planning 阶段自动生成，可手动编辑

task: "添加头像上传 API"
generated_at: "2026-03-31"

acceptance_criteria:
  - id: "ac-1"
    description: "用户可以上传头像图片"
    type: "api"
    verify:
      method: POST
      path: "/api/avatar"
      headers:
        Authorization: "Bearer {{auth_token}}"
        Content-Type: "multipart/form-data"
      body:
        file: "@fixtures/test-avatar.jpg"
      expect:
        status: 200
        body:
          id: { type: "string" }
          url: { type: "string", pattern: "^https?://" }
    passes: false       # ← Ralph loop 检查此字段

  - id: "ac-2"
    description: "无效文件被拒绝"
    type: "api"
    verify:
      method: POST
      path: "/api/avatar"
      headers:
        Authorization: "Bearer {{auth_token}}"
      body:
        file: "@fixtures/test-document.pdf"
      expect:
        status: 400
        body:
          error: { type: "string" }
    passes: false

  - id: "ac-3"
    description: "上传后可以获取头像"
    type: "api"
    depends_on: "ac-1"    # 依赖 ac-1 的返回值
    verify:
      method: GET
      path: "/api/avatar/{{ac-1.response.body.id}}"
      expect:
        status: 200
        headers:
          Content-Type: { pattern: "^image/" }
    passes: false

  - id: "ac-4"
    description: "未认证用户被拒绝"
    type: "api"
    verify:
      method: POST
      path: "/api/avatar"
      # 注意：没有 Authorization header
      body:
        file: "@fixtures/test-avatar.jpg"
      expect:
        status: 401
    passes: false
```

### Ralph Loop 与 Verification Cases 的集成

```
Ralph Loop 迭代 N:
  1. 读取 verification-cases/*.yaml
  2. 找到 passes: false 的用例
  3. 启动服务 + 执行验证
  4. 通过 → 更新 passes: true
  5. 失败 → 分析失败原因 → 修复代码 → 回到 1
  6. 所有 passes: true → 退出 loop
```

```
退出条件:
  ALL(verification_cases.passes == true)
  AND L0_checks.all_passed
  AND L1_coverage.meets_threshold
  AND iteration_count < max_iterations
```

---

## L3: E2E Verify — 端到端验证

### 全栈项目的联调链条

```
┌────────────┐     ┌────────────┐     ┌────────────┐
│  Frontend   │────→│   Backend  │────→│  Database   │
│  (Next.js)  │  ↑  │  (API)     │     │ (PostgreSQL)│
└────────────┘  │  └────────────┘     └────────────┘
                │
           Playwright
           浏览器自动化
```

### E2E 验证流程

```yaml
# .reins/verification-cases/avatar-e2e.yaml

task: "头像上传完整流程"
type: "e2e"
tool: "playwright"

steps:
  - id: "e2e-1"
    action: "navigate"
    url: "/profile"
    expect:
      selector: "[data-testid='avatar-upload']"
      visible: true

  - id: "e2e-2"
    action: "upload"
    selector: "[data-testid='avatar-input']"
    file: "fixtures/test-avatar.jpg"
    expect:
      selector: "[data-testid='avatar-preview']"
      visible: true

  - id: "e2e-3"
    action: "click"
    selector: "[data-testid='avatar-submit']"
    expect:
      selector: "[data-testid='avatar-success']"
      visible: true
      timeout: 5000

  - id: "e2e-4"
    action: "navigate"
    url: "/profile"
    expect:
      selector: "[data-testid='avatar-image']"
      attribute:
        src: { pattern: "^https?://.*avatar" }

  - id: "e2e-5"
    action: "screenshot"
    name: "avatar-uploaded"
    compare_with: "fixtures/screenshots/avatar-uploaded.png"  # 可选视觉回归
```

### E2E 执行引擎

```typescript
// verification/e2e-runner.ts

async function runE2EVerification(
  config: VerificationConfig,
  cases: E2ECase[]
): Promise<VerificationResult> {

  // 1. 启动完整环境
  const env = await startFullEnvironment(config);
  // → docker compose up (DB + Redis)
  // → pnpm dev (启动 Next.js，含前后端)
  // → 等待 health check

  // 2. 启动 Playwright
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // 3. 获取认证（如果需要）
  if (config.strategies.e2e_flow.auth) {
    await login(page, config.strategies.e2e_flow.auth);
  }

  // 4. 执行步骤
  const results: StepResult[] = [];
  for (const step of cases) {
    try {
      const result = await executeStep(page, step);
      results.push({ ...step, passed: true, result });
    } catch (error) {
      results.push({ ...step, passed: false, error: error.message });
      // 截图保存失败现场
      await page.screenshot({
        path: `.reins/logs/e2e-failure-${step.id}.png`
      });
    }
  }

  // 5. 清理
  await browser.close();
  await stopFullEnvironment(env);

  return {
    total: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results,
    screenshots: results.filter(r => r.screenshot),
  };
}
```

---

## L4: Semantic Review — 语义验证

### 需求 vs 实现对比

```typescript
// verification/semantic-reviewer.ts

async function semanticReview(
  taskDescription: string,
  changedFiles: FileChange[],
  verificationResults: VerificationResult
): Promise<SemanticReviewResult> {

  const prompt = `
    ## 任务需求
    ${taskDescription}

    ## 代码变更
    ${changedFiles.map(f => `### ${f.path}\n\`\`\`\n${f.diff}\n\`\`\``).join('\n')}

    ## 验证结果
    ${JSON.stringify(verificationResults, null, 2)}

    ## 请评估
    1. 实现是否完整覆盖了需求？遗漏了什么？
    2. 是否有多余的实现（超出需求范围）？
    3. 边界情况是否处理？
    4. 安全性问题？
    5. 综合评分（0-100）和信心度
  `;

  // 使用 code-reviewer agent
  return await reviewAgent.evaluate(prompt);
}
```

### 截图审查（前端/全栈项目）

```typescript
// verification/visual-reviewer.ts

async function visualReview(
  screenshots: Screenshot[],
  taskDescription: string
): Promise<VisualReviewResult> {

  // 多模态 LLM 审查截图
  const prompt = `
    任务：${taskDescription}

    以下是实现后的截图。请评估：
    1. UI 是否合理？布局、间距、对齐
    2. 是否有明显的视觉问题？
    3. 交互元素是否清晰可识别？
    4. 是否适配当前视口大小？
  `;

  return await visionAgent.evaluate(prompt, screenshots);
}
```

---

## 前后端契约验证

### 三种策略

#### 策略 1：类型共享（TypeScript monorepo）

```
最强保证，编译时即可发现不匹配

packages/shared/
└── types/
    └── api.ts        # 前后端共享的 API 类型

// 前端调用
const res = await fetch<AvatarResponse>('/api/avatar');

// 后端返回
return NextResponse.json<AvatarResponse>({ id, url });
```

Reins 检测逻辑：
```typescript
function detectTypeSharing(projectRoot: string): boolean {
  // 检测 monorepo 中是否有 shared types
  // 检测 tsconfig paths 是否有 @shared 之类的 alias
  // 检测 API route 的返回类型是否和前端调用类型一致
}
```

#### 策略 2：OpenAPI Spec 对比

```
中等保证，需要项目维护 swagger/openapi spec

后端: 从代码/注解生成 openapi.json
前端: 从 API 调用提取实际使用的 endpoint + 参数

对比: spec 定义 vs 实际使用 → 发现不匹配
```

#### 策略 3：运行时录制对比（最通用）

```
最通用，但需要启动完整环境

1. 启动后端，代理前端请求
2. 记录前端发出的所有 API 调用
3. 对比实际请求 vs 后端 route 定义
4. 发现不匹配：
   - 前端调用了不存在的 endpoint
   - 前端发送的字段和后端期望的不一致
   - 前端期望的返回格式和后端不一致
```

### Init 阶段的契约检测

```yaml
# .reins/verification.yaml

contract:
  strategy: "type_sharing"     # type_sharing | openapi | runtime_record | none
  # 由 init 自动检测，用户可覆盖

  type_sharing:
    shared_types_path: "packages/shared/types/"
    api_types_file: "api.ts"

  # 或
  openapi:
    spec_path: "docs/openapi.yaml"
    generate_command: "pnpm generate:openapi"

  # 或
  runtime_record:
    proxy_port: 3001
    record_dir: ".reins/contract-records/"
```

---

## 验证配方的自动检测

### Init 阶段新增：环境检测

```
/reins init

Reins：扫描项目中...

  ✓ 技术栈：TypeScript + Next.js 14
  ✓ 约束：11 条

  ✓ 验证环境检测：
    • 启动命令: pnpm dev (port 3000)
    • 健康检查: /api/health ✓
    • 数据库: PostgreSQL (via Prisma)
    • 外部依赖: Redis (docker-compose.yml)
    • E2E 工具: Playwright ✓ (已安装)
    • 契约策略: type_sharing (packages/shared/)
    • 测试数据: prisma db seed ✓

  已生成验证配方: .reins/verification.yaml

  验证层级可用性：
  ┌─────────────────────────────────────────────┐
  │ L0  Static Check      ✅ 可用               │
  │ L1  Coverage Gate      ✅ 可用 (Jest + c8)   │
  │ L2  Integration Verify ✅ 可用 (curl + seed) │
  │ L3  E2E Verify         ✅ 可用 (Playwright)  │
  │ L4  Semantic Review    ✅ 可用 (LLM)         │
  └─────────────────────────────────────────────┘

  所有层级就绪 ✓
```

对于验证环境不完整的项目：

```
  验证层级可用性：
  ┌──────────────────────────────────────────────────────┐
  │ L0  Static Check      ✅ 可用                        │
  │ L1  Coverage Gate      ✅ 可用                        │
  │ L2  Integration Verify ⚠ 部分 (无 health endpoint)   │
  │ L3  E2E Verify         ❌ 不可用 (未安装 Playwright)  │
  │ L4  Semantic Review    ✅ 可用                        │
  └──────────────────────────────────────────────────────┘

  建议：
  • 添加 /api/health endpoint 以启用 L2 自动验证
  • 运行 pnpm add -D @playwright/test 以启用 L3 E2E 验证
```

---

## Ralph Loop 退出条件

### 当前问题

Ralph loop 的退出条件不明确："测试通过"太弱，"所有验证通过"可能太严。

### 新设计：基于 Profile 的退出条件

```yaml
# .reins/config.yaml

evaluation:
  profiles:
    relaxed:
      exit_when: "L0_passed"
      max_iterations: 20
    default:
      exit_when: "L0_passed AND L1_passed"
      max_iterations: 50
    strict:
      exit_when: "L0_passed AND L1_passed AND L2_passed AND L4_confidence >= 80"
      max_iterations: 100
    fullstack:
      exit_when: "L0_passed AND L1_passed AND L2_passed AND L3_passed AND L4_confidence >= 80"
      max_iterations: 100
```

### 退出条件的形式化定义

```typescript
interface ExitCondition {
  L0_passed: boolean;              // lint + typecheck + test
  L1_passed: boolean;              // coverage gate
  L2_passed: boolean;              // integration verify
  L3_passed: boolean;              // e2e verify
  L4_confidence: number;           // 0-100 semantic review score
  acceptance_criteria_met: boolean; // 所有 verification cases passes: true
  iteration_count: number;
  max_iterations: number;
}

function shouldExitRalph(
  condition: ExitCondition,
  profile: EvaluationProfile
): { exit: boolean; reason: string } {

  // 超过最大迭代 → 强制退出（失败）
  if (condition.iteration_count >= condition.max_iterations) {
    return { exit: true, reason: "max iterations reached" };
  }

  // 按 profile 评估
  switch (profile) {
    case 'relaxed':
      return {
        exit: condition.L0_passed,
        reason: condition.L0_passed ? "L0 passed" : "L0 not yet passed"
      };

    case 'default':
      return {
        exit: condition.L0_passed && condition.L1_passed,
        reason: !condition.L0_passed ? "L0 failing"
              : !condition.L1_passed ? "L1 failing"
              : "L0+L1 passed"
      };

    case 'strict':
      const strictPassed = condition.L0_passed
        && condition.L1_passed
        && condition.L2_passed
        && condition.L4_confidence >= 80;
      return {
        exit: strictPassed,
        reason: !condition.L0_passed ? "L0 failing"
              : !condition.L1_passed ? "L1 failing"
              : !condition.L2_passed ? "L2 failing"
              : condition.L4_confidence < 80 ? `L4 confidence ${condition.L4_confidence}% < 80%`
              : "all checks passed"
      };

    case 'fullstack':
      const fullPassed = condition.L0_passed
        && condition.L1_passed
        && condition.L2_passed
        && condition.L3_passed
        && condition.L4_confidence >= 80;
      return {
        exit: fullPassed,
        reason: !condition.L0_passed ? "L0 failing"
              : !condition.L1_passed ? "L1 failing"
              : !condition.L2_passed ? "L2 failing"
              : !condition.L3_passed ? "L3 failing"
              : condition.L4_confidence < 80 ? `L4 confidence ${condition.L4_confidence}% < 80%`
              : "full verification passed"
      };
  }
}
```

---

## 验证类型自动匹配

Init 阶段根据检测到的项目类型，自动推荐验证层级：

| 项目类型 | 自动检测信号 | 推荐层级 | 默认 Profile |
|----------|------------|---------|-------------|
| 纯库/工具 | 无 server, 无 UI | L0 + L1 | default |
| 后端 API | 有 route/handler, 无前端 | L0 + L1 + L2 | default |
| 纯前端 | 有 component, 无 API | L0 + L1 + L3 | default |
| 全栈 | 有 route + component | L0 + L1 + L2 + L3 | fullstack |
| 所有重要任务 | - | + L4 | strict |

```typescript
function detectProjectType(context: CodebaseContext): ProjectType {
  const hasRoutes = context.structure.dirs.some(d =>
    d.match(/api|routes|handlers|controllers/)
  );
  const hasComponents = context.structure.dirs.some(d =>
    d.match(/components|pages|views|screens/)
  );
  const hasServer = context.stack.framework.some(f =>
    ['express', 'fastapi', 'gin', 'actix'].includes(f)
  );

  if (hasRoutes && hasComponents) return 'fullstack';
  if (hasRoutes || hasServer) return 'backend';
  if (hasComponents) return 'frontend';
  return 'library';
}
```

---

## 文件结构（评估相关）

```
.reins/
├── verification.yaml              # 验证配方（环境、策略、依赖）
├── verification-cases/            # 验证用例
│   ├── avatar-upload-api.yaml     # L2 API 验证用例
│   ├── avatar-upload-e2e.yaml     # L3 E2E 验证用例
│   └── ...
├── fixtures/                      # 测试固件
│   ├── test-avatar.jpg
│   ├── test-document.pdf
│   └── screenshots/               # 视觉基线截图
│       └── avatar-uploaded.png
└── logs/
    ├── verification/              # 验证执行日志
    │   ├── 2026-03-31-L2.yaml
    │   └── 2026-03-31-L3.yaml
    └── e2e-failure-*.png          # E2E 失败截图
```

---

## 与其他模块的集成

```
/reins init
  → 检测环境 + 生成 verification.yaml
  → 确定可用的验证层级

/reins develop "任务"
  → Planning 阶段生成 verification-cases/*.yaml
  → Coding 阶段正常开发
  → Ralph loop 使用 verification cases 做退出判断
  → 每轮迭代: L0 → L1 → L2 → L3 → L4 (按 profile)

/reins status
  → 显示各层级的历史通过率
  → 显示验证环境健康状况
  → 建议缺失的验证能力

/reins test
  → 验证 verification.yaml 配方可执行
  → 测试各层级是否正常工作
  → 不实际开发，只测试验证链路本身

config.yaml:
  evaluation:
    profiles: { relaxed, default, strict, fullstack }
    auto_detect_type: true
    l2_timeout: 300        # 秒
    l3_timeout: 600
    l4_model: "sonnet"     # 语义审查用的模型
```
