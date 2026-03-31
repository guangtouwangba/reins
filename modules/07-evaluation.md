# 模块 ⑦：Evaluation System（评估系统）

## 职责

分层验证"代码能不能上线"，解决"测试通过 ≠ 功能正确 ≠ 需求满足"的问题。为 Ralph loop 提供明确的退出条件。

**输入**：代码变更 + verification.yaml（验证配方）+ verification-cases/*.yaml（验证用例）
**输出**：分层验证结果 + 退出/继续决策

---

## 5 层评估模型

```
L0: Static Check    (< 30s, 确定性, 每次都跑)
  → "代码没有语法/类型/风格错误"
         ↓ 通过
L1: Coverage Gate    (< 2min, 确定性)
  → "变更被测试覆盖了"
         ↓ 通过
L2: Integration Verify  (< 5min, 项目特异)
  → "API/服务实际能工作"
         ↓ 通过
L3: E2E Verify       (< 10min, 需要浏览器)
  → "用户能完成完整操作"
         ↓ 通过
L4: Semantic Review   (LLM 驱动)
  → "功能符合最初意图"
```

### 各层级适用场景

| 层级 | 耗时 | 适用 | Profile 映射 |
|------|------|------|-------------|
| L0 | < 30s | 所有变更 | relaxed / default / strict |
| L1 | < 2min | 所有非文档变更 | default / strict |
| L2 | < 5min | 后端 API / 服务变更 | strict |
| L3 | < 10min | 全栈 / UI 变更 | strict (fullstack) |
| L4 | < 1min | 重要功能 / 模糊需求 | strict |

---

## L0: Static Check

确定性基线，复用项目已有工具。

```bash
# 自动检测并运行
pnpm lint && pnpm typecheck && pnpm test
```

---

## L1: Coverage Gate

```typescript
interface CoverageGate {
  checks: [
    { type: "new_file_has_test" },     // 新 .ts 文件有对应 .test.ts
    { type: "no_empty_tests" },         // 不允许 test.skip / test.todo / 空 expect
    { type: "branch_coverage", min: 70 }, // 新代码分支覆盖率 >= 70%
    { type: "error_path_tested" },      // catch/error handler 有对应测试
    { type: "mock_audit" },             // mock 了外部依赖但没 mock 被测模块自身
  ]
}
```

```bash
#!/bin/bash
# .reins/hooks/coverage-gate.sh

# 检查 1: 新文件有测试
NEW_SRC=$(git diff --cached --name-only --diff-filter=A | grep -E '\.(ts|tsx)$' | grep -vE '\.test\.|\.spec\.|__tests__')
for f in $NEW_SRC; do
  BASE="${f%.ts}"; BASE="${BASE%.tsx}"
  if ! ls "${BASE}.test.ts" "${BASE}.test.tsx" "${BASE}.spec.ts" 2>/dev/null | head -1 > /dev/null; then
    echo "⛔ L1: 新文件 $f 缺少测试" >&2; exit 2
  fi
done

# 检查 2: 空壳测试
EMPTY=$(grep -rn 'test\.skip\|test\.todo\|it\.skip\|expect()$' --include='*.test.*' .)
if [ -n "$EMPTY" ]; then
  echo "⛔ L1: 发现空壳测试:" >&2; echo "$EMPTY" >&2; exit 2
fi

echo "✅ L1 通过"; exit 0
```

---

## L2: Integration Verify

### Verification Recipe（验证配方）

`/reins init` 阶段自动检测项目运行方式，生成可执行的验证配方。

```yaml
# .reins/verification.yaml
version: 1

environment:
  start:
    command: "pnpm dev"
    port: 3000
    health_check: "http://localhost:3000/api/health"
    startup_timeout: 15s
    env_file: ".env.test"

  dependencies:
    - name: "PostgreSQL"
      check: "pg_isready -h localhost -p 5432"
      setup: "docker compose up -d postgres"
      teardown: "docker compose down postgres"

  database:
    type: "postgresql"
    setup: "pnpm prisma migrate reset --force"
    seed: "pnpm prisma db seed"

strategies:
  backend_api:
    enabled: true
    tool: "curl"
    base_url: "http://localhost:3000"
    auth:
      type: "bearer"
      obtain: "curl -s -X POST /api/auth/login -d '...' | jq -r '.token'"

  frontend_ui:
    enabled: true
    tool: "playwright"
    base_url: "http://localhost:3000"
    screenshots: true

contract:
  strategy: "type_sharing"    # type_sharing | openapi | runtime_record | none
```

### Verification Cases（验证用例）

Planning 阶段自动生成，也可手动编辑。

```yaml
# .reins/verification-cases/avatar-upload.yaml
task: "添加头像上传 API"

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
      body:
        file: "@fixtures/test-document.pdf"
      expect:
        status: 400
    passes: false

  - id: "ac-3"
    description: "未认证用户被拒绝"
    type: "api"
    verify:
      method: POST
      path: "/api/avatar"
      # 无 Authorization header
      expect:
        status: 401
    passes: false
```

### L2 执行流程

```
1. 准备环境
   ├── 检查外部依赖 (PostgreSQL ✓, Redis ✓)
   ├── 重置测试数据库 (prisma migrate reset)
   └── 准备测试数据 (prisma db seed)

2. 启动服务
   ├── pnpm dev (background)
   ├── 等待 health check (max 15s)
   └── 服务就绪 ✓

3. 执行验证用例
   ├── ac-1: POST /api/avatar → 200 ✓
   ├── ac-2: POST /api/avatar (invalid) → 400 ✓
   └── ac-3: POST /api/avatar (no auth) → 401 ✓

4. 清理
   ├── 停止服务
   └── 重置数据库
```

---

## L3: E2E Verify

全栈项目的端到端验证，使用 Playwright。

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
    action: "screenshot"
    name: "avatar-uploaded"
```

---

## L4: Semantic Review

LLM 驱动的语义验证。

```typescript
// evaluation/semantic-reviewer.ts

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
    2. 是否有多余的实现？
    3. 边界情况是否处理？
    4. 安全性问题？
    5. 综合评分（0-100）和信心度
  `;

  return await reviewAgent.evaluate(prompt);
}
```

### 截图审查（前端项目）

```typescript
async function visualReview(
  screenshots: Screenshot[],
  taskDescription: string
): Promise<VisualReviewResult> {
  // 多模态 LLM 审查截图
  return await visionAgent.evaluate(prompt, screenshots);
}
```

---

## 前后端契约验证

3 种策略，init 阶段自动检测：

| 策略 | 保证级别 | 适用条件 |
|------|---------|---------|
| **类型共享** | 编译时发现 | TypeScript monorepo, 有 shared types |
| **OpenAPI 对比** | Spec vs 实现 | 项目维护 swagger/openapi spec |
| **运行时录制** | 最通用 | 需要启动完整环境 |

---

## Ralph Loop 退出条件

### 基于 Profile 的退出条件

```yaml
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

### 形式化定义

```typescript
interface ExitCondition {
  L0_passed: boolean;
  L1_passed: boolean;
  L2_passed: boolean;
  L3_passed: boolean;
  L4_confidence: number;           // 0-100
  acceptance_criteria_met: boolean;
  iteration_count: number;
  max_iterations: number;
}

function shouldExit(condition: ExitCondition, profile: string): { exit: boolean; reason: string } {
  if (condition.iteration_count >= condition.max_iterations) {
    return { exit: true, reason: "max iterations reached" };
  }

  switch (profile) {
    case 'relaxed':
      return { exit: condition.L0_passed, reason: ... };
    case 'default':
      return { exit: condition.L0_passed && condition.L1_passed, reason: ... };
    case 'strict':
      return {
        exit: condition.L0_passed && condition.L1_passed
           && condition.L2_passed && condition.L4_confidence >= 80,
        reason: ...
      };
    case 'fullstack':
      return {
        exit: condition.L0_passed && condition.L1_passed
           && condition.L2_passed && condition.L3_passed
           && condition.L4_confidence >= 80,
        reason: ...
      };
  }
}
```

---

## 验证类型自动匹配

Init 阶段根据项目类型自动推荐验证层级：

| 项目类型 | 检测信号 | 推荐层级 |
|----------|---------|---------|
| 纯库/工具 | 无 server, 无 UI | L0 + L1 |
| 后端 API | 有 route/handler | L0 + L1 + L2 |
| 纯前端 | 有 component, 无 API | L0 + L1 + L3 |
| 全栈 | 有 route + component | L0 + L1 + L2 + L3 |
| + 重要任务 | — | + L4 |

---

## 子模块 & 源码结构

```
src/evaluation/
├── evaluator.ts              # 统一评估入口
├── l0-static.ts              # L0 静态检查
├── l1-coverage.ts            # L1 覆盖度门禁
├── l2-integration.ts         # L2 集成验证
├── l3-e2e.ts                 # L3 端到端验证
├── l4-semantic.ts            # L4 语义审查
├── verification-runner.ts    # 验证用例执行器
├── environment-manager.ts    # 服务启停 + 依赖管理
├── contract-verifier.ts      # 前后端契约验证
└── exit-condition.ts         # Ralph loop 退出条件判断
```

---

## 文件结构

```
.reins/
├── verification.yaml              # 验证配方
├── verification-cases/            # 验证用例
│   ├── avatar-upload-api.yaml
│   ├── avatar-upload-e2e.yaml
│   └── ...
├── fixtures/                      # 测试固件
│   ├── test-avatar.jpg
│   └── screenshots/               # 视觉基线
└── logs/
    ├── verification/              # 验证日志
    └── e2e-failure-*.png          # E2E 失败截图
```

---

## 依赖关系

- **被依赖**：⑥ Pipeline Runner（退出条件）、⑧ Self-Improving（验证结果日志）
- **依赖**：② Scanner（environment-detector）、⑤ Hook System（L0/L1 检查脚本）
- **外部依赖**：Playwright（L3）、curl/httpie（L2）、项目测试框架（L0/L1）

---

## 实施优先级

- **Phase 2**：L0（复用项目工具链）
- **Phase 3**：L1 coverage gate
- **Phase 4**：L2 integration verify + L4 semantic review + verification.yaml 自动生成
- **Phase 5**：L3 E2E + contract verification
