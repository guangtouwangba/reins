import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { loadConfig } from '../state/config.js';
import type { Constraint, ConstraintsConfig } from '../constraints/schema.js';
import { injectConstraints } from './constraint-injector.js';
import { runQA } from './qa.js';
import type { QAConfig } from './qa.js';
import { logExecution } from './execution-logger.js';
import omcBridge from './omc-bridge.js';
import { evaluate } from '../evaluation/evaluator.js';
import { buildExitCondition, shouldExit } from '../evaluation/exit-condition.js';
import type { PipelineOpts, PipelineResult, StageResult, StageLog, ExecutionRecord } from './types.js';
import { Tracer } from '../diagnostics/tracer.js';
import { refineRequirements } from './requirement-refiner.js';
import { generateDesign } from './design-generator.js';
import { generateTasks } from './task-generator.js';
import { loadSpec, writeSpecFile, updateSpecStatus } from '../state/specs.js';
import { matchSkills } from './skill-matcher.js';
import { loadSkillIndex } from '../scanner/skill-indexer.js';
import type { ScoredSkill } from '../scanner/skill-types.js';

// ---------------------------------------------------------------------------
// Stage definitions
// ---------------------------------------------------------------------------

const ALL_STAGES = ['requirementRefine', 'designGenerate', 'taskGenerate', 'harnessInit', 'ralplan', 'execution', 'ralph', 'qa'] as const;
type StageName = (typeof ALL_STAGES)[number];

function profileSkips(profile: string): string[] {
  if (profile === 'relaxed') return ['requirementRefine', 'designGenerate', 'taskGenerate', 'ralplan', 'ralph', 'qa'];
  return [];
}

// ---------------------------------------------------------------------------
// Load constraints from .reins/constraints.yaml
// ---------------------------------------------------------------------------

function loadConstraints(projectRoot: string): Constraint[] {
  const constraintsPath = join(projectRoot, '.reins', 'constraints.yaml');
  if (!existsSync(constraintsPath)) return [];
  try {
    const raw = readFileSync(constraintsPath, 'utf-8');
    const config = yaml.load(raw) as ConstraintsConfig;
    return config.constraints ?? [];
  } catch {
    return [];
  }
}

function loadConstraintsConfig(projectRoot: string): ConstraintsConfig | null {
  const constraintsPath = join(projectRoot, '.reins', 'constraints.yaml');
  if (!existsSync(constraintsPath)) return null;
  try {
    const raw = readFileSync(constraintsPath, 'utf-8');
    return yaml.load(raw) as ConstraintsConfig;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pipeline runner
// ---------------------------------------------------------------------------

export async function runPipeline(
  task: string,
  projectRoot: string,
  opts: PipelineOpts,
): Promise<PipelineResult> {
  const start = Date.now();
  const tracer = new Tracer(projectRoot);
  const config = loadConfig(projectRoot);
  const constraints = loadConstraints(projectRoot);
  const profile = opts.profile ?? 'default';
  const skipStages = new Set([...(opts.skipStages ?? []), ...profileSkips(profile)]);

  tracer.trace('pipeline', 'start', { task, profile, skipStages: [...skipStages] });

  const stageResults: Record<string, StageResult> = {};
  let failedStage: string | undefined;
  let pipelineError: string | undefined;
  let injectedContext = '';
  let specId: string | undefined;

  // REQUIREMENT_REFINE
  if (!failedStage && !skipStages.has('requirementRefine')) {
    const stageStart = Date.now();
    opts.onStageChange?.('requirementRefine', 'start');
    tracer.trace('pipeline', 'stage:requirementRefine:start');
    try {
      const { scan } = await import('../scanner/scan.js');
      const reinsConfig = loadConfig(projectRoot);
      const context = await scan(projectRoot, 'L0-L2', reinsConfig, { dryRun: true });
      specId = await refineRequirements(task, context, constraints, projectRoot, { noInput: opts.noInput });
      stageResults['requirementRefine'] = { success: true, duration: Date.now() - stageStart, output: specId };
      opts.onStageChange?.('requirementRefine', 'complete');
      tracer.trace('pipeline', 'stage:requirementRefine:end', { success: true, specId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stageResults['requirementRefine'] = { success: false, duration: Date.now() - stageStart, output: '', error: msg };
      failedStage = 'requirementRefine';
      pipelineError = msg;
      opts.onStageChange?.('requirementRefine', 'fail');
      tracer.trace('pipeline', 'stage:requirementRefine:error', { error: msg });
    }
  } else if (!failedStage) {
    opts.onStageChange?.('requirementRefine', 'skip');
    stageResults['requirementRefine'] = { success: true, duration: 0, output: '', skipped: true };
  }

  // DESIGN_GENERATE
  if (!failedStage && !skipStages.has('designGenerate')) {
    const stageStart = Date.now();
    opts.onStageChange?.('designGenerate', 'start');
    tracer.trace('pipeline', 'stage:designGenerate:start');
    try {
      const { scan } = await import('../scanner/scan.js');
      const reinsConfig = loadConfig(projectRoot);
      const context = await scan(projectRoot, 'L0-L2', reinsConfig, { dryRun: true });
      const specBundle = specId ? loadSpec(projectRoot, specId) : null;
      const specContent = specBundle?.specContent ?? '';
      const designContent = await generateDesign({ specContent, context, constraints });
      if (specId) {
        writeSpecFile(projectRoot, specId, 'design.md', designContent);
        updateSpecStatus(projectRoot, specId, 'in-progress');
      }
      stageResults['designGenerate'] = { success: true, duration: Date.now() - stageStart, output: designContent };
      opts.onStageChange?.('designGenerate', 'complete');
      tracer.trace('pipeline', 'stage:designGenerate:end', { success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stageResults['designGenerate'] = { success: false, duration: Date.now() - stageStart, output: '', error: msg };
      failedStage = 'designGenerate';
      pipelineError = msg;
      opts.onStageChange?.('designGenerate', 'fail');
      tracer.trace('pipeline', 'stage:designGenerate:error', { error: msg });
    }
  } else if (!failedStage) {
    opts.onStageChange?.('designGenerate', 'skip');
    stageResults['designGenerate'] = { success: true, duration: 0, output: '', skipped: true };
  }

  // TASK_GENERATE
  if (!failedStage && !skipStages.has('taskGenerate')) {
    const stageStart = Date.now();
    opts.onStageChange?.('taskGenerate', 'start');
    tracer.trace('pipeline', 'stage:taskGenerate:start');
    try {
      const specBundle = specId ? loadSpec(projectRoot, specId) : null;
      const tasksContent = await generateTasks({
        designContent: specBundle?.designContent ?? '',
        specContent: specBundle?.specContent ?? '',
        constraints,
      });
      if (specId) {
        writeSpecFile(projectRoot, specId, 'tasks.md', tasksContent);
        updateSpecStatus(projectRoot, specId, 'in-progress');
      }
      stageResults['taskGenerate'] = { success: true, duration: Date.now() - stageStart, output: tasksContent };
      opts.onStageChange?.('taskGenerate', 'complete');
      tracer.trace('pipeline', 'stage:taskGenerate:end', { success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stageResults['taskGenerate'] = { success: false, duration: Date.now() - stageStart, output: '', error: msg };
      failedStage = 'taskGenerate';
      pipelineError = msg;
      opts.onStageChange?.('taskGenerate', 'fail');
      tracer.trace('pipeline', 'stage:taskGenerate:error', { error: msg });
    }
  } else if (!failedStage) {
    opts.onStageChange?.('taskGenerate', 'skip');
    stageResults['taskGenerate'] = { success: true, duration: 0, output: '', skipped: true };
  }

  // Skill matching (before HARNESS_INIT)
  let matchedSkills: ScoredSkill[] = [];
  if (config.skills?.enabled) {
    const skillIndex = loadSkillIndex(projectRoot);
    if (skillIndex) {
      const { emptyCodebaseContext } = await import('../scanner/types.js');
      const minContext = emptyCodebaseContext();
      matchedSkills = matchSkills(task, minContext, skillIndex, {
        max_tokens: config.skills.inject?.max_tokens ?? 4000,
        max_skills: config.skills.inject?.max_skills ?? 5,
      });
      tracer.trace('pipeline', 'skills:matched', { count: matchedSkills.length, ids: matchedSkills.map(s => s.entry.id) });
    }
  }

  // HARNESS_INIT — always runs
  {
    const stageStart = Date.now();
    opts.onStageChange?.('harnessInit', 'start');
    tracer.trace('pipeline', 'stage:harnessInit:start');
    try {
      injectedContext = injectConstraints(task, {
        profile,
        constraints,
        hooks: [],
        pipeline: { stages: ALL_STAGES.slice(), pre_commit: [], post_develop: [] },
      }, matchedSkills);
      stageResults['harnessInit'] = {
        success: true,
        duration: Date.now() - stageStart,
        output: injectedContext,
      };
      tracer.trace('pipeline', 'stage:harnessInit:end', { success: true, durationMs: Date.now() - stageStart });
      opts.onStageChange?.('harnessInit', 'complete');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stageResults['harnessInit'] = {
        success: false,
        duration: Date.now() - stageStart,
        output: '',
        error: msg,
      };
      failedStage = 'harnessInit';
      pipelineError = msg;
      opts.onStageChange?.('harnessInit', 'fail');
    }
  }

  // Remaining stages
  const remainingStages: StageName[] = ['ralplan', 'execution', 'ralph', 'qa'];

  for (const stage of remainingStages) {
    if (failedStage) break;

    if (skipStages.has(stage)) {
      opts.onStageChange?.(stage, 'skip');
      stageResults[stage] = { success: true, duration: 0, output: '', skipped: true };
      continue;
    }

    const stageStart = Date.now();
    opts.onStageChange?.(stage, 'start');
    tracer.trace('pipeline', `stage:${stage}:start`);

    try {
      let result: StageResult;

      if (stage === 'ralplan') {
        const plan = await omcBridge.ralplan(injectedContext);
        result = {
          success: true,
          duration: Date.now() - stageStart,
          output: JSON.stringify(plan),
        };
      } else if (stage === 'execution') {
        const execResult = await omcBridge.executor(injectedContext, {});
        result = {
          success: execResult.success,
          duration: Date.now() - stageStart,
          output: execResult.output,
        };
      } else if (stage === 'ralph') {
        // Evaluate L0 and wire exit condition
        const evalResult = await evaluate(projectRoot, profile);
        const exitCond = buildExitCondition(evalResult, 0, config);
        const exitDecision = shouldExit(exitCond, profile);

        const ralphResult = await omcBridge.ralph(injectedContext, 3);
        const output = [
          `L0_passed: ${exitCond.L0_passed}`,
          `exit_decision: ${exitDecision.exit} (${exitDecision.reason})`,
          `ralph: ${JSON.stringify(ralphResult)}`,
        ].join('\n');

        const gatesPassed = exitCond.L0_passed && !exitDecision.exit;
        result = {
          success: ralphResult.success && gatesPassed,
          duration: Date.now() - stageStart,
          output,
          ...(!gatesPassed ? { error: `Evaluation gates failed: ${exitDecision.reason}` } : {}),
        };
      } else {
        // qa
        const constraintsConfig = loadConstraintsConfig(projectRoot);
        const qaConfig: QAConfig = {
          pre_commit: constraintsConfig?.pipeline?.pre_commit ?? [],
          post_develop: constraintsConfig?.pipeline?.post_develop ?? [],
        };
        const qaResult = await runQA(projectRoot, qaConfig);
        result = {
          success: qaResult.passed,
          duration: Date.now() - stageStart,
          output: JSON.stringify(qaResult),
          ...(!qaResult.passed ? { error: 'QA failed' } : {}),
        };
      }

      stageResults[stage] = result;
      tracer.trace('pipeline', `stage:${stage}:end`, { success: result.success, durationMs: result.duration });
      opts.onStageChange?.(stage, result.success ? 'complete' : 'fail');

      if (!result.success) {
        failedStage = stage;
        pipelineError = result.error ?? `${stage} stage failed`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stageResults[stage] = {
        success: false,
        duration: Date.now() - stageStart,
        output: '',
        error: msg,
      };
      failedStage = stage;
      pipelineError = msg;
      opts.onStageChange?.(stage, 'fail');
    }
  }

  const durationMs = Date.now() - start;
  const success = !failedStage;

  // Build execution record and log it
  const stageLogs: Record<string, StageLog> = {};
  for (const [name, sr] of Object.entries(stageResults)) {
    stageLogs[name] = {
      success: sr.success,
      durationMs: sr.duration,
      output: sr.output,
      ...(sr.error ? { error: sr.error } : {}),
      ...(sr.skipped ? { skipped: sr.skipped } : {}),
    };
  }

  const record: ExecutionRecord = {
    id: randomUUID(),
    task,
    profile,
    durationSeconds: Math.round(durationMs / 1000),
    outcome: success ? 'success' : 'failure',
    stages: stageLogs,
    constraintsChecked: constraints.length,
    constraintsViolated: 0,
    violations: [],
  };

  const logPath = logExecution(projectRoot, record);

  tracer.trace('pipeline', 'end', { success, durationMs, failedStage });

  return {
    success,
    ...(failedStage ? { failedStage } : {}),
    ...(pipelineError ? { error: pipelineError } : {}),
    logPath,
    durationMs,
    stages: stageResults,
  };
}
