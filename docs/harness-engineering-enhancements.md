# Reins Harness 工程增强建议

## 文档目的

本文从 **harness 工程** 的角度分析 Reins 当前能力边界，并给出一套更偏工程落地的增强路线。

这里的 harness，不只是“跑一下流程”的壳，而是一个能够做到以下几点的系统：

- 可重复执行
- 可回放失败
- 可自动判分
- 可稳定做回归
- 可把失败沉淀成新测试和新约束

换句话说，目标不是让 Reins “看起来更像 agent 平台”，而是让它真正成为一个 **agent execution + evaluation harness**。

---

## 一句话结论

Reins 现在已经具备了较完整的 **约束生成与上下文注入骨架**，但距离一个成熟的 harness 还差四个关键层：

1. 真实可复现的执行环境
2. 真实可判分的 grader 体系
3. 真实可累积的 benchmark / regression corpus
4. 真实可回放的 run trace 和 failure artifact

当前系统更像：

```text
项目扫描器 + 约束生成器 + 上下文输出器 + 部分 pipeline 骨架
```

而还不是：

```text
可执行、可验证、可比较、可迭代优化的 agent harness
```

---

## 当前能力判断

### 已经具备的部分

- CLI 入口和命令面比较完整：`init / develop / status / update / test / rollback / learn / analyze`
- 项目扫描、约束生成、上下文生成、adapter 输出已经有主流程
- pipeline 阶段编排已经存在
- evaluation 分层结构已经存在
- knowledge / learn 方向已经建了模块边界

这些能力说明 Reins 已经不是概念仓库，而是一个 **可运行的原型系统**。

### 目前最核心的缺口

#### 1. 执行桥还是 stub

`ralplan / executor / ralph` 目前还是占位实现，无法形成真正的执行闭环。

涉及位置：

- `src/pipeline/omc-bridge.ts`
- `src/pipeline/runner.ts`

这意味着 `develop` 目前更像“流程声明”，不是可靠的 execution harness。

#### 2. evaluation 分层存在，但 grader 还不够实

- L2 只做很薄的 HTTP 验证
- L3 只有 E2E 框架壳，执行仍偏 stub
- L4 语义评审固定返回默认值

涉及位置：

- `src/evaluation/l2-integration.ts`
- `src/evaluation/l3-e2e.ts`
- `src/evaluation/l4-semantic.ts`
- `src/evaluation/evaluator.ts`

#### 3. 日志不足以支撑 replay / failure analysis

当前执行日志主要是单份 YAML 记录，不足以支撑：

- 完整轨迹复盘
- prompt / tool / artifact 对齐
- 失败归因
- 模型和策略横向比较

涉及位置：

- `src/pipeline/execution-logger.ts`

#### 4. learn 闭环还没有真正长出 regression harness

当前方向是对的，但“失败 -> 最小复现 case -> benchmark -> 回归测试 -> 约束升级”的飞轮还没有打通。

---

## 从 Harness 工程看，最值得增强的方向

## 1. 真实执行环境层

这是优先级最高的一层。

### 当前问题

当前 pipeline 有阶段，但没有真正意义上的、可控的、可复现的执行环境。

如果没有这一层，后面的 eval、learn、knowledge 都会失真，因为：

- 同样任务无法稳定重跑
- 一次成功无法确认是能力还是偶然
- 一次失败无法确定是模型问题、环境问题还是工具问题

### 建议增强

为 `executor` 建立统一执行契约：

- 每次 run 使用独立工作目录
- 记录输入 repo snapshot / git revision / dirty state
- 固定环境变量和执行预算
- 固定工具权限、网络权限、超时策略
- 统一记录 stdout / stderr / exit code
- 支持失败后 replay

### 目标产物

每次执行都应该生成一份完整 run bundle，例如：

```text
.reins/runs/<run-id>/
├── run.json
├── prompt.txt
├── trace.jsonl
├── stdout.log
├── stderr.log
├── diff.patch
├── eval.json
├── artifacts/
└── replay.json
```

这一步是 Reins 从“有流程”升级到“有 harness”的分水岭。

---

## 2. 从多层验证升级为多类 grader

当前 L0/L1/L2/L3/L4 的层级概念是对的，但更重要的是 grader 的类型，而不只是层级名字。

### 建议拆成三类 grader

#### A. Executable graders

直接执行并判定结果：

- lint
- typecheck
- unit test
- integration test
- E2E
- service health probe
- CLI golden output

这类 grader 应该优先自动化，并尽量避免主观解释空间。

#### B. Structural graders

从代码结构和改动边界判定质量：

- 改动文件是否越界
- 是否触达指定模块
- AST 级别结构是否符合要求
- 是否引入不必要的新依赖
- 是否出现大范围无关重写
- patch 是否保留目标语义

这类 grader 对“防 reward hacking”很重要，因为仅靠测试可能挡不住“高覆盖但偏题”的改法。

#### C. Trace graders

从 agent 执行轨迹判定过程质量：

- 是否调用了被禁止的工具
- 是否重复无效尝试过多次
- 是否在失败后回到正确分支
- 是否在约束冲突后仍继续推进错误路径
- 是否在无证据的情况下声明完成

Reins 已经有 hook 和 tracer 的基础，这层非常适合继续做深。

---

## 3. 建立稳定 benchmark corpus

一个成熟 harness 不能只服务“当前一次任务”，而是要有长期积累的任务集。

### 当前问题

Reins 现在更像在单次项目初始化或单次 pipeline 上工作，还缺：

- 稳定的任务样本库
- 不同难度的基准集合
- 历史基线
- 不同模型 / 配置 /策略 的横向可比性

### 建议设计

新增 benchmark 目录，例如：

```text
.reins/benchmarks/
├── tasks/
│   ├── bugfix-001.yaml
│   ├── feature-003.yaml
│   └── refactor-002.yaml
├── baselines/
│   ├── gpt-5.4.json
│   └── claude-*.json
└── suites/
    ├── smoke.yaml
    ├── regression.yaml
    └── release-gate.yaml
```

每个 case 至少包含：

- 任务说明
- 允许改动范围
- 必过 grader
- 可选语义 rubric
- 历史通过记录

### 为什么这层重要

没有 corpus，就没有稳定评估；没有稳定评估，就无法做模型选择、prompt 迭代、策略比较和回归控制。

---

## 4. 让 learn 真正变成 failure-to-regression 飞轮

Reins 的方向里最有潜力的，不是单次约束生成，而是 **把失败变成长期资产**。

### 理想闭环

```text
失败 run
  -> 提取失败原因
  -> 归纳成最小复现任务
  -> 进入 benchmark / regression suite
  -> 后续改动自动回归
  -> 多次验证后升级为 constraint 或 knowledge
```

### 当前问题

现在的 learn / analyze / knowledge 还偏“分析与记录”，离“自动形成回归压力”还有距离。

### 建议增强

- analyzer 输出最小失败模式，而不只输出建议
- 失败样本自动落地为 benchmark case 草稿
- 常见错误自动生成 structural grader 或 hook 候选
- 高置信知识自动绑定适用路径、任务类型、文件亲和度

这会让 Reins 的 knowledge system 不只是笔记系统，而是 harness 的数据增长机制。

---

## 5. hook / guardrail / structured I/O 统一化

如果 Reins 要成为 harness，它的 guardrail 不能只是几段 shell template，而应该是一层统一执行契约。

### 当前问题

hook 的模板机制已经存在，但系统层面还缺：

- hook 版本化
- hook 能力声明
- hook 与 pipeline 阶段的对应关系
- hook 命中后的可观测日志
- hook 结果在 eval 中的可判分化

另外，代码里已有 hook 生成与 settings 写入模块，但主初始化链路与“当前真实接线”之间仍有收口空间，说明这部分还需要进一步统一。

### 建议增强

- 把 hook 执行结果写入统一 trace
- 对 hook 命中、放行、阻断分别建结构化事件
- 将关键节点的输入输出从自由文本改成结构化 JSON
- 对高风险操作强制使用 typed tool schema

这一步会显著提升可调试性和 trace grading 能力。

---

## 6. single-agent first，multi-agent later

从 harness 工程角度，不建议现在过早把重点放在复杂多 agent 编排上。

### 原因

Reins 当前最核心的问题不是“agent 数量不够”，而是：

- 单个执行链还不够真实
- grader 不够实
- replay 能力不够
- failure corpus 没建起来

这些问题在多 agent 下通常会更难排查。

### 建议原则

- 先把单 executor 的能力做实
- planner / reviewer 可以先作为 grader 辅助角色
- 多 agent 只在任务确实可并行时启用
- 多 agent 的收益必须能通过 benchmark 数据证明

如果没有 harness 数据支撑，过早引入 swarm 往往只会提高系统复杂度，而不会提高可靠性。

---

## 推荐的增强优先级

## P0：把 Reins 从“流程骨架”升级成“真实 harness”

建议先做：

1. 真正可执行的 `executor` sandbox
2. run bundle + replay artifact
3. 结构化 trace
4. 基础 executable grader 全接通

这一步完成后，`develop` 才算开始具备真实工程价值。

## P1：把 evaluation 做成可比较系统

建议再做：

1. structural grader
2. trace grader
3. benchmark task schema
4. baseline 记录和回归套件

这一步完成后，Reins 才能开始稳定比较不同 prompt、模型和策略。

## P2：把 learn 做成数据飞轮

建议最后做：

1. failure -> regression case 自动草稿
2. regression -> knowledge -> constraint 的升级机制
3. 常见错误模式自动生成 hook / grader 候选

这一步完成后，Reins 才会具备真正的“自进化 harness”特征。

---

## 一个更贴近落地的 v2 模块视图

建议将后续增强聚焦为下面五个核心层：

```text
① Task Layer
   任务定义 / benchmark case / suite / baseline

② Execution Layer
   sandbox / tool policy / run bundle / replay

③ Grading Layer
   executable / structural / trace / semantic grader

④ Learning Layer
   failure mining / regression generation / knowledge promotion

⑤ Governance Layer
   constraints / hooks / guardrails / context injection
```

对应关系上：

- Reins 当前最强的是 ⑤
- 当前已有骨架的是 ②③④
- 当前最缺的是 ② 和 ③ 的“真实可运行度”

---

## 推荐的近期落地任务

如果只做一轮高收益增强，建议按下面顺序推进：

1. 为 `develop` 增加真实执行器和 run artifact 目录
2. 把 L2/L3/L4 grader 做实，尤其是 structural grader
3. 定义 benchmark case schema 和 regression suite
4. 把失败 run 自动转成 regression case 草稿
5. 把 hook 事件并入统一 trace 和 eval

---

## 外部参考

以下资料对 Reins 的 harness 演进方向有直接参考价值：

- OpenAI Evals best practices  
  https://developers.openai.com/api/docs/guides/evaluation-best-practices

- OpenAI, A practical guide to building agents  
  https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf

- OpenAI, Safety in building agents  
  https://developers.openai.com/api/docs/guides/agent-builder-safety

- Google Research, Towards a science of scaling agent systems: When and why agent systems work  
  2026-01-28  
  https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/

- Anthropic, AI-resistant technical evaluations  
  https://www.anthropic.com/engineering/AI-resistant-technical-evaluations

- SWE-PolyBench: A multi-language benchmark for repository-level evaluation of coding agents  
  2025-04-23  
  https://arxiv.org/abs/2504.08703

---

## 最终判断

Reins 这条路是成立的，但它下一个阶段不该继续优先扩“功能名词”，而应该优先补足 harness 的四个基础能力：

- execution realism
- grading realism
- replayability
- regression accumulation

只有这四层打实，Reins 才会从“给 agent 配规则的工具”进化成“能够系统性提升 agent 工程质量的 harness”。
