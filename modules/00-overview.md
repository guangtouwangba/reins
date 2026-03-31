# Reins 模块全景

## 系统定位

Reins 是一个 **AI 编码代理约束治理工具**，核心能力是：扫描项目 → 生成约束 → 多格式输出 → 强制执行 → 自动验证 → 知识沉淀 → 持续进化。

**形态**：npm CLI 工具 + optional OMC plugin adapter
**核心原则**：Reins 是"约束生成器"，不是"约束消费者"。

---

## 9 大模块

```
用户命令 (/reins init | develop | status | update | learn | test | rollback)
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│                    ① CLI + State                            │
│                    (入口 + 状态管理)                          │
└────┬──────────┬──────────┬──────────┬──────────┬────────────┘
     │          │          │          │          │
     ▼          ▼          ▼          ▼          ▼
② Scanner   ③ Constraint ④ Context  ⑤ Hook    ⑥ Pipeline
(探索器)     Generator   Generator  System     Runner
             (约束生成)  (上下文生成) (Hook系统) (流水线)
     │          │          │          │          │
     └──────────┴──────────┴──────────┴──────────┘
                          │
                   ⑦ Evaluation
                    (评估系统)
                          │
                ┌─────────┴─────────┐
                │                   │
         ⑧ Self-Improving    ⑨ Knowledge
          (自进化闭环)        (隐式知识系统)
                │                   │
                └───── 互相反哺 ─────┘
```

---

## 模块依赖关系

```
② Scanner ──→ ③ Constraint Generator ──→ ④ Context Generator
                    │          ↑                 │
                    │          │ (毕业)           │
                    └──→ ⑤ Hook System ←────────┘
                         │         │
                         │    ⑨ Knowledge System
                         │    (捕获↑  ↓注入)
              ⑥ Pipeline Runner ←── ③ + ⑤
                    │
              ⑦ Evaluation System
                    │
              ⑧ Self-Improving ──→ ③ (更新约束)
                    │
                    └──→ ⑨ Knowledge (分析数据)

              ① CLI + State (串联以上所有)
```

**数据流**：
```
Scanner 产出 context.json/manifest.json
    → Constraint Generator 消费，产出 constraints.yaml
    → Context Generator 消费，产出 CLAUDE.md / AGENTS.md / patterns/
    → Hook System 消费 constraints.yaml，产出 hook 脚本 + settings.json
    → Pipeline Runner 消费 constraints.yaml + hooks，驱动开发流程
    → Evaluation System 消费 verification.yaml，驱动多层验证
    → Self-Improving 消费 logs，反馈到 constraints.yaml
    → Knowledge System 在 hook 触发点捕获隐式知识，通过 hook 注入上下文
       → 高置信度知识毕业为 constraint，反馈到 Constraint Generator
```

---

## 实施节奏

| Phase | 周期 | 模块 | 里程碑 |
|-------|------|------|--------|
| MVP | 1-2 周 | ② Scanner + ③ Constraint Gen + ④ Context Gen | `reins init` 可用 |
| Phase 2 | 2-4 周 | ⑤ Hook System + ⑥ Pipeline Runner | `reins develop` 可用 |
| Phase 3 | 4-6 周 | ① CLI 完善 + 生命周期管理 + ⑨ Knowledge 基础版 | `reins update/test/rollback` 可用，知识沉淀开始 |
| Phase 4 | 6-8 周 | ⑦ Evaluation System + ⑨ Knowledge 检索注入 | 分层验证可用，知识动态注入 |
| Phase 5 | 8-12 周 | ⑧ Self-Improving + ⑨ Knowledge 毕业机制 | 自进化闭环，知识→约束提升 |

---

## 产出物全景

### 目标项目中生成的文件

```
项目根目录/
├── CLAUDE.md                        # L0: 地图 + 关键命令 + 3-5 条核心约束
├── app/
│   ├── AGENTS.md                    # L1: app 目录约束
│   └── api/
│       └── AGENTS.md                # L1: API 目录约束
├── lib/
│   ├── AGENTS.md                    # L1: lib 目录约束
│   └── services/
│       └── AGENTS.md                # L1: services 目录约束
├── .cursorrules                     # Cursor 规则
├── .github/copilot-instructions.md  # Copilot 规则
├── .windsurfrules                   # Windsurf 规则
│
├── .claude/
│   └── settings.json                # Hook 配置
│
└── .reins/                          # Reins 工作目录
    ├── constraints.yaml             # 约束定义（团队共享，agent 只读）
    ├── config.yaml                  # Reins 元配置（团队共享）
    ├── config.local.yaml            # 个人覆盖（.gitignore）
    ├── verification.yaml            # 验证配方
    ├── hooks/                       # Hook 脚本
    ├── patterns/                    # L2 模式参考
    ├── profiles/                    # 约束 Profile
    ├── verification-cases/          # 验证用例
    ├── knowledge/                   # ⑨ 隐式知识库（团队共享）
    │   ├── index.yaml               #    知识索引
    │   ├── *.md                     #    单条知识文件
    │   └── archive/                 #    归档（.gitignore）
    ├── skills/                      # 学到的技能
    ├── snapshots/                   # 变更快照
    ├── manifest.json                # 目录快照
    ├── context.json                 # 探索缓存
    └── logs/                        # 执行日志
```

### Reins 自身的项目结构

```
reins/
├── src/
│   ├── cli.ts                       # ① CLI 入口
│   ├── scanner/                     # ② Scanner
│   ├── constraints/                 # ③ Constraint Generator
│   ├── context/                     # ④ Context Generator
│   ├── hooks/                       # ⑤ Hook System
│   ├── pipeline/                    # ⑥ Pipeline Runner
│   ├── evaluation/                  # ⑦ Evaluation System
│   ├── learn/                       # ⑧ Self-Improving
│   ├── knowledge/                   # ⑨ Knowledge System
│   ├── adapters/                    # 多格式输出 adapter
│   ├── state/                       # 状态管理
│   └── lifecycle/                   # 生命周期管理
├── templates/                       # 模板文件
└── test/                            # 测试
```

---

## 模块文档索引

| 文档 | 模块 |
|------|------|
| [01-cli-state.md](01-cli-state.md) | ① CLI 入口 + 状态管理 |
| [02-scanner.md](02-scanner.md) | ② Scanner 代码库探索器 |
| [03-constraint-generator.md](03-constraint-generator.md) | ③ Constraint Generator 约束生成器 |
| [04-context-generator.md](04-context-generator.md) | ④ Progressive Context Generator 渐进式上下文 |
| [05-hook-system.md](05-hook-system.md) | ⑤ Hook System |
| [06-pipeline-runner.md](06-pipeline-runner.md) | ⑥ Pipeline Runner 流水线 |
| [07-evaluation.md](07-evaluation.md) | ⑦ Evaluation System 评估系统 |
| [08-self-improving.md](08-self-improving.md) | ⑧ Self-Improving 自进化闭环 |
| [09-knowledge-system.md](09-knowledge-system.md) | ⑨ Knowledge System 隐式知识系统 |

补充运行时文稿：

- [../docs/user-requirement-runtime-sequence.md](../docs/user-requirement-runtime-sequence.md)：当前版本中“用户输入需求后系统如何运行”的真实时序说明
