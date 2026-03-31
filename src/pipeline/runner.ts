import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { loadConfig } from '../state/config.js';
import type { Constraint, ConstraintsConfig } from '../constraints/schema.js';
import { injectConstraints } from './constraint-injector.js';
import { runQA } from './qa.js';
import { logExecution } from './execution-logger.js';
import omcBridge from './omc-bridge.js';
import { evaluate } from '../evaluation/evaluator.js';
import { buildExitCondition, shouldExit } from '../evaluation/exit-condition.js';
import type { PipelineOpts, PipelineResult, StageResult, StageLog, ExecutionRecord } from './types.js';

// ---------------------------------------------------------------------------
// Stage definitions
// ---------------------------------------------------------------------------

const ALL_STAGES = ['harnessInit', 'ralplan', 'execution', 'ralph', 'qa'] as const;
type StageName = (typeof ALL_STAGES)[number];

function profileSkips(profile: string): string[] {
  if (profile === 'relaxed') return ['ralplan', 'ralph', 'qa'];
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

// ---------------------------------------------------------------------------
// Pipeline runner
// ---------------------------------------------------------------------------

export async function runPipeline(
  task: string,
  projectRoot: string,
  opts: PipelineOpts,
): Promise<PipelineResult> {
  const start = Date.now();
  const config = loadConfig(projectRoot);
  const constraints = loadConstraints(projectRoot);
  const profile = opts.profile ?? 'default';
  const skipStages = new Set([...(opts.skipStages ?? []), ...profileSkips(profile)]);

  const stageResults: Record<string, StageResult> = {};
  let failedStage: string | undefined;
  let pipelineError: string | undefined;
  let injectedContext = '';

  // HARNESS_INIT — always runs
  {
    const stageStart = Date.now();
    opts.onStageChange?.('harnessInit', 'start');
    try {
      injectedContext = injectConstraints(task, {
        profile,
        constraints,
        hooks: [],
        pipeline: { stages: ALL_STAGES.slice(), pre_commit: [], post_develop: [] },
      });
      stageResults['harnessInit'] = {
        success: true,
        duration: Date.now() - stageStart,
        output: injectedContext,
      };
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

        result = {
          success: ralphResult.success,
          duration: Date.now() - stageStart,
          output,
        };
      } else {
        // qa
        const qaResult = await runQA(projectRoot, config);
        result = {
          success: qaResult.passed,
          duration: Date.now() - stageStart,
          output: JSON.stringify(qaResult),
          ...(!qaResult.passed ? { error: 'QA failed' } : {}),
        };
      }

      stageResults[stage] = result;
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

  return {
    success,
    ...(failedStage ? { failedStage } : {}),
    ...(pipelineError ? { error: pipelineError } : {}),
    logPath,
    durationMs,
    stages: stageResults,
  };
}
