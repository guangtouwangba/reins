# Reins Hook 系统设计

## 核心问题

CLAUDE.md 中的约束是**建议性的** — LLM 可能忽略。
Hook 是**强制性的** — 确定性执行，exit 2 直接阻止操作。

```
约束执行的两层防御：

Layer A: CLAUDE.md / AGENTS.md (软约束)
  → LLM 在生成时"尽量遵守"
  → 优点：灵活，能理解语义
  → 缺点：可能被忽略、遗忘、误解

Layer B: Hooks (硬约束)
  → 代码级确定性检查
  → 优点：100% 执行，不可绕过
  → 缺点：只能检查规则性的东西
```

**Reins 的策略**：Critical 约束同时有软约束（L0 CLAUDE.md）+ 硬约束（Hook）。双保险。

---

## Hook 与约束的关系

### 约束的三个执行层级

```yaml
# .reins/constraints.yaml

constraints:
  - id: "no-direct-sql"
    rule: "数据库操作必须通过 Prisma，不直接写 SQL"
    severity: critical
    enforcement:
      soft: true              # → 写入 CLAUDE.md L0
      hook: true              # → 生成 PostToolUse hook
      hook_type: "post_edit"  # 编辑文件后检查
      hook_check: "grep -r 'SELECT\\|INSERT\\|UPDATE\\|DELETE' --include='*.ts' {file} && exit 2 || exit 0"

  - id: "typed-returns"
    rule: "Service 函数必须有返回类型注解"
    severity: important
    enforcement:
      soft: true              # → 写入 L1 AGENTS.md
      hook: false             # 不适合用 hook（需要语义理解）

  - id: "test-coverage"
    rule: "新文件必须有对应测试"
    severity: important
    enforcement:
      soft: true
      hook: true
      hook_type: "pre_commit"
      hook_check: "检查新建的 .ts 文件是否有 .test.ts"

  - id: "no-env-direct"
    rule: "不直接使用 process.env，通过 lib/env.ts"
    severity: critical
    enforcement:
      soft: true
      hook: true
      hook_type: "post_edit"
      hook_check: "grep 'process\\.env' {file} | grep -v 'lib/env.ts' && exit 2 || exit 0"
```

### 哪些约束适合用 Hook

| 适合 Hook（规则性） | 不适合 Hook（语义性） |
|--------------------|--------------------|
| 禁止某种 import/调用 | "代码应该可读" |
| 文件命名规范 | "架构应该分层" |
| 必须有测试文件 | "错误处理要优雅" |
| 格式化/lint | "命名要有意义" |
| 禁止直接使用某个 API | "性能要好" |
| commit message 格式 | "代码不要太复杂" |

**原则**：能用正则/AST/命令检查的 → Hook。需要理解语义的 → 软约束 + Review。

---

## Hook 类型设计

### 1. PostToolUse:Edit/Write — 文件修改后检查

最常用的 hook。每次 Claude 编辑或创建文件后触发。

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": ".reins/hooks/post-edit-check.sh"
          }
        ]
      }
    ]
  }
}
```

```bash
#!/bin/bash
# .reins/hooks/post-edit-check.sh
# 从 stdin 读取 tool_input，提取被修改的文件路径

FILE=$(jq -r '.tool_input.file_path // .tool_input.filePath // empty')
[ -z "$FILE" ] && exit 0  # 无法提取文件路径，放行

# 检查 1: 禁止直接 SQL
if echo "$FILE" | grep -qE '\.(ts|tsx|js|jsx)$'; then
  if grep -qE 'SELECT |INSERT |UPDATE |DELETE |DROP ' "$FILE" 2>/dev/null; then
    echo "⛔ Reins 约束违反: 禁止直接写 SQL。请使用 Prisma ORM。" >&2
    echo "   违反约束: no-direct-sql" >&2
    echo "   文件: $FILE" >&2
    exit 2
  fi
fi

# 检查 2: 禁止直接 process.env
if echo "$FILE" | grep -qE '\.(ts|tsx|js|jsx)$'; then
  if echo "$FILE" | grep -qv 'lib/env'; then
    if grep -qE 'process\.env\.' "$FILE" 2>/dev/null; then
      echo "⛔ Reins 约束违反: 不要直接使用 process.env，请使用 lib/env.ts。" >&2
      echo "   违反约束: no-env-direct" >&2
      echo "   文件: $FILE" >&2
      exit 2
    fi
  fi
fi

# 所有检查通过
exit 0
```

### 2. Stop — 任务完成前验证

Claude 认为任务完成时触发。可以强制要求测试通过。

```json
{
  "Stop": [
    {
      "hooks": [
        {
          "type": "command",
          "command": ".reins/hooks/pre-complete-check.sh"
        }
      ]
    }
  ]
}
```

```bash
#!/bin/bash
# .reins/hooks/pre-complete-check.sh

# 检查是否有新文件缺少测试
NEW_FILES=$(git diff --cached --name-only --diff-filter=A | grep -E '\.(ts|tsx)$' | grep -v '\.test\.' | grep -v '\.spec\.')
for f in $NEW_FILES; do
  TEST_FILE="${f%.ts}.test.ts"
  TEST_FILE2="${f%.tsx}.test.tsx"
  if [ ! -f "$TEST_FILE" ] && [ ! -f "$TEST_FILE2" ]; then
    echo "⛔ Reins: 新文件 $f 缺少对应的测试文件。" >&2
    echo "   请创建 $TEST_FILE" >&2
    exit 2  # 阻止 Claude 认为任务完成
  fi
done

# 运行测试
if ! pnpm test --passWithNoTests 2>&1; then
  echo "⛔ Reins: 测试未通过，请修复后再完成任务。" >&2
  exit 2
fi

echo "✅ Reins: 所有检查通过。"
exit 0
```

### 3. PreToolUse:Bash — 危险命令拦截

阻止 agent 执行破坏性操作。

```json
{
  "PreToolUse": [
    {
      "matcher": "Bash",
      "hooks": [
        {
          "type": "command",
          "command": ".reins/hooks/bash-guard.sh"
        }
      ]
    }
  ]
}
```

```bash
#!/bin/bash
# .reins/hooks/bash-guard.sh

CMD=$(jq -r '.tool_input.command // empty')
[ -z "$CMD" ] && exit 0

# 禁止直接操作生产数据库
if echo "$CMD" | grep -qiE 'psql.*prod|mysql.*prod|mongo.*prod'; then
  echo "⛔ Reins: 禁止直接操作生产数据库。" >&2
  exit 2
fi

# 禁止 force push
if echo "$CMD" | grep -qE 'git push.*--force|git push.*-f'; then
  echo "⛔ Reins: 禁止 force push。请使用 --force-with-lease。" >&2
  exit 2
fi

# 禁止删除关键文件
if echo "$CMD" | grep -qE 'rm.*-rf.*(src|lib|app|components)/'; then
  echo "⛔ Reins: 禁止批量删除源码目录。" >&2
  exit 2
fi

exit 0
```

### 4. UserPromptSubmit — 约束注入

每次用户提交 prompt 时，自动注入相关约束上下文。

```json
{
  "UserPromptSubmit": [
    {
      "hooks": [
        {
          "type": "command",
          "command": ".reins/hooks/context-inject.sh"
        }
      ]
    }
  ]
}
```

```bash
#!/bin/bash
# .reins/hooks/context-inject.sh
# 根据用户 prompt 内容，注入相关的 L2 约束

PROMPT=$(jq -r '.user_prompt // empty')
[ -z "$PROMPT" ] && exit 0

CONTEXT=""

# 如果提到 API 相关
if echo "$PROMPT" | grep -qiE 'api|route|endpoint'; then
  CONTEXT+="[Reins] API 开发约束已加载，详见 .reins/patterns/api-patterns.md\n"
fi

# 如果提到测试相关
if echo "$PROMPT" | grep -qiE 'test|测试|spec'; then
  CONTEXT+="[Reins] 测试约束已加载，详见 .reins/patterns/testing-patterns.md\n"
fi

# 如果提到数据库相关
if echo "$PROMPT" | grep -qiE 'database|db|prisma|migration|数据库'; then
  CONTEXT+="[Reins] 数据库约束: 必须通过 Prisma ORM，不直接写 SQL。详见 .reins/patterns/db-patterns.md\n"
fi

if [ -n "$CONTEXT" ]; then
  echo -e "$CONTEXT"
fi

exit 0
```

---

## 自动 Hook 生成

### `/reins init` 的 Hook 生成流程

```
constraints.yaml 中的每条约束
    ↓
检查 enforcement.hook == true?
    ↓ Yes
根据 hook_type 生成对应的 shell 脚本
    ↓
写入 .reins/hooks/
    ↓
注册到 .claude/settings.json（项目级）
```

### 用户配置界面

```
你：/reins init

Reins：...（扫描完成）

  检测到 11 条约束，其中 4 条可以用 Hook 强制执行：

  Hook 配置预览：
  ┌─────────────────────────────────────────────────────┐
  │ #  约束                    Hook 类型    默认   │
  │ 1  禁止直接 SQL             PostEdit     ✓ 开   │
  │ 2  禁止直接 process.env     PostEdit     ✓ 开   │
  │ 3  新文件需要测试           Stop         ✓ 开   │
  │ 4  禁止 force push          PreBash      ✓ 开   │
  └─────────────────────────────────────────────────────┘

  全部启用？[y/n/edit]

你：edit

Reins：输入要调整的编号（多个用逗号分隔）：

你：3

Reins：约束 #3 "新文件需要测试"
  当前：Stop hook — 任务完成前检查
  选项：
  a) 保持开启（推荐）
  b) 关闭此 hook（仅靠 CLAUDE.md 软约束）
  c) 改为警告模式（不阻止，只提示）

你：c

Reins：
  ✓ Hook #3 已设置为警告模式（不阻止，仅 stdout 提示）
  ✓ 已生成 4 个 hook 脚本到 .reins/hooks/
  ✓ 已注册到 .claude/settings.json
```

---

## 用户自定义 Hook

### 方式 1：编辑 constraints.yaml

用户可以直接编辑约束文件来控制 hook：

```yaml
# .reins/constraints.yaml
constraints:
  - id: "no-direct-sql"
    rule: "数据库操作必须通过 Prisma"
    severity: critical
    enforcement:
      soft: true
      hook: true           # ← 用户可以改为 false
      hook_mode: "block"   # block | warn | off
```

然后运行 `/reins update` 重新生成 hook 脚本。

### 方式 2：`/reins hook` 命令

```
你：/reins hook add "禁止导入 lodash，使用原生方法"

Reins：分析约束...
  检测类型：import 禁止
  建议 hook：PostToolUse:Edit — 检查 import/require('lodash')

  生成的检查脚本：
  ```bash
  grep -E "from 'lodash'|require\('lodash'\)" "$FILE" && exit 2 || exit 0
  ```

  添加到 constraints.yaml 并启用？[y/n/edit]

你：y

Reins：
  ✓ 约束 "no-lodash" 已添加
  ✓ Hook 已生成: .reins/hooks/check-no-lodash.sh
  ✓ .claude/settings.json 已更新
```

```
你：/reins hook list

Reins Hook 列表：
  #  约束ID            事件          模式     状态
  1  no-direct-sql     PostEdit      block    ✅ 活跃
  2  no-env-direct     PostEdit      block    ✅ 活跃
  3  test-coverage     Stop          warn     ⚠ 警告模式
  4  no-force-push     PreBash       block    ✅ 活跃
  5  no-lodash         PostEdit      block    ✅ 活跃
```

```
你：/reins hook disable no-lodash

Reins：
  ✓ Hook "no-lodash" 已禁用
  ⚠ 软约束仍然有效（在 AGENTS.md 中）
```

### 方式 3：直接编辑 Hook 脚本

高级用户可以直接修改 `.reins/hooks/*.sh`：

```
.reins/hooks/
├── post-edit-check.sh      # 文件编辑后的综合检查
├── pre-complete-check.sh   # 任务完成前的综合检查
├── bash-guard.sh           # 危险命令拦截
├── context-inject.sh       # 上下文注入
└── custom/                 # 用户自定义 hook
    └── check-no-lodash.sh
```

---

## Hook 执行模式

```
block (默认 critical)：
  exit 2 → 阻止操作 + stderr 反馈给 Claude
  Claude 看到反馈后会自动修正

warn (默认 important)：
  exit 0 + stdout 提示
  Claude 看到提示但不被阻止
  提示写入 .reins/logs/ 供 /reins status 统计

off：
  hook 不执行
  仅靠软约束（CLAUDE.md/AGENTS.md）
```

---

## settings.json 生成

`/reins init` 自动生成项目级 `.claude/settings.json`：

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": ".reins/hooks/post-edit-check.sh"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": ".reins/hooks/bash-guard.sh"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ".reins/hooks/pre-complete-check.sh"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ".reins/hooks/context-inject.sh"
          }
        ]
      }
    ]
  }
}
```

---

## Hook 与渐进式上下文的配合

```
L0 (CLAUDE.md)  ←→  PostEdit Hook (block)
  "禁止直接 SQL"       grep SQL 关键词 → exit 2

L1 (AGENTS.md)  ←→  PostEdit Hook (warn) 或无 hook
  "service 返回 Result"  需要语义理解，不适合 hook

L2 (patterns/)  ←→  UserPromptSubmit Hook (context inject)
  "API 模式参考"        检测到 API 相关 prompt → 注入提示

Stop Hook = 最后防线
  "测试必须通过"        任务完成前强制运行测试
```

```
约束执行的完整链条：

用户提交 prompt
  → UserPromptSubmit hook: 注入相关 L2 上下文
  → Claude 生成代码（遵守 L0/L1 软约束）
  → PostToolUse hook: 检查硬约束
    → 违反 → exit 2 → Claude 收到反馈 → 自动修正 → 再次检查
    → 通过 → 继续
  → Claude 认为完成
  → Stop hook: 运行测试 + 最终检查
    → 失败 → exit 2 → Claude 继续修复
    → 通过 → 真正完成
```

---

## 设计原则

1. **Hook 不替代软约束，两者互补** — 软约束覆盖面广（语义理解），Hook 覆盖关键点（确定性）
2. **默认保守** — Critical 约束默认 block，Important 默认 warn，Helpful 默认 off
3. **用户可覆盖一切** — 每个 hook 都可以 disable/warn/block 调整
4. **Hook 脚本可审查** — 所有生成的脚本是普通 shell 脚本，用户可以读和改
5. **反馈闭环** — Hook 的 stderr 会被 Claude 读取并自动修正，不需要人工干预
6. **日志可追溯** — 每次 hook 触发（无论通过还是阻止）都记录到 .reins/logs/
