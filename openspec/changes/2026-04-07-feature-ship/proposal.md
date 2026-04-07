## Why

上一个 change（`refactor: ship slash commands at init, drop in-process LLM pipeline`，commit `4f986c9`）把 reins 的定位钉死在"**init 时落脚手架 + 运行时当 hook 后端**"。这是正确的方向，但它只解决了**每轮对话**的快速门禁（Stop hook 跑 `pipeline.pre_commit`）和**单个动作**的手动工作流（`/reins-setup` 等 slash command）。

真实的开发场景里还有一类需求没被覆盖——**批量 feature 的无人值守开发**：

> 我有 5 个 feature 要实现，都写在 markdown 里了。我想敲一个命令走开喝咖啡，回来的时候每个 feature 都已经实现、单元测试绿、点击测试过、没过的那个停在失败位置等我看。

当前架构下这件事**做不到**，具体 gap：

1. **没有 feature queue 的概念** —— `constraints.yaml` 是规则，不是工作项。没有地方存"还没做的 feature"这种状态。
2. **没有批量编排入口** —— slash command 是用户主动触发的单次动作，跑完回归对话窗口。想跑 5 个 feature 就得敲 5 次，而且每次上下文会互相污染。
3. **没有分层验证** —— `pipeline.pre_commit` 是秒级 lint/typecheck，测试进不去这个 slot（每轮跑测试会拖死体验）。也没有 feature 级别的 unit/integration 验证 slot，更没有 browser verify slot。
4. **没有失败反馈循环** —— 单元测试或 Playwright 失败后，没人把 stack trace 喂回 Claude Code 让它继续修。用户得自己复制错误、开对话、贴进去。
5. **没有 headless IDE 调用** —— 所有工作都假设用户坐在 IDE 前点 "continue"。无人值守模式不存在。

更深的问题：reins 目前是**被动**工具——用户先操作 IDE，reins 在边上检查。它需要再加一个**主动**模式：用户给一批活，reins 自己驱动 IDE 干完。

这个 change 引入 `reins ship` 命令和配套的 feature queue，把 reins 从"hook 后端"进化成"hook 后端 + 批量开发编排器"。**关键约束**：reins 仍然永远不在进程内调 LLM——所有 LLM 工作通过 `spawn('claude', ['-p', ...])` 走 headless Claude Code 子进程完成。reins 的新责任是**外层的循环**（feature 状态机、prompt 组装、失败反馈、下一个 feature），不是生成代码。

这条红线让它跟上一个 change 删掉的 `reins develop` 有本质区别：旧的 `develop` 试图在 CLI 里调 LLM 跟用户已有的 IDE 抢活儿；新的 `ship` 是 IDE 的**调度器**，不跟 IDE 抢角色。

## What Changes

### 1. Feature 文件格式（`.reins/features/<id>.md`）

每个 feature 是一个 markdown 文件，YAML frontmatter 存元数据 + 状态，body 描述 intent / acceptance / test strategy。见 design.md §1 的完整规范。

### 2. `reins feature` CLI 子命令家族（`src/commands/feature-cmd.ts`）

纯结构化操作，**不调 LLM**：

| 命令 | 作用 |
|---|---|
| `reins feature list` | 打印 queue（按 priority 排序，显示 status） |
| `reins feature show <id>` | 打印单个 feature 全文 + 当前状态 |
| `reins feature new <id>` | 落一个空骨架文件，status=draft |
| `reins feature status <id> [--json]` | 只打印 status 字段 |
| `reins feature set-status <id> <new>` | 原子更新 status（ship runner 用） |
| `reins feature next` | 返回下一个该处理的 feature id（depends_on 解析 + priority） |

### 3. `reins ship` CLI 子命令（`src/commands/ship-cmd.ts`）

批量编排入口。**先规划，再执行**：第一步让 AI 读所有 todo feature 输出一个执行 DAG（哪些 feature 可以并行、哪些必须串行），第二步按 DAG 驱动，每步 implement → verify → commit。

```
reins ship                          # 规划 + 执行所有 todo 状态的 feature
reins ship --only <id>[,<id>...]    # 只跑指定的 feature（仍然经过规划步骤）
reins ship --dry-run                # 规划并打印 DAG，不执行
reins ship --max-attempts N         # 覆盖每个 feature 的重试上限
reins ship --parallel N             # 并行上限（默认 3；传 1 则强制串行，绕过规划）
reins ship --no-commit              # 跳过 auto-commit（调试用，默认 commit）
```

### 4. `pipeline.feature_verify` 和 `pipeline.browser_verify` schema 扩展

`.reins/constraints.yaml` 的 `PipelineConfig` 接口扩两个新 slot：

```ts
export interface PipelineConfig {
  pre_commit: string[];            // 已有，秒级，每轮 Stop
  feature_verify?: string[];       // 新，分钟级，每个 feature 完成时
  browser_verify?: BrowserVerifyConfig; // 新，Playwright
}

export interface BrowserVerifyConfig {
  command: string;                 // e.g. "cd app/frontend && pnpm playwright test"
  spec_dir: string;                // e.g. "app/frontend/e2e/reins-generated/"
  dev_server?: {
    command: string;               // e.g. "cd app/frontend && pnpm dev"
    wait_for_url: string;          // e.g. "http://localhost:3000"
    timeout_ms: number;            // e.g. 60_000
  };
}
```

三层 verify 的语义分离见 design.md §5。

### 5. Headless Claude Code 子进程封装（`src/ship/claude-spawn.ts`）

`spawnClaudeHeadless(prompt, cwd, options): Promise<ClaudeRunResult>` — 包装 `spawn('claude', ['-p', prompt], {cwd, ...})`：
- 捕获 stdout/stderr/exit code
- 超时保护（默认 10 min per call）
- 取消信号传递（Ctrl+C 要能干掉子进程）
- 日志落盘到 `.reins/runs/<timestamp>/<feature-id>/attempt-N.log`

**v1 硬编码依赖 `claude` CLI 在 PATH 上**。v2 再考虑 provider 抽象（为了支持 cursor/codex/opencode）。

### 6. 规划阶段（`src/ship/planner.ts`）

Ship 开跑前的第一步，**不是**人写规则分类哪些能并行。规划是 spawn 一次 claude-headless，让它读所有 todo feature 的 body + 声明的 scope，输出一个 JSON 执行 DAG：

```json
{
  "steps": [
    {"mode": "serial", "features": ["001-db-migration"], "reason": "改数据库 schema，所有后续依赖"},
    {"mode": "parallel", "features": ["002-login-ui", "003-signup-ui"], "reason": "改不同 route，无共享组件"},
    {"mode": "serial", "features": ["004-e2e"], "reason": "依赖 login + signup 完成"}
  ],
  "parallelism": 2,
  "estimated_minutes": 45
}
```

Reins 解析 JSON 后按 steps 顺序执行：每个 `serial` step 里的 feature 依次跑；每个 `parallel` step 里的 feature 同时跑（通过 worktree 隔离），等整组完成再进下一 step。

**Planner 失败的 fallback**：如果 claude 返回的 JSON 解析不了或不合法，reins 降级到"全 serial 按 `depends_on` 字段 + priority 排序"——跟规划步骤不存在时等价。这保证规划阶段不是关键路径，只是优化。

### 7. Ship runner 状态机（`src/ship/runner.ts`）

核心循环，对每个 feature 执行：

```
draft → implement (spawn claude in worktree if parallel) 
      → status=implemented 
      → verify (pre_commit → feature_verify → browser_verify)
      → commit (git add -A && git commit) 
      → pass: status=done
      → verify fail or commit fail: spawn claude with failure context → retry
      → retries exhausted: status=blocked → next feature
```

完整状态转移见 design.md §6。

### 8. 失败反馈 prompt 组装（`src/ship/prompt-builder.ts`）

不同阶段组装不同的 prompt：

- **Planning prompt**：所有 todo feature 的 frontmatter + body 摘要 + 项目结构概要 + "输出一个 JSON DAG，格式见 schema"
- **Implement prompt**：feature body + constraints.yaml 约束摘要 + 相关已完成 feature 的链接
- **Retry prompt**：上次 implement prompt + 失败的 verify 命令 + stack trace（截断到 100 行）+ "fix the code, do not weaken the tests"
- **Browser spec gen prompt**（v2）：feature 的 "Browser test" 段 + 项目的 Playwright 配置检测 + "write a spec at <path>"
- **Dev server discovery prompt**（v2）：项目的 package.json / Makefile / README / docker-compose.yml + "find the dev server command and health check URL, output JSON"

### 9. Git worktree 隔离（`src/ship/worktree.ts`）

**v1 就支持**，因为规划阶段可能把多个 feature 分到同一个 parallel step，此时必须隔离。

- 每个并行 feature 分配一个 `.reins/wt/<feature-id>/` worktree，基于当前分支的 HEAD 创建
- 每个 worktree 有自己的 git HEAD，Claude Code 在这里独立工作，互不干扰
- feature 完成后在 worktree 里 `git add -A && git commit`（见 §10）
- 整个 parallel step 结束后，reins 把每个 worktree 的 commit **rebase** 回主分支（保持线性历史）
- 冲突 → **停下来报告**，不自作主张。涉及的 feature 全标 `blocked`，整个 ship 终止（不继续下一个 step，因为后续 feature 可能依赖这些未完成的）
- `--parallel 1` 或规划输出全 serial step 时，退化为"在当前分支直接跑"，不用 worktree

Worktree 的清理策略：
- ship 正常结束 → worktree 已 rebase 回去，删除
- ship 异常（Ctrl+C）→ 保留 worktree，打印路径让用户 `git worktree remove` 或手动审

### 10. 成功后自动 commit（`src/ship/commit.ts`）

Feature 的 `feature_verify` 通过后，ship runner 在 feature 所在的工作区（主分支或 worktree）执行：

```bash
git add -A
git commit -m "<commit message>"
```

commit message 规则：
- **检测项目的 commit convention**：读 `git log --oneline -20` 看最近 20 条 commit，如果 ≥ 80% 匹配 `type(scope): subject` 模式 → 用 conventional commits；否则用自由格式
- **默认格式**：`feat: <feature.title>\n\nReins-feature-id: <id>\nReins-run-id: <run-id>\nReins-attempts: <n>`
- **绝不加 `--no-verify`**。项目自己的 pre-commit hook 必须照跑（weaver 那类重 hook 也一样）
- Pre-commit hook 失败 = commit 失败 = **算作 verify 失败**，算进 attempts 预算，失败原因喂回下一次 retry prompt
- **不 push**：只 commit，push 由用户决定
- **不开 PR**：ship 结束后用户自己判断是否开 PR

`--no-commit` flag 用于 debug：仍然跑 verify，但不 commit，working tree 留脏——只用于定位问题，默认行为是 commit。

### 11. Browser verify 策略：Claude Code 生成 Playwright spec + 自动发现 dev server（v2）

不做 visual AI judge，不用 computer-use。走工程化路径：

1. Feature 文件的 "Browser test" 段是自然语言描述
2. Ship runner 在 implement 阶段之后、feature_verify 通过之后，检查 `pipeline.browser_verify.dev_server` 是否已配置
3. 没配置 → spawn claude with dev-server discovery prompt，让它分析项目、输出启动命令 + 健康检查 URL + 端口，reins 解析 JSON 后写回 `constraints.yaml`（一次发现，未来复用）
4. Reins 起 dev server 进程，轮询健康检查 URL 最多 60s
5. Dev server 就绪后，给 Claude Code 下第二个任务："在 `<spec_dir>/<feature-id>.spec.ts` 写一个 Playwright spec，测试 ↑ 这段描述"
6. Claude Code 看项目的 playwright.config.ts 推断 baseURL、fixtures、helpers，写出的 spec 跟项目风格一致
7. Reins 运行 `pipeline.browser_verify.command` 跑 spec
8. 失败 → 进入失败反馈循环（reins 分不清是 spec 错还是代码错，让 Claude Code 判断）
9. ship 结束或 worktree 清理时，kill 掉 dev server 进程

### 12. 新 slash commands

- `/reins-feature-new` — 在 IDE 里交互式起草一个 feature 文件（用 AskUserQuestion 问 intent/acceptance/test strategy）
- `/reins-ship-here` — 在当前 IDE session 里前台跑单个 feature，不 spawn headless——方便 debug 某个卡住的 feature

`/reins-ship-all` 故意**不做** —— ship 是 long-running，不适合在对话窗口里跑。用户应该开终端敲 `reins ship`。

## Capabilities

### New Capabilities
- `feature-queue`: `.reins/features/` 文件格式、状态机、CRUD
- `feature-cli`: `reins feature list/show/new/status/set-status/next`
- `ship-planner`: AI 分析 feature 生成并行/串行 DAG，失败则降级到 depends_on 排序
- `ship-runner`: `reins ship` 批量编排循环，按 DAG steps 执行
- `ship-claude-spawn`: headless Claude Code 子进程调用
- `ship-verify`: 三层 verify 的执行与错误捕获
- `ship-worktree-isolation`: git worktree 每并行 feature 隔离 + rebase-back 合并
- `ship-auto-commit`: feature_verify 通过后自动 commit，走项目 pre-commit hook
- `ship-commit-convention`: 读 `git log` 检测 conventional-commits 风格
- `ship-browser-verify`: Playwright spec 生成 + 运行（v2）
- `ship-dev-server-discovery`: AI 自动分析项目找 dev server 启动命令（v2）
- `ship-runs-log`: `.reins/runs/<timestamp>/` 运行记录与成本追踪
- `workflow-feature-new`: `/reins-feature-new` slash command
- `workflow-ship-here`: `/reins-ship-here` slash command

### Modified Capabilities
- `constraints-schema`: `pipeline` 字段扩展 `feature_verify` 和 `browser_verify`
- `init-command`: init 时创建空的 `.reins/features/` 目录
- `status-command`: `reins status` 增加 feature queue 摘要段

### Removed Capabilities
无。这是纯增加 change。上一个 change 已经清干净了 develop pipeline。

## Impact

- **Affected code**: `src/features/*` (new), `src/ship/*` (new), `src/commands/feature-cmd.ts` (new), `src/commands/ship-cmd.ts` (new), `src/workflows/feature-new.ts` (new), `src/workflows/ship-here.ts` (new), `src/constraints/schema.ts` (extend), `src/commands/init.ts` (add features dir), `src/commands/status.ts` (add feature queue section), `src/adapters/claude-md.ts` (register new slash commands), `src/cli.ts` (register feature + ship commands)
- **Affected systems**: CLI 表面扩大约 40%；hook 系统不变；constraints.yaml schema 向后兼容（新字段都 optional）
- **APIs/UX**: 新增 `reins feature` 和 `reins ship` 两个顶级 CLI 入口；2 个新 slash command；constraints.yaml 三个新字段
- **Phase**: post-P5 new direction — 不是 bug fix 也不是已有模块的完善，是一个新的能力轴
- **Dependencies**:
  - 刚落地的 workflows 架构（`src/workflows/`）—— slash command 扩展
  - gate 系统不变，只是新增 `pipeline.feature_verify` 和 `pipeline.browser_verify` 被 ship runner 读，**不**被 gate-stop 读
  - **外部依赖**：`claude` CLI 必须在 PATH 上且支持 `-p` 模式（v1 不做 provider 抽象）
  - **外部依赖（v2）**：项目里有可运行的 Playwright（`npx playwright test` 能跑）

## Design Principles

1. **CLI 永远不在进程内调 LLM**。所有 LLM 推理通过 `spawn('claude', ['-p', ...])`——包括规划阶段、实现阶段、dev server 发现、Playwright spec 生成、重试。reins 自己的代码只做文件/进程/git 管理。违反这条原则 = 回到被删掉的 `develop` 架构。
2. **Feature 文件是状态的单一来源**。不引入数据库、不引入 `.reins/state.json`、不引入 lock 文件。所有状态存在 feature 文件的 frontmatter 里，`reins feature set-status` 是原子更新入口。
3. **三层 verify 严格分层**。`pre_commit`（秒级，每轮 Stop）← `feature_verify`（分钟级，每 feature 一次）← `browser_verify`（十秒到分钟，每 feature 一次）。频率、超时、失败处理各不相同，不允许混用。
4. **Fail-stop-per-feature，但 ship 继续**。每个 feature 有 `max_attempts`（默认 3），超限标 `blocked`，ship **继续下一个 feature**（不因单个失败终止）。**但并行 step 内有 feature blocked → rebase-back 时冲突风险升高 → 该 step 的所有 feature 都视为待审，ship 暂停**。
5. **规划阶段是优化不是必须**。AI 规划失败（JSON 不合法、spawn 超时）→ 降级为"按 depends_on + priority 全 serial"。用户**不必为规划担责**——即使规划完全不工作，ship 仍能跑（只是慢）。
6. **Worktree 隔离跟随规划结果**。规划输出并行 step → 自动用 worktree；全 serial → 直接在当前分支跑。用户不需要手动选 `--parallel` 或 `--no-worktree`，规划决定。`--parallel N` 只控制**上限**，不强制并行。
7. **成功 = verify 通过 + commit 成功**。Auto-commit 默认开启，走项目自己的 pre-commit hook。Pre-commit 失败算 verify 失败，进入 retry 循环。**绝不 `--no-verify`**。**绝不 auto-push**，**绝不 auto-PR**。
8. **Ship 运行必须可中断**。Ctrl+C 能干净干掉所有在跑的 Claude Code 子进程、所有 worktree、所有 Playwright、所有 dev server，不留孤儿进程。中断后的 feature 状态保持 `in-progress`（不是 blocked），用户决定是否重跑。
9. **每次 ship 都有可审计的运行日志**。`.reins/runs/<iso-timestamp>/` 存所有子进程的 stdout/stderr、每次 attempt 的 prompt、失败 trace、cost（如果 Claude Code CLI 暴露了 token 计数）、规划 DAG JSON、rebase 日志。用户能回看"这次 ship 为什么在 feature 3 卡住了"和"规划为什么把这两个 feature 分到一组"。

## Risks / Trade-offs

- **[Headless Claude Code 行为未知]** `claude -p` 在非对话模式下能不能可靠地实现一个完整 feature 是关键未验证假设。Mitigate: v1 第一步做一个 spike（task 0.1），在真实项目上跑 3 个简单 feature 看成功率，达不到 ≥ 70% 就重新评估整个方向。
- **[规划 AI 可能不可靠]** `claude -p` 输出 JSON DAG 时可能不稳定——格式错、引用不存在的 id、把有冲突的 feature 分到同一个并行组。Mitigate: (1) JSON schema 严格校验，任何格式问题 → 降级到纯 serial；(2) 规划输出后 reins 做**后验**——检查每个并行组里 feature 的 `scope` globs 有无重叠，重叠就拆开变 serial；(3) spike 阶段（task 0.3）验证规划在 5-10 feature 规模下的 JSON 合法率。
- **[Worktree rebase 冲突难处理]** 并行 feature 各自 commit 后 rebase 回主分支时可能冲突（即使规划时检查过 scope，LLM 实际写的代码可能超出声明的 scope）。Mitigate: 冲突即停——涉及的所有 feature 标 `blocked`，整个 ship 暂停并报告，worktree 保留供用户手动介入。不做自动冲突解决。
- **[Auto-commit 触发项目的重 pre-commit hook]** 比如 weaver 的 `scripts/hooks/claude-pre-commit.sh` 会跑整个测试套件。每次 feature 都走一遍这个 hook 可能很慢。Mitigate: (1) 这是**正确**的行为——pre-commit hook 是项目的"真实验证门"，ship 必须尊重；(2) 文档明确告诉用户"ship 会跑项目 pre-commit hook 每个 feature 一次，预算时间时考虑进去"；(3) `feature_verify` 如果跟 pre-commit hook 高度重叠可以留空——让 pre-commit 做唯一权威来源。
- **[Commit message 约定检测不准]** `git log` 启发式可能对 80/20 规则误判。Mitigate: 只在检测成功率 ≥ 80% 时用 conventional，否则用自由格式。用户可在 `.reins/config.yaml` 的 `ship.commit_style` 覆盖（enum: `conventional | free | custom`）。
- **[成本 / 时间不透明]** 一次 `reins ship` 可能消耗几十个 Claude Code 会话（规划 1 次 + implement N 次 + retry 若干次 + 可能的 browser spec gen + dev server 发现），用户一觉醒来发现账单爆炸。Mitigate: 每 attempt 后 log token 消耗；ship 开头先打印"计划 N 次 attempts，最多消耗 ~M 分钟"让用户 Ctrl+C 取消；每 feature 完成后打印累计成本。
- **[Playwright 生成的 spec 有 flake]** LLM 写的 e2e 经常用错 selector、时序有 race。Mitigate: v2 的 browser verify 失败时把 trace 喂回 Claude Code 让它修 spec 或修代码，同样受 `max_attempts` 保护。
- **[Dev server 发现可能失败]** AI 分析项目找不到 dev server 启动命令（比如自定义 docker-compose flow）。Mitigate: 发现失败 → 降级为 skip browser verify 并记录 `blocked: browser-verify-unconfigured`，让用户手动在 `constraints.yaml` 配置后重跑。不因 dev server 问题把整个 ship 搞死。
- **[用户在 ship 跑的时候修改了 .reins/features/]** 文件被改可能导致状态不一致。Mitigate: ship 启动时记录 feature 文件的 mtime 快照；中途发现变化 → 打 warning 但不 abort（只有当前正在处理的那个 feature 文件变了才 abort 当前 feature）。
- **[`claude -p` 可能修改不属于 feature 范围的文件]** headless 模式下 Claude Code 无人监督。Mitigate: ship runner 在每次 attempt 前后做 `git status --porcelain` 快照，对比改动的文件集，超出 feature 声明的 `scope` 字段时打 warning（**并行 step 的情况下是 block**，因为会污染其他 worktree 的 rebase 逻辑）。
- **[feature 声明的"done"不可靠]** 测试绿 ≠ 功能对。Mitigate: 承认这个问题无法完全解决；强烈建议每个 feature 都有 browser_verify 或 acceptance checklist 之一；ship 结束后打印醒目提示"已 auto-commit N 个 feature，请 review 后再 push"。
- **[跟 reins 现有 gate-stop 的潜在冲突]** ship 跑的时候 Claude Code headless 子进程也会触发 hook。Mitigate: headless 模式下 gate-stop 仍然跑 `pipeline.pre_commit`（这是好事，秒级反馈），但 ship 的 `feature_verify` 层**不**由 gate 触发，只由 ship runner 触发——两套不会重叠。
- **[并行 step 内部分失败处理]** 并行 3 个 feature，2 个成功 1 个 blocked。Mitigate: 成功的 2 个 rebase 回主分支（各自 commit 保留），失败的 1 个保留在 worktree 里等用户审；ship 暂停在这个 step 末尾，不进入下一个 step（因为后续 step 可能依赖失败的那个）。
