# 模块 ①：CLI 入口 + 状态管理

## 职责

- 命令路由：解析用户命令，分发到对应模块
- 配置加载：合并 config.yaml + config.local.yaml + 默认值
- 状态持久化：manifest、snapshot、logs
- 多用户协作：团队共享 vs 个人文件分离

---

## 命令体系

| 命令 | 功能 | 调用的模块 | Phase |
|------|------|-----------|-------|
| `reins init` | 初始化项目约束 | ② → ③ → ④ → ⑤ | MVP |
| `reins develop <task>` | 在约束下自动开发 | ⑥ (Pipeline Runner) | Phase 2 |
| `reins status` | 查看约束状态和统计 | ① (读取 logs + constraints) | Phase 3 |
| `reins update` | 增量更新约束 | ② → ③ (增量 diff) | Phase 3 |
| `reins learn` | 手动保存学到的知识 | ⑧ (Learner) | Phase 3 |
| `reins test` | 测试约束和 Hook 有效性 | ⑤ + ⑦ | Phase 3 |
| `reins rollback` | 回滚约束变更 | ① (snapshot restore) | Phase 3 |
| `reins hook` | 管理 Hook (add/list/disable/fix) | ⑤ | Phase 2 |

### 命令参数

```bash
reins init [--depth L0-L2] [--force] [--diff] [--dry-run]
reins develop <task> [--profile strict|default|relaxed] [--skip qa|planning] [--dry-run]
reins status [--filter critical] [--format json|human|markdown] [--since 7d] [--compare 14d]
reins update [--auto-apply]
reins test
reins rollback [--to <snapshot-id>]
reins hook add <description>
reins hook list
reins hook disable <hook-id>
reins hook fix
reins hook promote <constraint-id>
```

---

## 元配置：reins.config.yaml

控制 Reins 自身行为，所有字段可选，均有合理默认值。

```yaml
# .reins/config.yaml
scan:
  depth: "L0-L2"              # L0 | L0-L1 | L0-L2 | L0-L5
  exclude_dirs: ["vendor/", "generated/"]

develop:
  default_model: "sonnet"      # haiku | sonnet | opus
  skip_stages: []              # ["planning", "qa"]
  constraint_profile: "default" # strict | default | relaxed | custom

learn:
  auto_extract_threshold: 85   # >= 此分自动保存为 draft skill
  suggestion_threshold: 60     # >= 此分提示用户
  cooldown_messages: 5         # 每 N 条消息最多提示一次
  scope_default: "project"     # project | global

update:
  auto_trigger: "session_end"  # manual | session_end | file_count:50 | interval:1d
  staleness_check: true        # 检测引用了不存在的文件/目录的约束
  auto_apply: false            # true = 高置信度变更自动应用

hooks:
  default_mode: "block"        # block | warn | off
  health_check: true           # 自动禁用连续失败的 hook
  health_threshold: 5          # 连续 N 次意外错误后禁用

status:
  default_format: "human"      # human | json | markdown
  history_days: 30

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
  auto_detect_type: true
  l2_timeout: 300
  l3_timeout: 600
  l4_model: "sonnet"
```

配置加载优先级：`config.local.yaml > config.yaml > 默认值`

---

## 状态管理

### Manifest（目录快照）

```typescript
// state/manifest.ts
interface Manifest {
  version: number;
  generatedAt: string;
  projectRoot: string;
  directories: DirectoryEntry[];
  files: FileEntry[];
  hash: string;  // 用于增量 diff
}

// 核心操作
function saveManifest(projectRoot: string, manifest: Manifest): void;
function loadManifest(projectRoot: string): Manifest | null;
function diffManifest(prev: Manifest, curr: Manifest): ManifestDiff;
```

### Snapshot（约束变更快照）

```typescript
// state/snapshot.ts
interface Snapshot {
  id: string;              // timestamp-based
  createdAt: string;
  trigger: string;         // "init" | "update" | "hook add" | ...
  files: {
    path: string;          // 相对于 projectRoot
    content: string;       // 文件内容
  }[];
}

// 核心操作
function saveSnapshot(projectRoot: string): string;  // 返回 snapshot id
function listSnapshots(projectRoot: string): Snapshot[];
function restoreSnapshot(projectRoot: string, snapshotId: string): void;
```

### Config 加载

```typescript
// state/config.ts
interface ReinsConfig {
  scan: ScanConfig;
  develop: DevelopConfig;
  learn: LearnConfig;
  update: UpdateConfig;
  hooks: HooksConfig;
  status: StatusConfig;
  evaluation: EvaluationConfig;
}

function loadConfig(projectRoot: string): ReinsConfig {
  const defaults = getDefaultConfig();
  const team = loadYaml(`${projectRoot}/.reins/config.yaml`) || {};
  const local = loadYaml(`${projectRoot}/.reins/config.local.yaml`) || {};
  return deepMerge(defaults, team, local);
}
```

---

## 多用户协作模型

```
.reins/ 文件分类：

  团队共享（提交到 git）：
    ├── constraints.yaml       # 约束定义
    ├── config.yaml            # 团队级 Reins 配置
    ├── hooks/                 # Hook 脚本
    ├── patterns/              # L2 模式参考
    ├── profiles/              # 约束 Profile
    └── README.md              # 使用说明

  个人专属（.gitignore）：
    ├── config.local.yaml      # 个人偏好覆盖
    ├── manifest.json          # 本地目录快照
    ├── context.json           # 本地探索缓存
    ├── snapshots/             # 变更快照
    ├── skills/auto/           # 自动学习的 skill
    └── logs/                  # 执行日志
```

---

## Re-init 合并策略

在已有 `.reins/` 的项目上重新运行 init：

```bash
reins init              # 默认 --merge：保留用户修改，添加新检测，标记冲突
reins init --force      # 全部重新生成（覆盖所有）
reins init --diff       # 仅预览差异，不写入任何文件
```

**合并逻辑**：
- 用户手动修改过的约束 → **保留**
- 新检测到的约束 → **添加为 draft**
- 不再适用的约束 → **标记为 deprecated**，不直接删除
- 冲突 → **交互式让用户选择**

---

## 源码结构

```
src/
├── cli.ts                    # Commander.js 入口
├── state/
│   ├── config.ts             # config.yaml 加载
│   ├── manifest.ts           # 增量扫描
│   ├── diff.ts               # 变更检测
│   └── snapshot.ts           # 快照 (支持 rollback)
└── lifecycle/
    ├── staleness-checker.ts  # 过期检测
    ├── event-triggers.ts     # 事件驱动触发
    ├── test-runner.ts        # /reins test
    └── rollback.ts           # /reins rollback
```

---

## 依赖

- **被依赖**：所有其他模块通过 CLI 入口调用
- **依赖**：无直接模块依赖（纯基础设施）
- **外部依赖**：Commander.js (CLI 框架), yaml (配置解析)
