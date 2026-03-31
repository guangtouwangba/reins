# 实施路径（v2 — 整合架构师 Review）

## 三条可选路径

| 路径 | 速度 | 复用性 | 复杂度 | 推荐度 |
|------|------|--------|--------|--------|
| **A: Claude Code Skill** (`/reins init`) | 1-2 天 MVP | 仅 Claude Code | 低 | 快速验证 |
| **B: OMC Plugin 扩展** | 1-2 周 | OMC 用户 | 中 | 复用基础设施 |
| **C: 独立 npm CLI** (`npx reins init`) | 3-4 周 | 所有 AI 工具 | 高 | 最大影响力 |

**推荐策略**：先走路径 A 验证核心逻辑，再提取为路径 C 扩大受众。

## 路径 A：Claude Code Skill（最快验证）

```markdown
# /harness-init skill

## 执行步骤

1. 使用 Explore agent 扫描项目目录结构
2. 读取 package.json / go.mod / Cargo.toml 等配置文件
3. 采样读取 5-10 个核心源文件，理解编码风格
4. 读取 CI/CD 配置，理解已有的质量门禁
5. 读取已有的 lint/format 配置
6. 综合以上信息，生成：
   - .harness/context.json（探索结果）
   - .harness/harness.yaml（约束配置）
   - CLAUDE.md（如果不存在）
   - 各目录的 AGENTS.md（如果不存在）
7. 输出报告，让用户审查约束是否合理
```

预期效果：
```bash
cd /path/to/any/project
claude
> /harness-init

# 自动输出：
# ✓ 检测到：TypeScript + Next.js + Jest + pnpm
# ✓ 架构模式：App Router, Service Layer
# ✓ 已生成 CLAUDE.md (42 条约束)
# ✓ 已生成 src/AGENTS.md, lib/AGENTS.md (per-directory 约束)
# ✓ 已生成 .harness/harness.yaml
#
# 现在可以运行 "autopilot <任务>" 在约束下自动开发
```

## 路径 C：独立 npm CLI（完整版本）

### Phase 1 (1-2周): MVP — `dev-harness init`

```
Week 1: Scanner 模块
  - 复用 OMC deepinit-manifest 的 scanDirectories() 逻辑
  - 添加技术栈检测（package.json/go.mod/Cargo.toml 解析）
  - 输出 manifest.json + patterns.json

Week 2: Generator 模块 + Adapter 层
  - 设计 constraints.yaml 中间格式
  - 实现 CLAUDE.md adapter（模板 + LLM 增强）
  - 实现 .cursorrules adapter
  - 实现 AGENTS.md adapter
  - CLI 框架（Commander.js / oclif）
  - npx 零安装体验
  - 3-5 个技术栈模板（TypeScript/Python/Go/Rust/Java）
```

### Phase 2 (2-4周): 自动执行集成

```
- constraints.yaml → OMC autopilot 配置桥接
- 约束注入到 autopilot pipeline prompts
- "dev-harness develop <task>" 命令
- 增量更新（manifest diffing，复用 computeDiff 模式）
```

### Phase 3 (4-6周): 生命周期完善 [v2 新增优先级提升]

```
- reins.config.yaml 元配置系统
- 约束 Profile 机制（strict/default/relaxed）
- Re-init 合并策略（--merge/--force/--diff）
- /reins test — 约束和 Hook 健康测试
- /reins rollback — 约束变更回滚
- --dry-run 支持所有命令
- 约束文件保护 Hook（防止 agent 修改）
```

### Phase 4 (6-8周): 事件驱动 + 协作

```
- 事件驱动的 update 触发（SessionEnd / git post-merge）
- Hook 健康监控 + 自动禁用
- 多用户协作模型（共享 vs 个人文件分离）
- /reins status 趋势分析和告警
- 约束冲突检测
- 约束过期检测（引用了不存在的路径）
```

### Phase 5 (8-12周): 智能化

```
- L3-L5 深度探索（AST 分析、LLM 理解）
- 自进化闭环（OBSERVE → ANALYZE → LEARN → CONSTRAIN）
- 跨项目约束学习（全局 skill 库 + 项目指纹匹配）
- 更多技术栈模板
- 在 5-10 个真实项目上测试迭代
- Monorepo 支持（per-package constraints）
- 约束版本迁移机制
```

## MVP 核心逻辑（伪代码，v2）

```typescript
// reins init
async function init(projectRoot: string, options: InitOptions) {
  const config = loadConfig(projectRoot);  // .reins/config.yaml 或默认值

  // Phase 0: 检测已有配置 [v2]
  const existing = detectExistingReins(projectRoot);
  if (existing && !options.force) {
    // --merge 模式：加载已有约束，稍后合并
    const prevConstraints = loadConstraints(projectRoot);
    const prevManifest = loadManifest(projectRoot);
  }

  // Phase 1: Scan (深度由 config.scan.depth 控制)
  const scanDepth = options.depth || config.scan.depth || 'L0-L2';
  const manifest = scanDirectories(projectRoot, config.scan.exclude_dirs);
  const stack = detectStack(projectRoot);
  const patterns = analyzePatterns(projectRoot);
  const existingRules = detectExistingRules(projectRoot);
  const testing = detectTestingSetup(projectRoot);

  // Phase 2: Generate constraints + 分级 [v2]
  const constraints = generateConstraints({
    manifest, stack, patterns, existingRules, testing
  });

  // 按 severity 分级 → 决定放在 L0/L1/L2
  classifyConstraints(constraints); // critical → L0, important → L1, helpful → L2

  // Phase 2.5: 合并策略 [v2]
  if (existing && !options.force) {
    const merged = mergeConstraints(prevConstraints, constraints);
    // merged.kept — 用户确认过的，保留
    // merged.added — 新检测到的，标记为 draft
    // merged.deprecated — 不再适用的，标记废弃
    // merged.conflicts — 需要用户决定
    await presentMergeResult(merged);  // 交互式确认
  }

  // Phase 3: 生成分层产出物 [v2 渐进式上下文]
  generateL0(projectRoot, constraints);  // CLAUDE.md (< 50行)
  generateL1(projectRoot, constraints);  // 各目录 AGENTS.md (< 30行/个)
  generateL2(projectRoot, constraints);  // .reins/patterns/*.md

  // Phase 4: 生成 Hook [v2]
  const hookableConstraints = constraints.filter(c => c.enforcement.hook);
  generateHookScripts(projectRoot, hookableConstraints);
  generateSettingsJson(projectRoot, hookableConstraints);
  generateConstraintProtectionHook(projectRoot);  // 保护约束文件

  // Phase 5: 生成 Profile [v2]
  generateProfiles(projectRoot, constraints);

  // Phase 6: 保存状态 + 快照（支持 rollback）[v2]
  saveManifest(projectRoot, manifest);
  saveSnapshot(projectRoot);  // 用于 /reins rollback

  // Phase 7: 报告
  printReport(constraints, hookableConstraints);
}
```

## 推荐的项目文件结构（独立 CLI，v2）

```
reins/
├── package.json
├── tsconfig.json
├── src/
│   ├── cli.ts                        # CLI 入口 (Commander.js)
│   │
│   ├── scanner/                      # Phase 1: 探索
│   │   ├── directory-scanner.ts      # 目录结构扫描
│   │   ├── stack-detector.ts         # 技术栈检测
│   │   ├── pattern-analyzer.ts       # 架构模式分析
│   │   ├── rule-detector.ts          # 已有 lint/format 规则检测
│   │   └── test-detector.ts          # 测试框架检测
│   │
│   ├── constraints/                  # Phase 2: 约束
│   │   ├── generator.ts              # 约束生成
│   │   ├── classifier.ts             # [v2] 约束分级 (critical/important/helpful)
│   │   ├── merger.ts                 # [v2] 合并策略 (merge/force/diff)
│   │   ├── conflict-detector.ts      # [v2] 约束冲突检测
│   │   ├── profiles.ts               # [v2] Profile 生成 (strict/default/relaxed)
│   │   ├── schema.ts                 # constraints.yaml 类型定义
│   │   └── templates/
│   │       ├── typescript.yaml
│   │       ├── python.yaml
│   │       ├── go.yaml
│   │       ├── rust.yaml
│   │       └── java.yaml
│   │
│   ├── context/                      # [v2] Phase 3: 渐进式上下文
│   │   ├── l0-generator.ts           # CLAUDE.md (< 50 行)
│   │   ├── l1-generator.ts           # 目录 AGENTS.md (< 30 行/个)
│   │   └── l2-generator.ts           # .reins/patterns/*.md
│   │
│   ├── hooks/                        # [v2] Phase 4: Hook 系统
│   │   ├── generator.ts              # 从约束生成 hook 脚本
│   │   ├── settings-writer.ts        # 生成 .claude/settings.json
│   │   ├── health-monitor.ts         # [v2] Hook 健康监控
│   │   ├── protection.ts             # [v2] 约束文件保护 hook
│   │   └── templates/                # Hook 脚本模板
│   │       ├── post-edit-check.sh.tmpl
│   │       ├── bash-guard.sh.tmpl
│   │       ├── pre-complete.sh.tmpl
│   │       └── context-inject.sh.tmpl
│   │
│   ├── adapters/                     # 多格式输出
│   │   ├── base-adapter.ts
│   │   ├── claude-md.ts
│   │   ├── agents-md.ts
│   │   ├── cursor-rules.ts
│   │   ├── copilot-instructions.ts
│   │   └── windsurf-rules.ts
│   │
│   ├── state/                        # 状态管理
│   │   ├── manifest.ts               # 增量扫描
│   │   ├── diff.ts                   # 变更检测
│   │   ├── snapshot.ts               # [v2] 快照 (支持 rollback)
│   │   └── config.ts                 # [v2] config.yaml 加载
│   │
│   ├── lifecycle/                    # [v2] 生命周期管理
│   │   ├── staleness-checker.ts      # 过期检测
│   │   ├── event-triggers.ts         # 事件驱动触发
│   │   ├── test-runner.ts            # /reins test
│   │   └── rollback.ts              # /reins rollback
│   │
│   ├── learn/                        # 学习系统
│   │   ├── detector.ts               # 可提取时刻检测
│   │   ├── scorer.ts                 # 质量评分
│   │   └── writer.ts                 # Skill 写入
│   │
│   └── pipeline/                     # 自动执行
│       ├── runner.ts
│       ├── constraint-injector.ts    # [v2] 按 profile 注入约束
│       └── omc-bridge.ts
│
├── templates/
│   ├── claude-md/                    # L0 模板
│   │   ├── header.md
│   │   ├── stack-typescript.md
│   │   └── stack-python.md
│   ├── agents-md/                    # L1 模板
│   │   ├── root.md
│   │   └── directory.md
│   └── patterns/                     # L2 模板
│       ├── api-patterns.md
│       ├── service-patterns.md
│       └── testing-patterns.md
│
└── test/
    ├── fixtures/
    │   ├── nextjs-app/
    │   ├── python-fastapi/
    │   ├── go-service/
    │   └── existing-reins/           # [v2] 已有 .reins/ 的项目（测试合并）
    └── ...
```

## 目标项目中生成的文件结构（v2）

```
项目根目录/
├── CLAUDE.md                        # L0: 地图 + 关键命令 + 3-5 条核心约束 (< 50行)
│
├── app/
│   ├── AGENTS.md                    # L1: app 目录的角色和约束
│   └── api/
│       └── AGENTS.md                # L1: API 目录的约束
├── lib/
│   ├── AGENTS.md                    # L1: lib 目录的约束
│   └── services/
│       └── AGENTS.md                # L1: services 目录的约束
│
├── .claude/
│   └── settings.json                # Reins 生成的 Hook 配置
│
└── .reins/                          # Reins 工作目录
    ├── constraints.yaml             # 约束定义（团队共享，agent 只读）
    ├── config.yaml                  # [v2] Reins 元配置（团队共享）
    ├── config.local.yaml            # [v2] 个人覆盖（.gitignore）
    ├── README.md                    # 使用说明
    │
    ├── hooks/                       # Hook 脚本（团队共享）
    │   ├── post-edit-check.sh
    │   ├── bash-guard.sh
    │   ├── pre-complete-check.sh
    │   ├── context-inject.sh
    │   ├── protect-constraints.sh   # [v2] 约束保护
    │   └── custom/                  # 用户自定义
    │
    ├── patterns/                    # L2 模式参考（团队共享）
    │   ├── api-patterns.md
    │   ├── service-patterns.md
    │   └── testing-patterns.md
    │
    ├── profiles/                    # [v2] 约束 Profile（团队共享）
    │   ├── strict.yaml
    │   ├── default.yaml
    │   └── relaxed.yaml
    │
    ├── snapshots/                   # [v2] 变更快照（.gitignore）
    │   ├── 2026-03-28T16:00:00.json
    │   └── 2026-03-31T14:00:00.json
    │
    ├── skills/                      # 学到的知识
    │   ├── team/                    # 团队共享 skill（提交到 git）
    │   └── auto/                    # 自动学习的 draft skill（.gitignore）
    │
    ├── manifest.json                # 目录快照（.gitignore）
    ├── context.json                 # 探索缓存（.gitignore）
    └── logs/                        # 执行日志（.gitignore）
        ├── executions/
        └── hook-health.yaml         # [v2] Hook 健康数据
```
