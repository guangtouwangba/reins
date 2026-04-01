## 1. Types and config

- [ ] 1.1 Define skill types in `src/scanner/skill-types.ts`: `SkillEntry`, `SkillTrigger`, `SkillIndex`, `SkillSource`, `ScoredSkill`. Export all types.
  - Files: `src/scanner/skill-types.ts`
  - Tests: `pnpm typecheck` passes; types importable from other modules.
  - Done when: All interfaces defined; no circular dependencies

- [ ] 1.2 Add `skills` section to `ReinsConfig` in `src/state/config.ts`: `skills: { enabled: boolean, sources: string[], inject: { max_tokens: number, max_skills: number }, auto_index: boolean }`. Update `getDefaultConfig()` with sensible defaults (`enabled: true`, `sources: []`, `max_tokens: 4000`, `max_skills: 5`, `auto_index: true`).
  - Files: `src/state/config.ts`
  - Tests: Unit test that `getDefaultConfig().skills.enabled` is true and `max_tokens` is 4000.
  - Done when: Config type extended; defaults set; `pnpm typecheck` passes

## 2. Skill scanner

- [ ] 2.1 Create `src/scanner/skill-scanner.ts`. Export `discoverSkills(projectRoot, config): SkillSource[]`. Scan these directories in order: `.claude/commands/`, `.claude/skills/`, `.reins/skills/`, each path in `config.skills.sources`, `~/.claude/commands/`, `~/.claude/skills/`. For each directory that exists, list all `.md` files. Return `SkillSource[]` where each entry has `{ path, sourceType, priority }`. SourceType: files from `.claude/*` in project → `'project'`, from `.reins/skills/` → `'team'`, from config sources → `'team'`, from home `~/.claude/*` → `'user'`.
  - Files: `src/scanner/skill-scanner.ts`
  - Tests: Unit test with fixture directories containing `.md` files → assert correct count and sourceType. Unit test with missing directories → assert empty result, no error. Unit test priority ordering: project files have priority 1, team have 2, configured have 3, user global have 4.
  - Done when: All source directories scanned in order; missing dirs handled gracefully; priority assigned correctly

- [ ] 2.2 Add `extractSkillMetadata(filePath, sourceType, priority): SkillEntry` to `skill-scanner.ts`. Read the file, parse optional YAML frontmatter (content between `---` markers at file start), extract `triggers` field. Extract title from first `# Heading` line (fallback to filename). Compute `id` from filename stem (lowercase, hyphens). Compute `contentHash` as sha256 of file content. Estimate tokens as `Math.ceil(content.length / 4)`.
  - Files: `src/scanner/skill-scanner.ts`
  - Tests: Unit test with frontmatter having `triggers.keywords: [test]` → assert keywords extracted. Unit test without frontmatter → assert triggers inferred from filename. Unit test that title is extracted from `# Heading`. Unit test that contentHash is deterministic.
  - Done when: Frontmatter parsing works; fallback inference works; all SkillEntry fields populated

- [ ] 2.3 Add `inferTriggers(filename, content): SkillTrigger` to `skill-scanner.ts`. Infer keywords from: (a) filename segments split by `-` and `_`, (b) known tool vocabulary found in content (playwright, cypress, jest, vitest, prisma, docker, kubernetes, react, vue, angular, nextjs, express, fastapi, gin, etc. — a hardcoded list of ~40 common tools/frameworks). Infer file patterns from content (lines matching `*.spec.ts`, `tests/**`, etc. inside code blocks or backticks). Cap at 10 keywords and 5 file patterns.
  - Files: `src/scanner/skill-scanner.ts`
  - Tests: Unit test with filename `e2e-testing.md` → assert keywords contain `["e2e", "testing"]`. Unit test with content mentioning "Playwright" → assert keywords contain `"playwright"`. Unit test with content containing `` `tests/**/*.spec.ts` `` → assert files trigger extracted. Unit test caps keywords at 10.
  - Done when: Filename + content inference produces useful triggers; vocabulary covers common tools

## 3. Skill indexer

- [ ] 3.1 Create `src/scanner/skill-indexer.ts`. Export `buildSkillIndex(projectRoot, config): SkillIndex`. Call `discoverSkills()` to get source files, call `extractSkillMetadata()` for each, deduplicate by `id` (highest priority wins), return `SkillIndex` with version and timestamp.
  - Files: `src/scanner/skill-indexer.ts`
  - Tests: Unit test with 3 skills from different sources → assert all indexed. Unit test with same filename in project and user dirs → assert project version wins. Unit test with no skills → assert empty index.
  - Done when: Index built correctly with deduplication; priority-based override works

- [ ] 3.2 Export `saveSkillIndex(projectRoot, index)` and `loadSkillIndex(projectRoot): SkillIndex | null`. Write to `.reins/skill-index.json`. Load returns null if file doesn't exist.
  - Files: `src/scanner/skill-indexer.ts`
  - Tests: Unit test save + load round-trip. Unit test load from missing file returns null.
  - Done when: Index persists to disk and loads back correctly

- [ ] 3.3 Integrate skill indexing into `reins init`. In `src/commands/init.ts`, after constraint generation and before adapter execution, call `buildSkillIndex()` and `saveSkillIndex()` if `config.skills.enabled`. Print skill count in the summary output.
  - Files: `src/commands/init.ts`
  - Tests: Unit test that init with `skills.enabled: true` writes `skill-index.json`. Unit test that init with `skills.enabled: false` skips indexing.
  - Done when: `reins init` indexes skills; count shown in output

## 4. Skill matcher

- [ ] 4.1 Create `src/pipeline/skill-matcher.ts`. Export `matchSkills(task, context, index, config): ScoredSkill[]`. Score each skill using weighted keyword matching: keyword in task → +10 points, file pattern match → +5, command match → +3. Filter to score > 0. Sort by score descending, break ties by priority ascending. Return top `config.skills.inject.max_skills` results. Each `ScoredSkill` has `{ entry: SkillEntry, score: number, content: string }` (content loaded from `entry.sourcePath`).
  - Files: `src/pipeline/skill-matcher.ts`
  - Tests: Unit test with task "add e2e tests" and skill with keywords `["e2e", "test"]` → assert score 20 (two keyword matches). Unit test with task "fix login bug" and skill with keywords `["deploy"]` → assert score 0, not returned. Unit test that max_skills limit is respected. Unit test that higher priority wins ties.
  - Done when: Scoring correct; ranking works; budget respected; content loaded

- [ ] 4.2 Add token budget enforcement to `matchSkills`. After scoring and sorting, iterate results and accumulate token estimates. Stop when adding the next skill would exceed `config.skills.inject.max_tokens`. If a skill is too large, try the next one.
  - Files: `src/pipeline/skill-matcher.ts`
  - Tests: Unit test with budget 100 tokens and two skills (80 and 60 tokens) → assert only first included. Unit test that a large first skill is skipped and a smaller second skill is included if it fits.
  - Done when: Token budget enforced; large skills don't block smaller ones

## 5. Skill injection into pipeline

- [ ] 5.1 Modify `src/pipeline/constraint-injector.ts` to accept an optional `skills: ScoredSkill[]` parameter in `injectConstraints()`. When skills are present, add an `## Active Skills (auto-loaded)` section between `## Task` and `## Active Constraints`. Each skill rendered as `### {title}\nSource: {sourcePath}\n{content}`.
  - Files: `src/pipeline/constraint-injector.ts`
  - Tests: Unit test with 2 skills → assert output contains both skill titles and content. Unit test with 0 skills → assert no Skills section in output. Unit test that skills section appears before constraints section.
  - Done when: Skills injected in correct position; format matches design

- [ ] 5.2 Wire skill matching into `src/pipeline/runner.ts`. Before the HARNESS_INIT stage, if `config.skills.enabled`, load skill index via `loadSkillIndex()`, call `matchSkills()`, and pass results to `injectConstraints()`. Trace the match results via the tracer.
  - Files: `src/pipeline/runner.ts`
  - Tests: Integration test: mock skill index with one matching skill → assert injectedContext contains skill content. Test with no index file → assert pipeline runs normally without skills.
  - Done when: Skills flow from index → match → inject → HARNESS_INIT prompt

## 6. CLI commands

- [ ] 6.1 Create `src/commands/skill-cmd.ts` with `runSkillCreate(name, projectRoot, context)`. Scaffold a skill file: scan project for relevant signals based on the name (e.g., name contains "test" → look for test config, test framework, test commands). Generate `.claude/commands/{name}.md` with YAML frontmatter (inferred triggers) and sections: title, detected tools, patterns (placeholder), examples (placeholder), anti-patterns (placeholder). Print the path and a hint to edit.
  - Files: `src/commands/skill-cmd.ts`
  - Tests: Unit test that `runSkillCreate('e2e-testing', ...)` creates `.claude/commands/e2e-testing.md`. Unit test that generated file has YAML frontmatter with triggers. Unit test that file contains detected test framework from context.
  - Done when: Scaffolding creates valid skill file; frontmatter has inferred triggers; detected context included

- [ ] 6.2 Add `runSkillList(projectRoot)` to `skill-cmd.ts`. Load skill index, group by sourceType, print table with source directory, skill count, and trigger count. If no index exists, print "No skills indexed. Run `reins init` to scan."
  - Files: `src/commands/skill-cmd.ts`
  - Tests: Unit test with mock index → assert output shows correct counts per source. Unit test with no index → assert hint message.
  - Done when: Listing shows all indexed skills grouped by source

- [ ] 6.3 Register `skill` command in `src/cli.ts` with subcommands:
  ```
  reins skill create <name>   — scaffold a new skill
  reins skill list             — list all indexed skills (alias: reins skills)
  ```
  Also register `reins skills` as alias for `reins skill list`.
  - Files: `src/cli.ts`
  - Tests: `pnpm typecheck` passes; `--help` shows skill commands.
  - Done when: Both commands reachable from CLI; help text correct

## 7. Update integration

- [ ] 7.1 Add skill re-indexing to `reins update` in `src/commands/update.ts`. After constraint merge and adapter regeneration, re-build and save the skill index if `config.skills.enabled`.
  - Files: `src/commands/update.ts`
  - Tests: Unit test that update re-indexes skills. Unit test that update with `skills.enabled: false` skips indexing.
  - Done when: Skill index stays fresh after updates

## 8. Develop command integration

- [ ] 8.1 Add `--skills <ids>` option to the `develop` command in `src/cli.ts`. When provided, bypass automatic matching and inject only the specified skills by ID. Pass as `opts.skillIds` in `PipelineOpts`.
  - Files: `src/cli.ts`, `src/pipeline/types.ts`
  - Tests: Unit test that `--skills e2e-testing,api-design` parses correctly.
  - Done when: Explicit skill selection works alongside automatic matching

## 9. Verification

- [ ] 9.1 Run `pnpm lint` and `pnpm test`. Write an integration test: create a temp project with `.claude/commands/testing.md` containing frontmatter with `triggers.keywords: [test]`, run init to index, then verify `skill-index.json` contains the skill with correct triggers. Simulate a `matchSkills` call with task "add unit tests" and assert the skill is matched with score > 0.
  - Files: `src/scanner/skill-scanner.test.ts`
  - Tests: Integration test as described; all existing tests pass.
  - Done when: Full flow tested end-to-end; all tests pass; `pnpm typecheck` clean
