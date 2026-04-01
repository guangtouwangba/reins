# Reins 安装与初始化分发方案

## 目标

把 Reins 收敛成一个用户几乎不用学习内部模块、只需要记住两步就能开始使用的产品：

```bash
npx reins init
```

或者：

```bash
npm install -g reins
reins init
```

也就是说，Reins 的第一价值不应该先落在“完整自动开发 runtime”，而应该先落在：

- 一键安装
- 一键初始化
- 为多种 IDE / CLI agent 生成可直接使用的上下文与规则文件

---

## 一句话定位

Reins 应定位为：

**AI coding agent bootstrapper + constraint governance CLI**

对用户来说，它不是一套复杂系统，而是一个简单工具：

1. 安装 `reins`
2. 在项目根目录运行 `reins init`
3. 自动生成适配 Claude Code、Cursor、Copilot、Windsurf、OpenCode、CodeX 等环境的初始化文档与规则文件

---

## 为什么要同时支持两种安装方式

## 1. `npx reins init`

这是最好的首次体验。

优点：

- 零安装成本
- 适合第一次试用
- 适合临时项目或快速验证
- 用户不需要关心全局环境管理

适用场景：

- 新用户第一次尝试 Reins
- 在 CI、临时容器、干净开发机里快速初始化
- 团队文档里给出最短上手命令

推荐文案：

```bash
npx reins init
```

## 2. `npm install -g reins`

这是最好的长期体验。

优点：

- 后续命令更短
- 适合长期使用 `update` / `test` / `rollback`
- 适合重度用户和团队内部推广

适用场景：

- 团队成员长期维护多个项目
- 希望把 Reins 当作日常 CLI 工具使用
- 需要更稳定的本地命令入口

推荐文案：

```bash
npm install -g reins
reins init
```

## 推荐结论

两个入口都应该支持，但对外展示顺序应该是：

1. 首页主推 `npx reins init`
2. 紧接着给出“长期使用可全局安装”

因为对于大多数新用户来说，**第一次成功跑起来** 比 “安装姿势是否最标准” 更重要。

---

## 当前项目为什么适合走这条路

从当前代码结构看，Reins 已经具备了这条产品路线的基础：

- CLI 入口已经存在：`package.json -> bin.reins = dist/cli.js`
- `reins init` 主链路已经存在：扫描、生成约束、生成上下文、运行 adapter
- 已有多种 adapter 输出：
  - `CLAUDE.md`
  - `AGENTS.md`
  - `.cursorrules`
  - `copilot-instructions.md`
  - `.windsurfrules`

这意味着产品最成熟的部分，不是 `develop`，而是：

**install -> init -> generate environment-specific agent files**

也就是说，当前最现实的产品切入点不是“全自动开发”，而是“给现有 agent 生态装上项目约束层”。

---

## 核心产品流

用户视角下，理想主链路应该非常简单：

```text
Install reins
  ↓
Run reins init in project root
  ↓
Reins scans the project
  ↓
Reins generates constraints and adapter outputs
  ↓
User opens the project in Claude Code / Cursor / Copilot / Windsurf / OpenCode / CodeX
  ↓
The agent now starts with project-specific guidance instead of a blank slate
```

这条链路强调的是：

- 用户不需要先理解 Reins 的内部模块
- 用户不需要先配置复杂流水线
- 用户只需要知道它可以“给 agent 装上项目记忆和约束”

---

## `init` 应该成为产品中心

当前 `init` 更像一个技术命令；未来它应该成为产品的中心交互。

建议把 `reins init` 设计成：

### 1. 环境探测

初始化时检测当前项目更可能运行在哪些环境中：

- Claude Code
- Cursor
- GitHub Copilot
- Windsurf
- OpenCode
- CodeX

探测依据可以包括：

- 已存在的配置文件
- 工作区目录结构
- 用户显式选择

### 2. 生成目标可选

不要强制总是输出固定一整套文件。更好的交互是：

- 默认生成推荐组合
- 同时允许用户指定目标环境

例如：

```bash
reins init --targets claude,cursor,copilot
```

或者交互式选择：

```text
Detected likely environments:
  ✓ Claude Code
  ✓ Cursor
  ? Copilot

Generate files for which targets?
```

### 3. 输出摘要更产品化

初始化完成后，不只告诉用户“生成了哪些文件”，还要告诉用户“接下来怎么用”：

```text
Reins initialized successfully.

Generated:
- CLAUDE.md for Claude Code
- .cursorrules for Cursor
- .github/copilot-instructions.md for Copilot

Next steps:
1. Open this project in your IDE / agent
2. Start a task normally
3. Run `reins update` after major project changes
```

---

## 多环境适配策略

当前已有 adapter 已经覆盖了一部分主流环境。下一阶段应该把 adapter 能力进一步产品化。

建议分三层：

### 第一层：已成熟环境

- Claude Code
- Cursor
- GitHub Copilot
- Windsurf

这些应该作为默认支持目标。

### 第二层：新增 adapter 目标

- OpenCode
- CodeX
- 通用 `RULES.md` / `SYSTEM_PROMPT.md`

这些目标的意义在于：

- 覆盖更多 agent 容器或本地 CLI
- 降低不同生态之间的接入成本
- 把 Reins 从“特定工具适配器”升级为“agent 初始化层”

### 第三层：通用兜底输出

即使某个 IDE / agent 没有专属 adapter，Reins 也应提供通用输出，例如：

- `CLAUDE.md`
- `AGENTS.md`
- `.reins/constraints.yaml`
- `docs/agent-onboarding.md`

这样用户始终可以把 Reins 当作一个通用的 AI 协作文档生成器来使用。

---

## 发布与分发要求

如果要把产品真正做成“装完即用”，需要补强分发侧，而不仅仅是文档。

### 必须满足的条件

1. `npm publish` 后安装包可以直接运行
2. 发布包中必须包含 `dist/cli.js`
3. 发布包不能依赖仓库内的开发态命令才能启动
4. `npx reins init` 必须可直接执行

### 推荐做法

- 在发布流程中固定执行 build
- 确保 `files` / `bin` / `exports` 配置正确
- 提供最小 smoke test：

```bash
npx reins --version
npx reins init --dry-run
```

---

## 产品优先级建议

当前最值得优先投入的方向，不是先把 `develop` 做成完整 runtime，而是先把“可安装、可初始化、可多环境输出”做扎实。

推荐顺序：

1. 稳定 `install + init` 分发体验
2. 做强 adapter 体系和目标环境选择
3. 打磨 `update / test / rollback` 的可信度
4. 最后再把 `develop` 接成真正的任务编排 runtime

原因很简单：

- `init` 是当前最成熟的主链路
- 多环境文档输出已经是现成资产
- 用户最容易感知的价值也是“一键给项目装上 AI 规则层”

---

## 面向用户的推荐文案

首页最简表达建议写成：

```text
Reins gives your AI coding tools project-specific constraints and context.

Start in one command:
  npx reins init

Or install globally:
  npm install -g reins
  reins init
```

再往下解释：

- it scans your project
- generates rules and context files
- supports multiple IDEs and coding agents
- helps Claude Code, Cursor, Copilot, Windsurf, OpenCode, and CodeX start with real project knowledge

---

## 最终结论

这个项目完全可以做成：

- 用户一键安装
- 运行 `init`
- 在本地生成适用于多个 IDE / CLI agent 的初始化文档和规则文件

而且从当前代码成熟度看，**这应该成为接下来最优先强化的产品方向之一。**

因为它顺着现有架构生长，最容易尽快变成真实、可交付、可传播的用户价值。
