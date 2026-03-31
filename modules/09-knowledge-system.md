# 模块 ⑨：Knowledge System（隐式知识系统）

## 职责

将 agent 的"经历"转化为"经验"——捕获、存储、检索、验证项目中的隐式知识。隐式知识是那些不在代码或配置中，但影响决策的上下文：模块耦合、踩坑记录、架构决策原因、用户偏好。

**核心洞察**：agent 自己就是最好的知识提取器。它刚完成任务，拥有完整上下文，让它做结构化反思，比任何规则引擎提取的信息都更准确。

**与显式约束的关系**：
```
显式约束 (constraints.yaml)  = "必须用 Prisma"     → 强制执行，覆盖面窄
隐式知识 (knowledge/)       = "payment 模块敏感"   → 影响决策，覆盖面广

两者互补，且隐式知识可以"毕业"为显式约束。
```

---

## 知识的四种类型

| 类型 | 示例 | 检索触发 | 衰减速度 | 终态 |
|------|------|---------|---------|------|
| **coupling** (耦合) | "auth 和 webhook 共享 session store" | 涉及相关文件 | 中（重构时失效） | 架构约束 |
| **gotcha** (踩坑) | "Prisma 在 Edge Runtime 不能用" | 涉及相关技术/文件 | 快（依赖更新可能修复） | Skill |
| **decision** (决策) | "选 Redis 因为需要 pub/sub" | 重新考虑同一架构时 | 极慢（业务变化才失效） | ADR 长期存在 |
| **preference** (偏好) | "用户偏好函数式，避免 class" | 几乎所有编码任务 | 极慢（用户改主意才变） | Helpful 级约束 |

---

## 三个捕获触发点

### 触发 1：任务完成后 — "这次你学到了什么"

在 Stop hook 通过后，追加一次结构化反思。这是最自然的总结点，token 成本可忽略（一个任务可能 1000 次工具调用，最后多一次反思）。

**反思 Prompt**：

```
你刚完成了任务：<task_description>

请回答以下问题，只回答有实质内容的，没有就跳过：

1. [coupling] 你发现了哪些不明显的模块耦合或依赖关系？
   （修改 A 导致 B 出问题，A 和 B 共享某个状态）

2. [gotcha] 你踩了什么坑？走了什么弯路？
   （第一次尝试失败的原因，意外的行为）

3. [decision] 你做了什么非平凡的技术决策？为什么？
   （选择方案 A 而非 B 的理由，权衡了什么）

4. [heuristic] 如果再做一次类似任务，你希望提前知道什么？
   （能让下次更快完成的关键信息）

输出格式（每条一个 YAML block）：
---
type: coupling | gotcha | decision | preference
summary: "一句话摘要"
detail: "展开说明（2-3句）"
related_files:
  - "path/to/file1.ts"
  - "path/to/file2.ts"
confidence: 60-100
---
```

**关键设计**：不是让 agent 自由发挥，而是用**结构化问题引导**。自由发挥容易产出废话，结构化问题逼出高密度信息。

### 触发 2：用户纠正时 — "差异背后的原则"

用户说"不对，换个方式"是最高信号的学习机会——agent 认为 A 是对的，用户说 B 才是对的，这个**期望差**就是隐式知识。

**检测方式**：
- 用户消息中包含否定信号（"不对"、"别这样"、"换个方式"、"no"、"don't"、"stop"）
- 用户手动编辑了 agent 生成的代码（通过 git diff 检测）
- 用户拒绝了 plan 并提供替代方向

**提取 Prompt**：

```
用户刚纠正了你的做法。请分析：

1. 你做了什么？（简述原始方法）
2. 用户期望的是什么？（简述纠正后的方法）
3. 差异背后的原则是什么？
   — 不是记录"用户说了什么"，而是"为什么用户是对的"
   — 提取可迁移的原则，而不是具体事实
4. 这个原则在什么场景下适用？（scope）

输出格式：
---
type: preference | gotcha | decision
summary: "原则的一句话表述"
detail: "背景和推理"
scope: "global | directory:path | file:path"
related_files: [...]
confidence: 70-95
---
```

**关键设计**：提取**原则**而非**事实**。
- 事实："用户让我用 Result 而不是 try-catch" — 不可迁移
- 原则："这个项目的错误处理哲学是让调用方决定如何处理失败" — 可迁移到所有新代码

### 触发 3：失败重试后 — "为什么第一次不行"

agent 尝试 A 失败，转而尝试 B 成功。失败路径的知识密度极高，但当前系统完全没有捕获这个信号。

**检测方式**：
- Hook 拦截后 agent 修改了方法
- 测试失败后 agent 改了实现
- 编译错误后 agent 换了依赖/API

**提取 Prompt**：

```
你刚经历了一次失败重试：
- 第一次尝试：<summary of first attempt>
- 失败原因：<error/hook message>
- 成功方法：<summary of successful approach>

请分析：
1. 这个失败是项目特有的还是通用的？
2. 根因是什么？（不是表面错误，是为什么第一次会选错方法）
3. 如何在下次避免走这条弯路？

输出格式：
---
type: gotcha
summary: "一句话"
detail: "根因分析"
related_files: [...]
confidence: 60-85
trigger_pattern: "什么场景下这个知识应该被召回"
---
```

**关键设计**：产出**负面知识**——"不要在这里这样做"。负面知识的信噪比往往高于正面知识，因为它直接对应一个具体的失败模式。

---

## 存储模型：Tagged Markdown + 索引

### 目录结构

```
.reins/
├── knowledge/
│   ├── index.yaml                    # 知识索引（快速查找）
│   ├── coupling-auth-webhook.md      # 单条知识
│   ├── gotcha-prisma-edge.md
│   ├── decision-redis-pubsub.md
│   ├── preference-functional-style.md
│   └── ...
```

### 知识索引：index.yaml

```yaml
# .reins/knowledge/index.yaml
version: 1
entries:
  - id: "k-001"
    type: "coupling"
    summary: "auth 和 webhook 共享 session store，修改需同步测试"
    related_files:
      - "lib/auth/session.ts"
      - "app/api/webhooks/handler.ts"
    tags: ["auth", "webhook", "session"]
    confidence: 85
    source: "reflection"           # reflection | correction | retry | manual
    created: "2026-03-28"
    last_validated: "2026-03-31"
    last_injected: "2026-03-30"
    injection_outcomes:
      success: 3
      failure: 0
    file: "coupling-auth-webhook.md"

  - id: "k-002"
    type: "gotcha"
    summary: "Prisma 在 Edge Runtime 不能用，需要 @prisma/client/edge"
    related_files:
      - "lib/prisma.ts"
      - "app/api/*/route.ts"
    tags: ["prisma", "edge", "serverless"]
    confidence: 90
    source: "retry"
    created: "2026-03-25"
    last_validated: "2026-03-31"
    trigger_pattern: "edge|serverless|vercel.*function"
    file: "gotcha-prisma-edge.md"

  - id: "k-003"
    type: "preference"
    summary: "用户偏好函数式组合，避免 class 继承"
    related_files: []              # global scope
    tags: ["style", "functional", "class"]
    confidence: 80
    source: "correction"
    created: "2026-03-20"
    scope: "global"
    file: "preference-functional-style.md"
```

### 单条知识文件

```markdown
<!-- .reins/knowledge/coupling-auth-webhook.md -->
---
id: k-001
type: coupling
confidence: 85
created: 2026-03-28
source: reflection
task: "重构 auth middleware"
---

# auth 模块与 webhook handler 的 session 耦合

## 现象
修改 `lib/auth/session.ts` 的 session 存储格式后，
`app/api/webhooks/handler.ts` 中的 webhook 验证开始失败。

## 根因
两个模块共享 Redis 中的 session store。auth 模块写入 session，
webhook handler 读取 session 来验证请求来源。session 格式变更
没有同步到 webhook 的解析逻辑。

## 影响范围
- `lib/auth/session.ts` — session 写入
- `lib/auth/middleware.ts` — session 验证
- `app/api/webhooks/handler.ts` — session 读取
- `app/api/webhooks/verify.ts` — 签名验证（间接依赖）

## 建议
修改 auth session 相关代码后，务必运行 webhook 相关测试：
```bash
pnpm test -- --grep "webhook"
```
```

---

## 检索策略：File-Affinity（文件亲和度）

### 核心洞察

**90% 的项目知识都绑定在具体文件路径上。**

"Prisma Edge Runtime 问题"绑定在 `lib/prisma.ts`。
"auth 和 webhook 耦合"绑定在 `lib/auth/` + `app/api/webhooks/`。

不需要语义向量检索，路径匹配就能覆盖绝大多数场景。

### 检索流程

```
任务/prompt 进来
    ↓
① 估算涉及的文件/目录
   — 从 prompt 关键词推断（"修改 auth" → lib/auth/）
   — 从最近编辑的文件推断
   — 从任务计划中提取（如果有 plan）
    ↓
② 路径匹配
   — 精确匹配：knowledge.related_files 包含目标文件
   — 目录匹配：knowledge.related_files 在同一目录下
   — 标签匹配：prompt 关键词命中 knowledge.tags
    ↓
③ 排序
   relevance = file_match * 0.4
             + tag_match * 0.2
             + confidence * 0.2
             + recency * 0.1
             + injection_success_rate * 0.1
    ↓
④ 取 Top-N（默认 3-5 条）
    ↓
⑤ 注入到 context
```

### 四阶段渐进增强

| 阶段 | 检索方法 | 实现成本 | 覆盖率 |
|------|---------|---------|--------|
| **Phase 1** | 路径精确匹配 | 极低 | ~60% |
| **Phase 2** | + 目录模糊匹配 + tag 匹配 | 低 | ~80% |
| **Phase 3** | + 任务类型匹配（bug fix / feature / refactor） | 中 | ~90% |
| **Phase 4** | + 语义 embedding（如果需要） | 高 | ~95% |

Phase 1-2 可能就够了。Phase 4 可能永远不需要。

### 检索的实现位置：UserPromptSubmit Hook

```bash
#!/bin/bash
# .reins/hooks/knowledge-inject.sh

PROMPT=$(jq -r '.user_prompt // empty')
[ -z "$PROMPT" ] && exit 0

# 调用知识检索（轻量脚本，读 index.yaml + 路径匹配）
KNOWLEDGE=$(.reins/bin/retrieve-knowledge.sh "$PROMPT")

if [ -n "$KNOWLEDGE" ]; then
  echo "$KNOWLEDGE"
fi

exit 0
```

---

## 注入形态：轻量提示 + 深入路径

注入知识不是 dump 全文，而是给**摘要 + 路径**。跟 L0/L1/L2 的渐进式设计一致。

```
[Reins Knowledge] 即将涉及的模块有 2 条相关经验：

1. [coupling] lib/auth/session.ts 与 app/api/webhooks/handler.ts 共享 session store
   → 修改 auth 后需同步验证 webhook 功能
   → 详见 .reins/knowledge/coupling-auth-webhook.md

2. [gotcha] Prisma 在 Edge Runtime 不兼容，需使用 @prisma/client/edge
   → 详见 .reins/knowledge/gotcha-prisma-edge.md
```

**预算**：每次注入最多 5 条，每条 2-3 行，总共不超过 15 行 / ~200 tokens。

agent 如果需要详情，自己 `Read .reins/knowledge/xxx.md`。这样既不浪费 context budget，又保证信息可达。

---

## 衰减机制：知识必须会死

不做衰减的知识系统最终被噪声淹没。三种机制叠加：

### 机制 1：文件变更触发的失效检测

```typescript
// knowledge/staleness-checker.ts

interface StalenessCheck {
  knowledgeId: string;
  relatedFiles: string[];
  createdAt: string;
  fileChanges: {
    file: string;
    lastModified: string;
    changeRatio: number;     // 0-1, 变更行数/总行数
  }[];
  stale: boolean;
  reason: string;
}

function checkStaleness(entry: KnowledgeEntry): StalenessCheck {
  for (const file of entry.related_files) {
    const stat = getFileStats(file);

    // 文件不存在了 → 知识可能过时
    if (!stat.exists) {
      return { stale: true, reason: `${file} 已被删除` };
    }

    // 文件在知识创建后有大幅变更 → 标记需要复查
    if (stat.lastModified > entry.created && stat.changeRatio > 0.3) {
      return { stale: true, reason: `${file} 变更超过 30%` };
    }
  }
  return { stale: false };
}
```

**触发时机**：`reins update` 运行时，或 session 开始时的轻量检查。

**处理**：不直接删除，而是降低 confidence 并在注入时加警告。

```
[Reins Knowledge] ⚠ 以下知识创建后相关文件已被修改，请验证后再采信：
1. [coupling] auth 与 webhook 的 session 耦合
   → lib/auth/session.ts 已于 2026-03-30 重构（变更 45%）
```

### 机制 2：注入效果的反馈循环

```typescript
// knowledge/feedback.ts

function recordInjectionOutcome(
  knowledgeId: string,
  taskOutcome: 'success' | 'failure',
  relevant: boolean    // 知识是否与失败相关
): void {
  const entry = loadKnowledgeEntry(knowledgeId);

  if (taskOutcome === 'success') {
    entry.confidence = Math.min(100, entry.confidence + 3);
    entry.injection_outcomes.success++;
  } else if (relevant) {
    // 注入了但任务失败，且失败与该知识相关 → 强惩罚
    entry.confidence = Math.max(0, entry.confidence - 15);
    entry.injection_outcomes.failure++;
  }
  // 注入了但任务失败，但失败与该知识无关 → 不惩罚

  entry.last_validated = new Date().toISOString();
  saveKnowledgeEntry(entry);
}
```

**不对称惩罚**：成功 +3，相关失败 -15。因为一次错误引导的破坏力远大于一次正确引导的价值。

### 机制 3：容量硬上限

```yaml
# .reins/config.yaml
knowledge:
  max_per_directory: 10     # 每个目录最多关联 10 条知识
  max_global: 100           # 全局最多 100 条知识
  eviction_strategy: "lowest_confidence"  # 超过上限时淘汰 confidence 最低的
  min_confidence: 20        # 低于此分自动归档
```

容量限制同时也是质量压力——新知识要进来，必须比最弱的已有知识更有价值。

### 衰减总结

```
知识条目
  ├── 引用的文件被大幅修改 → confidence -= 20, 标记 needs_review
  ├── 注入后任务成功 → confidence += 3
  ├── 注入后任务失败（相关）→ confidence -= 15
  ├── 超过 60 天未被检索命中 → confidence -= 10
  ├── confidence < 20 → 自动归档到 .reins/knowledge/archive/
  └── 被用户手动标记为错误 → 直接删除
```

---

## 知识毕业：隐式 → 显式

当一条知识被反复验证，它应该**毕业**为更正式的形态。

### 毕业路径

```
原始信号 (error / correction / reflection)
    ↓
知识条目 (implicit, confidence 50-70)
    ↓  被多次注入和验证
验证中的知识 (confidence 70-90)
    ↓  触发提升条件
候选约束 (confidence > 90, 注入次数 > 5, 成功率 > 80%)
    ↓  提示用户确认
正式约束 (写入 constraints.yaml)
    ↓  如果是规则性的
Hook 强制执行
```

### 提升条件

```typescript
// knowledge/promoter.ts

interface PromotionCandidate {
  knowledge: KnowledgeEntry;
  targetType: 'constraint' | 'skill' | 'l1_addition';
  reason: string;
}

function checkPromotion(entry: KnowledgeEntry): PromotionCandidate | null {
  // 条件 1: 高置信度
  if (entry.confidence < 90) return null;

  // 条件 2: 多次验证
  if (entry.injection_outcomes.success < 5) return null;

  // 条件 3: 高成功率
  const total = entry.injection_outcomes.success + entry.injection_outcomes.failure;
  if (entry.injection_outcomes.success / total < 0.8) return null;

  // 根据类型决定提升目标
  switch (entry.type) {
    case 'preference':
    case 'coupling':
      return {
        knowledge: entry,
        targetType: 'constraint',
        reason: `已验证 ${total} 次，成功率 ${(entry.injection_outcomes.success / total * 100).toFixed(0)}%`
      };

    case 'gotcha':
      return {
        knowledge: entry,
        targetType: 'skill',
        reason: `已帮助避免 ${entry.injection_outcomes.success} 次相同错误`
      };

    case 'decision':
      return {
        knowledge: entry,
        targetType: 'l1_addition',
        reason: `重要架构决策，应写入目录 AGENTS.md`
      };
  }
}
```

### 反向降级

约束如果持续被合理绕过，应该降级：

```
正式约束 (constraints.yaml)
  ├── 被 hook 拦截但用户多次 override → 记录
  ├── override 次数 > 5 且 override 后任务成功率 > 90%
  └── → 提示："约束 X 被频繁绕过且绕过后效果良好，降级为建议？"
```

---

## 跨 Session 一致性

每个 Claude Code session 独立运行。session A 写入的知识，session B 读取并注入。但 session B 的任务可能让之前的知识过时。

### 解决策略

**1. 注入时标注来源和时间**

```
[Reins Knowledge] (来自 3 天前的任务"重构 auth middleware")
1. [coupling] auth 与 webhook 共享 session store...
```

让 agent 自己判断时效性，利用 LLM 的推理能力处理一致性。

**2. 注入时检查文件新鲜度**

如果 knowledge 创建之后 `related_files` 被修改过，加显式警告：

```
[Reins Knowledge] ⚠ 此知识创建后 lib/auth/session.ts 已被修改，请验证后再采信。
```

**3. Session 结束时触发轻量一致性检查**

```
session 结束
  → 本次 session 修改了哪些文件
  → 这些文件关联了哪些知识条目
  → 对每条关联知识：降低 confidence，标记 needs_review
```

---

## 与其他模块的交互

### 与 ④ Context Generator 的关系

```
L0 (CLAUDE.md)       — 始终加载的全局地图
L1 (AGENTS.md)       — 目录级约束（可注入毕业的 decision 知识）
L2 (patterns/)       — 详细模式参考
Knowledge (knowledge/) — 经验性隐式知识（独立检索注入）
```

Knowledge 是 L0/L1/L2 之外的**第四层上下文**，但不是"始终加载"或"进入目录加载"，而是**按任务相关性动态注入**。

### 与 ⑤ Hook System 的关系

```
UserPromptSubmit hook → 检索并注入知识
Stop hook → 触发任务完成反思，提取新知识
PostToolUse hook → 记录约束违反（作为 gotcha 的信号源）
```

### 与 ⑧ Self-Improving 的关系

```
Self-Improving 的 Observer/Analyzer → 提供结构化执行数据
Knowledge System 的 Learner → 从数据中提取隐式知识
Knowledge System 的 Promoter → 将知识提升为约束（反馈到 ③）
```

Knowledge System 可以看作 Self-Improving 的**知识层**，Self-Improving 负责宏观闭环（日志 → 分析 → 改进），Knowledge System 负责微观知识的捕获和管理。

---

## 配置

```yaml
# .reins/config.yaml
knowledge:
  # 捕获配置
  capture:
    on_task_complete: true          # 任务完成后触发反思
    on_correction: true             # 用户纠正时触发提取
    on_retry: true                  # 失败重试后触发提取
    reflection_model: "haiku"       # 反思用的模型（控制成本）

  # 检索配置
  retrieval:
    max_inject: 5                   # 每次最多注入条数
    max_inject_tokens: 200          # 注入的 token 预算
    min_confidence: 40              # 低于此分不注入
    strategy: "file_affinity"       # file_affinity | tag_match | semantic

  # 衰减配置
  decay:
    stale_file_change_ratio: 0.3    # 文件变更超过此比例标记过期
    unused_decay_days: 60           # 超过 N 天未命中，confidence -= 10
    success_boost: 3                # 注入成功 confidence +N
    failure_penalty: 15             # 注入失败 confidence -N

  # 容量配置
  capacity:
    max_per_directory: 10
    max_global: 100
    min_confidence: 20              # 低于此分自动归档
    eviction: "lowest_confidence"

  # 毕业配置
  promotion:
    min_confidence: 90
    min_validations: 5
    min_success_rate: 0.8
    auto_suggest: true              # 达标时自动提示用户
```

所有配置可选，均有合理默认值。`capture.on_*` 设为 false 可关闭对应的捕获通道。

---

## 子模块 & 源码结构

```
src/knowledge/
├── reflector.ts              # Agent 反思 prompt 构建和结果解析
├── extractor.ts              # 从纠正/重试信号中提取知识
├── store.ts                  # 知识读写（index.yaml + markdown 文件）
├── retriever.ts              # 检索引擎（file-affinity + tag match）
├── injector.ts               # 注入格式化（生成 hook 输出的文本）
├── staleness.ts              # 过期检测
├── feedback.ts               # 注入效果反馈（confidence 更新）
├── promoter.ts               # 知识毕业（→ constraint / skill / L1）
├── archiver.ts               # 低质量知识归档
└── index.ts                  # 统一入口
```

---

## 文件结构（目标项目中）

```
.reins/
├── knowledge/
│   ├── index.yaml                    # 知识索引
│   ├── coupling-auth-webhook.md      # 耦合知识
│   ├── gotcha-prisma-edge.md         # 踩坑知识
│   ├── decision-redis-pubsub.md      # 决策知识
│   ├── preference-functional.md      # 偏好知识
│   └── archive/                      # 归档的过期知识
│       └── ...
```

**Git 策略**：
- `knowledge/index.yaml` + 所有 `.md` 文件 → **提交到 git**（团队共享经验）
- `knowledge/archive/` → **.gitignore**（个人归档）

与 constraints.yaml（团队共享）一致：知识是团队资产，应该版本控制。

---

## 依赖关系

```
⑤ Hook System ──→ ⑨ Knowledge System ──→ ③ Constraint Generator
  (触发捕获/注入)      (知识管理)           (毕业后的约束更新)
                          ↑
                   ⑥ Pipeline Runner
                     (执行数据)
                          ↑
                   ⑧ Self-Improving
                     (分析结果)
```

- **被依赖**：无直接被依赖（通过 hook 和文件间接影响所有模块）
- **依赖**：⑤ Hook System（捕获和注入的触发点）、① State（config 加载）
- **间接依赖**：⑥ Pipeline Runner（执行数据）、⑧ Self-Improving（分析结果）
- **外部依赖**：yaml（格式解析）、LLM（反思提取，可选用 haiku 控制成本）

---

## 实施优先级

| 阶段 | 内容 | 预计 |
|------|------|------|
| **Phase 3a** | 任务完成反思 + markdown 存储（零检索，仅沉淀） | 1-2 天 |
| **Phase 3b** | index.yaml + file-affinity 检索 + UserPromptSubmit 注入 | 3-5 天 |
| **Phase 4a** | 纠正捕获 + 失败重试捕获 | 3-5 天 |
| **Phase 4b** | 衰减机制 + 注入反馈循环 | 3-5 天 |
| **Phase 5** | 毕业机制（knowledge → constraint）+ 跨 session 一致性 | 1-2 周 |

Phase 3a 是最高 ROI 的——一天就能做出来，立刻开始沉淀知识。

---

## 设计原则

1. **Agent 自己提取** — 不建外部管道，利用 agent 的完整上下文和推理能力
2. **结构化引导** — 不让 agent 自由发挥，用明确的问题逼出高密度信息
3. **提取原则而非事实** — "错误处理哲学是 Result pattern" 而非 "用户说用 Result"
4. **路径锚定** — 知识绑定文件路径，检索靠路径匹配，简单且精准
5. **轻量注入** — 摘要 + 路径，不超过 200 tokens，agent 需要时自己深入读
6. **不对称惩罚** — 错误引导的代价远大于正确引导的价值，衰减要快
7. **知识会死** — 容量硬上限 + 时间衰减 + 文件变更失效，强制质量竞争
8. **毕业通道** — 隐式知识验证后可升级为显式约束，不是两个独立系统
