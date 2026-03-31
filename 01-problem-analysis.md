# Harness Engineering：问题分析

## 问题的本质（第一性原理）

```
为什么需要 harness？ → AI 编码 agent 在陌生项目上效果差
为什么效果差？ → 缺少项目上下文 + 没有约束 + 没有反馈循环
为什么缺少这些？ → 每个项目都需要人手动配置 CLAUDE.md 等文件
为什么不能自动化？ → 这就是 harness engineering 要解决的问题
```

**核心矛盾**：AI agent 的通用能力 vs 每个项目的特殊性。Harness 就是桥梁。

## 行业定义

> "2025 was agents. 2026 is agent harnesses." — Martin Fowler

**Harness Engineering** 是设计围绕 AI coding agent 的系统、约束、反馈循环、文档和验证基础设施的工程学科，使 agent 在规模化生产环境中可靠运行。

## 五大支柱（NxCode 2026）

1. **Tool Orchestration** — 显式工具访问定义、权限、调用模式
2. **Guardrails and Safety Constraints** — 权限边界的确定性规则
3. **Error Recovery and Feedback Loops** — 重试逻辑、自验证、回滚、循环检测
4. **Observability** — 记录 agent 动作、token 使用、决策过程
5. **Human-in-the-Loop Checkpoints** — 仅在高风险时刻的战略性审批门

**关键数据**：LangChain 仅通过优化 harness（不改底层模型）就将 agent 任务完成率从 52.8% 提升到 66.5%。

## 现有解决方案光谱

```
手动 ←————————————————————————————→ 全自动

.cursorrules    CLAUDE.md    OMC/deepinit    目标工具
(手写规则)      (手写规则)    (半自动扫描     (全自动探索+
                             生成AGENTS.md)   约束+执行+测试)
```

| 工具 | 探索 | 约束生成 | 自动执行 | 自动审查 | 自动测试 |
|------|------|---------|---------|---------|---------|
| .cursorrules | - | 手写 | - | - | - |
| CLAUDE.md | - | 手写 | - | - | - |
| OMC deepinit | **半自动** | **半自动** | - | - | - |
| OMC autopilot | - | - | **自动** | **自动** | **自动** |
| **目标工具** | **全自动** | **全自动** | **全自动** | **全自动** | **全自动** |

**关键洞察**：OMC 已经分别实现了两半 — deepinit 做探索+约束，autopilot 做执行+审查+测试。但它们之间缺少一个关键连接层：从探索结果自动生成可执行的约束配置，并驱动自动化流水线。
