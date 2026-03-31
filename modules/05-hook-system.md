# 模块 ⑤：Hook System

## 职责

将软约束（CLAUDE.md）升级为硬约束（确定性执行），实现双层防御。从 constraints.yaml 中自动生成 hook 脚本和 settings.json 配置。

**输入**：`constraints.yaml` 中 `enforcement.hook == true` 的约束
**输出**：`.reins/hooks/*.sh` + `.claude/settings.json`

---

## 核心设计：双层防御

```
Layer A: CLAUDE.md / AGENTS.md (软约束)
  → LLM 在生成时"尽量遵守"
  → 优点：灵活，能理解语义
  → 缺点：可能被忽略、遗忘、误解

Layer B: Hooks (硬约束)
  → 代码级确定性检查
  → 优点：100% 执行，不可绕过
  → 缺点：只能检查规则性的东西
```

**策略**：Critical 约束同时有软约束（L0 CLAUDE.md）+ 硬约束（Hook）。双保险。

---

## 哪些约束适合用 Hook

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

## 4 种 Hook 类型

### 1. PostToolUse:Edit/Write — 文件修改后检查

最常用。每次 Claude 编辑或创建文件后触发。

```bash
#!/bin/bash
# .reins/hooks/post-edit-check.sh

FILE=$(jq -r '.tool_input.file_path // .tool_input.filePath // empty')
[ -z "$FILE" ] && exit 0

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
      echo "⛔ Reins 约束违反: 不要直接使用 process.env。" >&2
      echo "   违反约束: no-env-direct" >&2
      exit 2
    fi
  fi
fi

exit 0
```

### 2. PreToolUse:Bash — 危险命令拦截

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

# 禁止删除关键目录
if echo "$CMD" | grep -qE 'rm.*-rf.*(src|lib|app|components)/'; then
  echo "⛔ Reins: 禁止批量删除源码目录。" >&2
  exit 2
fi

exit 0
```

### 3. Stop — 任务完成前验证

Claude 认为任务完成时触发，最后防线。

```bash
#!/bin/bash
# .reins/hooks/pre-complete-check.sh

# 检查新文件是否缺少测试
NEW_FILES=$(git diff --cached --name-only --diff-filter=A | grep -E '\.(ts|tsx)$' | grep -v '\.test\.' | grep -v '\.spec\.')
for f in $NEW_FILES; do
  TEST_FILE="${f%.ts}.test.ts"
  TEST_FILE2="${f%.tsx}.test.tsx"
  if [ ! -f "$TEST_FILE" ] && [ ! -f "$TEST_FILE2" ]; then
    echo "⛔ Reins: 新文件 $f 缺少对应的测试文件。" >&2
    exit 2
  fi
done

# 运行测试
if ! pnpm test --passWithNoTests 2>&1; then
  echo "⛔ Reins: 测试未通过。" >&2
  exit 2
fi

echo "✅ Reins: 所有检查通过。"
exit 0
```

### 4. UserPromptSubmit — 上下文注入

每次用户提交 prompt 时，按关键词自动注入相关 L2 上下文。

```bash
#!/bin/bash
# .reins/hooks/context-inject.sh

PROMPT=$(jq -r '.user_prompt // empty')
[ -z "$PROMPT" ] && exit 0

CONTEXT=""

if echo "$PROMPT" | grep -qiE 'api|route|endpoint'; then
  CONTEXT+="[Reins] API 开发约束已加载，详见 .reins/patterns/api-patterns.md\n"
fi

if echo "$PROMPT" | grep -qiE 'test|测试|spec'; then
  CONTEXT+="[Reins] 测试约束已加载，详见 .reins/patterns/testing-patterns.md\n"
fi

if echo "$PROMPT" | grep -qiE 'database|db|prisma|migration|数据库'; then
  CONTEXT+="[Reins] 数据库约束已加载，详见 .reins/patterns/db-patterns.md\n"
fi

[ -n "$CONTEXT" ] && echo -e "$CONTEXT"
exit 0
```

---

## 3 种执行模式

```
block (默认 critical)：
  exit 2 → 阻止操作 + stderr 反馈给 Claude
  Claude 看到反馈后自动修正

warn (默认 important)：
  exit 0 + stdout 提示
  Claude 看到提示但不被阻止
  提示写入 .reins/logs/ 供 /reins status 统计

off：
  hook 不执行
  仅靠软约束
```

---

## 约束保护机制

防止 AI agent 意外修改约束文件本身：

```bash
#!/bin/bash
# .reins/hooks/protect-constraints.sh

FILE=$(jq -r '.tool_input.file_path // .tool_input.filePath // empty')
[ -z "$FILE" ] && exit 0

if echo "$FILE" | grep -qE '\.reins/constraints\.yaml|\.reins/config\.yaml|\.reins/hooks/'; then
  echo "⛔ Reins: 约束文件受保护，不允许 agent 直接修改。" >&2
  echo "   请使用 /reins update 或 /reins hook 命令管理约束。" >&2
  exit 2
fi

exit 0
```

注册为 `PreToolUse:Edit|Write` hook。

---

## Hook 健康监控

```typescript
// hooks/health-monitor.ts

interface HookHealth {
  hookId: string;
  consecutiveErrors: number;
  lastError: string | null;
  lastSuccess: string | null;
  disabled: boolean;
  disabledReason: string | null;
}

// 每次 hook 执行后更新
function recordHookResult(hookId: string, result: 'success' | 'error', error?: string): void {
  const health = loadHookHealth(hookId);
  if (result === 'error') {
    health.consecutiveErrors++;
    health.lastError = error;
    // 超过阈值自动禁用
    if (health.consecutiveErrors >= config.hooks.health_threshold) {
      health.disabled = true;
      health.disabledReason = `连续 ${health.consecutiveErrors} 次错误: ${error}`;
    }
  } else {
    health.consecutiveErrors = 0;
    health.lastSuccess = new Date().toISOString();
  }
  saveHookHealth(hookId, health);
}
```

---

## 自动 Hook 生成流程

```
constraints.yaml 中的每条约束
    ↓
检查 enforcement.hook == true?
    ↓ Yes
根据 hook_type 选择模板
    ↓
填充检查逻辑 (hook_check 字段)
    ↓
写入 .reins/hooks/<hook-id>.sh
    ↓
注册到 .claude/settings.json
```

### settings.json 生成

```typescript
// hooks/settings-writer.ts

function generateSettingsJson(
  projectRoot: string,
  hooks: HookConfig[]
): void {
  const settings = {
    hooks: {
      PostToolUse: [],
      PreToolUse: [],
      Stop: [],
      UserPromptSubmit: [],
    }
  };

  for (const hook of hooks) {
    const entry = {
      matcher: hook.matcher,
      hooks: [{
        type: "command",
        command: `.reins/hooks/${hook.scriptName}`
      }]
    };

    switch (hook.type) {
      case 'post_edit':
        settings.hooks.PostToolUse.push({ ...entry, matcher: "Edit|Write" });
        break;
      case 'pre_bash':
        settings.hooks.PreToolUse.push({ ...entry, matcher: "Bash" });
        break;
      case 'pre_complete':
        settings.hooks.Stop.push({ hooks: entry.hooks });
        break;
      case 'context_inject':
        settings.hooks.UserPromptSubmit.push({ hooks: entry.hooks });
        break;
    }
  }

  // 始终添加约束保护 hook
  settings.hooks.PreToolUse.push({
    matcher: "Edit|Write",
    hooks: [{ type: "command", command: ".reins/hooks/protect-constraints.sh" }]
  });

  writeJson(`${projectRoot}/.claude/settings.json`, settings);
}
```

---

## 用户自定义 Hook

### 方式 1：/reins hook 命令

```
reins hook add "禁止导入 lodash，使用原生方法"
  → 分析约束类型
  → 生成检查脚本
  → 添加到 constraints.yaml + settings.json

reins hook list
  → 显示所有 hook 状态

reins hook disable <hook-id>
  → 禁用 hook（软约束仍有效）

reins hook fix
  → 修复健康检查失败的 hook
```

### 方式 2：编辑 constraints.yaml

```yaml
constraints:
  - id: "no-direct-sql"
    enforcement:
      hook: true           # ← 改为 false 可禁用
      hook_mode: "block"   # ← 改为 "warn" 降级
```

然后运行 `reins update` 重新生成。

### 方式 3：直接编辑 Hook 脚本

高级用户可以直接修改 `.reins/hooks/*.sh`。

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

**完整执行链条**：
```
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

## 子模块 & 源码结构

```
src/hooks/
├── generator.ts              # 从约束生成 hook 脚本
├── settings-writer.ts        # 生成 .claude/settings.json
├── health-monitor.ts         # Hook 健康监控
├── protection.ts             # 约束文件保护 hook
└── templates/                # Hook 脚本模板
    ├── post-edit-check.sh.tmpl
    ├── bash-guard.sh.tmpl
    ├── pre-complete.sh.tmpl
    └── context-inject.sh.tmpl
```

---

## 依赖关系

- **被依赖**：⑥ Pipeline Runner、⑦ Evaluation System
- **依赖**：③ Constraint Generator（constraints.yaml 中的 enforcement 配置）
- **外部依赖**：jq（hook 脚本中解析 JSON）

---

## 实施优先级

- **Phase 2**：post-edit-check + bash-guard + pre-complete-check + settings-writer + protect-constraints
- **Phase 3**：context-inject + health-monitor + /reins hook 命令
- **Phase 4**：hook 健康自动恢复

---

## 设计原则

1. **Hook 不替代软约束，两者互补** — 软约束覆盖面广（语义理解），Hook 覆盖关键点（确定性）
2. **默认保守** — Critical 默认 block，Important 默认 warn，Helpful 默认 off
3. **用户可覆盖一切** — 每个 hook 都可以 disable/warn/block 调整
4. **Hook 脚本可审查** — 普通 shell 脚本，用户可以读和改
5. **反馈闭环** — Hook 的 stderr 被 Claude 读取并自动修正
6. **日志可追溯** — 每次 hook 触发都记录到 .reins/logs/
