# 行业现状与竞品分析

## 约束配置文件格式对比

| 格式 | 创建者 | 适用范围 | 特殊功能 |
|------|--------|---------|---------|
| `CLAUDE.md` | Anthropic | Claude Code | @imports（5层）、/init 命令、@path 引用 |
| `AGENTS.md` | Linux Foundation（开放标准） | 跨工具通用 | 标准 Markdown，最近文件优先 |
| `.cursor/rules/*.mdc` | Cursor | Cursor IDE | YAML frontmatter、glob 激活、4种激活模式 |
| `.github/copilot-instructions.md` | GitHub | Copilot | 存放在 .github 目录 |
| `global_rules.md` + `.windsurf/rules/` | Windsurf | Windsurf IDE | 两层全局/工作区 |
| `CONVENTIONS.md` | Aider | Aider | 纯 Markdown，模型无关 |
| `.continue/rules/` | Continue.dev | Continue | YAML 配置，Hub 规则 |

## AGENTS.md 开放标准

- 由 **Linux Foundation 下的 Agentic AI Foundation** 管理
- 60,000+ 仓库采用
- 支持工具：Claude Code, Cursor, GitHub Copilot, Gemini CLI, Windsurf, Aider, Zed, Codex
- 发现层级：目录树从根到当前目录逐级查找
- 最大 32 KiB 合并（Codex 可配置 `project_doc_max_bytes`）

**跨工具兼容技巧**：
```bash
ln -sfn AGENTS.md .github/copilot-instructions.md
ln -sfn AGENTS.md CLAUDE.md  # 如果不使用 Claude 专有的 @import 功能
```

## CLAUDE.md 最佳实践

**指令预算**：前沿 LLM 可靠遵循约 150-200 条指令。Claude Code 系统 prompt 占用约 50 条，留给用户约 100-150 条。

**应该包含的**：
- Claude 无法猜测的 Bash 命令
- 与默认不同的代码风格规则
- 测试指令和首选 runner
- 仓库礼仪（分支命名、PR 约定）
- 项目特有的架构决策
- 开发环境怪癖

**不应该包含的**：
- Claude 能从代码推断的任何东西
- 标准语言约定
- 详细 API 文档（链接即可）
- 频繁变化的信息
- 文件级描述

**目标**：控制在 300 行以内，HumanLayer 自己的 CLAUDE.md 不到 60 行。

## 主要 AI 编码 Agent 对比

| 工具 | 类型 | 关键特性 |
|------|------|---------|
| **Claude Code** | Agentic IDE/Terminal | 读取整个代码库、GitHub/GitLab 集成、多 agent 团队 |
| **Aider** | Terminal CLI | 多 LLM 支持、率先实现终端 agent |
| **Windsurf/Cascade** | IDE + Agentic Editor | 6000 字符规则文件、全局/工作区规则 |
| **OMC** | 多 Agent 编排 | 29+ 专业 agent、40+ skill、5x 并行化 |
| **OpenCode** | 开源 Agent | 44 生命周期 hooks、HTTP API、TypeScript SDK |

## 已有 Harness 工具

| 项目 | 类型 | 核心价值 |
|------|------|---------|
| [awesome-harness-engineering](https://github.com/walkinglabs/awesome-harness-engineering) | 资源列表 | 全面的工具和文章索引 |
| [AI SDLC Scaffold](https://github.com/pangon/ai-sdlc-scaffold) | 项目模板 | 4阶段结构(spec→design→code→deploy) |
| [Claude Code Harness](https://github.com/Chachamaru127/claude-code-harness) | TypeScript 框架 | Plan→Work→Review + guardrail engine |
| [Bootstrap Framework](https://www.dotzlaw.com/insights/bootstrap-framework-01) | Meta-agent | 分析源码库 → 生成整个 .claude/ 配置 |
| [claude-bootstrap](https://github.com/alinaqi/claude-bootstrap) | 项目初始化 | 安全优先、spec-driven |
| [CursorRules.org](https://cursorrules.org/) | 规则生成器 | AI 驱动的 .cursorrules 自动生成 |

## 代码库分析工具

| 工具 | 能力 |
|------|------|
| **Sourcegraph (Cody + MCP)** | 语义跨仓库搜索、架构导航、1M token 上下文、MCP server |
| **CodeScene** | 行为分析、代码热点、技术债预测、团队耦合 |
| **Greptile** | 上下文代码搜索 + 依赖追踪 |
| **SonarQube** | 持续静态代码质量和安全分析 |
| **Mintlify** | 从代码自动生成文档 |
| **hex-graph** | 代码知识图谱 MCP server |

## SWE-bench 性能基线（2026年3月）

- **Claude Opus 4.5**: 80.9%（最佳）
- **模型平均**: 62.2%
- **SWE-bench Pro（更难）**: ~23.3%（GPT-5 最佳）
