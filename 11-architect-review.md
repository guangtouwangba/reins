# 架构师 Review：用户选择度 × 自动化程度

## 总评

Reins 在初始化和 Hook 模块上设计成熟，但在持续生命周期（update/status/跨项目学习）上投资不足。核心矛盾：**首次运行体验得到了不成比例的关注，而持续运营被低估了。**

---

## 各模块评分

| 模块 | 用户选择度 | 自动化程度 | 短板 |
|------|-----------|-----------|------|
| `/reins init` | 8/10 | 9/10 | 缺少扫描深度选项、re-init 合并策略 |
| `/reins develop` | **6/10** | 8/10 | 无法按任务选择约束子集、无法跳过 pipeline 阶段 |
| `/reins status` | **5/10** | **6/10** | 无过滤/格式选项、缺少趋势分析和告警 |
| `/reins update` | 7/10 | **4/10** | **最弱模块** — 仅手动触发，无事件驱动 |
| `/reins learn` | 7/10 | 7/10 | 阈值硬编码、无法控制 scope 和衰减率 |
| `/reins hook` | **9/10** | 8/10 | 缺少 hook 健康监控 |

---

## 7 个关键改进建议（按优先级）

### 1. 新增 `reins.config.yaml` 元配置 [高优先级]

**问题**：用户偏好（扫描深度、学习阈值、默认模式）要么硬编码要么缺失。

```yaml
# .reins/config.yaml — 控制 Reins 自身行为
scan:
  depth: "L0-L2"              # L0 | L0-L1 | L0-L2 | L0-L5
  exclude_dirs: ["vendor/"]

develop:
  default_model: "sonnet"      # haiku | sonnet | opus
  skip_stages: []              # ["planning", "qa"]
  constraint_profile: "strict" # strict | relaxed | custom

learn:
  auto_extract_threshold: 85   # 自动提取阈值
  suggestion_threshold: 60     # 建议提取阈值
  cooldown_messages: 5
  scope_default: "project"

update:
  auto_trigger: "session_end"  # manual | session_end | file_count:50
  staleness_check: true

hooks:
  default_mode: "block"
  health_check: true           # 自动禁用坏 hook

status:
  default_format: "human"      # human | json | markdown
  history_days: 30
```

### 2. 事件驱动的 update 触发 [高优先级]

**问题**：update 是最弱模块（4/10 自动化），仅靠用户手动触发。

**方案**：
- `SessionEnd` hook → 轻量级过期检查（manifest 时间戳 vs 最新文件变化）
- `post-merge` / `post-checkout` git hook → 触发 `reins update --check`
- `/reins status` 显示约束过期指示器
- 检测不再存在的约束和失效的文件路径引用

### 3. 约束 Profile 机制 [高优先级]

**问题**：`/reins develop` 一刀切加载所有约束，无法按任务调整。

```bash
/reins develop --profile relaxed "快速原型"    # 仅 critical 约束
/reins develop --profile strict "生产功能"     # 全部约束
/reins develop --skip qa "修复 README 错别字"  # 跳过 QA 阶段
```

```yaml
# constraints.yaml
profiles:
  strict:   { constraints: all, hooks: all, pipeline: [plan, exec, review, qa] }
  relaxed:  { constraints: [critical], hooks: [critical], pipeline: [exec] }
  ci:       { constraints: all, hooks: all, pipeline: [exec, qa], format: json }
```

### 4. Re-init 合并策略 [高优先级]

**问题**：在已有 `.reins/` 的项目上重新运行 init 会怎样？没有定义。

```bash
/reins init              # 默认 --merge：保留用户修改，添加新检测
/reins init --force      # 全部重新生成
/reins init --diff       # 仅预览差异，不写入
```

### 5. Hook 健康监控 [中优先级]

**问题**：坏 hook（语法错误、依赖缺失）可能静默阻塞所有开发。

```yaml
# .reins/logs/hook-health.yaml
hook_health:
  post-edit-check.sh:
    total_runs: 142
    exit_0: 130
    exit_2: 10
    errors: 2               # 非 0/2 退出码
    last_error: "jq: command not found"
    status: healthy          # healthy | degraded | broken
```

连续失败 5 次 → 自动禁用 + `/reins status` 告警。仅对意外错误（非 exit 2）自动禁用。

### 6. 多用户协作模型 [中优先级]

**问题**：设计是单用户视角，未考虑团队场景。

```
.reins/ 文件分类：
  团队共享（提交到 git）：
    ├── constraints.yaml
    ├── hooks/
    └── patterns/

  个人专属（.gitignore）：
    ├── config.local.yaml    # 个人偏好覆盖
    ├── logs/
    └── skills/auto/         # 自动学习的 skill
```

### 7. 缺失场景补充 [中优先级]

| 缺失场景 | 建议 |
|----------|------|
| **Monorepo** | 支持 per-package constraints.yaml |
| **约束版本迁移** | constraints.yaml version 字段 + 迁移脚本 |
| **约束冲突检测** | init/update 时检测矛盾约束 |
| **约束测试** | `/reins test` 用合成违规验证 hook 有效性 |
| **回滚** | `/reins rollback` 恢复上一版约束 |
| **Dry-run** | `--dry-run` 预览所有命令的输出 |
| **constraints.yaml 保护** | PreToolUse hook 阻止 agent 修改约束文件 |

---

## 行业对齐评估

| 实践 | OpenAI | Anthropic | Bootstrap | Reins 现状 | 差距 |
|------|--------|-----------|-----------|-----------|------|
| 地图而非手册 | ✅ | ✅ | ✅ | ✅ L0/L1/L2 | 无 |
| 确定性+LLM 混合 | ✅ | ✅ | ✅ | ✅ Hook+CLAUDE.md | 缺少确定性质量评分 |
| 渐进式上下文 | ✅ | ✅ | ✅ 3-tier | ✅ 3层 | 无 |
| 垃圾回收 Agent | ✅ | - | - | ⚠ Phase 4 | 实现远期 |
| JSON 防篡改 | - | ✅ | - | ❌ 用 YAML | 约束文件需要防写保护 |
| Agent 定义生成 | - | - | ✅ 4个 | ❌ 不生成 | 缺少项目特定 agent 配置 |
| 三时间尺度改进 | ✅ | ✅ | ✅ | ⚠ 概念有，实现远期 | Hook(分钟) ✅ Learn(session) ⚠ Self-improve(月) ❌ |
| 事件驱动更新 | ✅ | ✅ | ✅ | ❌ 仅手动 | **最大差距** |

---

## 核心结论

> **根因**：Reins 被设计为命令驱动系统（用户运行 `/reins X`），但真正的自动化需要事件驱动触发（文件变化、session 结束、测试失败、约束违反 N 次）。Hook 系统为约束执行解决了这个问题，但 Reins 自身的自我改进仍然是命令驱动的。

**一句话**：把 Reins 自身的生命周期也放到 Hook 上。
