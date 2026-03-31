## Approach

L4 is a thin orchestration layer over LLM calls. The semantic reviewer builds a structured prompt from inputs already available (task description, diffs, prior verification results), calls the configured LLM, and parses a JSON response. The visual reviewer is identical in shape but attaches screenshot data. The contract verifier is strategy-dispatched and each strategy is a self-contained function. All three are independently skippable so a misconfigured or absent strategy does not block the evaluation pipeline.

## Architecture

**Semantic Reviewer** (`src/evaluation/l4-semantic.ts`)

```typescript
interface SemanticReviewResult {
  completenessScore: number;    // 0-100
  confidence: number;           // 0-100
  issues: SemanticIssue[];
  suggestions: string[];
  rawResponse: string;
}

interface SemanticIssue {
  severity: 'missing' | 'incomplete' | 'excess' | 'security';
  description: string;
  relatedFiles?: string[];
}

async function semanticReview(
  taskDescription: string,
  changedFiles: FileChange[],
  verificationResults: VerificationResult
): Promise<SemanticReviewResult>
```

Prompt structure:
1. Task requirements section — verbatim task description
2. Code changes section — one fenced diff block per changed file
3. Verification results section — JSON summary of L0/L1/L2 pass/fail with case-level detail
4. Evaluation instructions — asks for: completeness assessment, missing requirements, excess implementation, edge case gaps, security issues, and final score with confidence

Response format is requested as JSON with the shape of `SemanticReviewResult`. The function parses the JSON; on parse failure it retries once with a stricter prompt, then returns a fallback result with `confidence: 0`.

**Visual Reviewer** (`src/evaluation/visual-reviewer.ts`)

```typescript
interface VisualReviewResult {
  passed: boolean;
  observations: string[];
  score: number;    // 0-100, folded into L4 completenessScore as a weighted average
}

async function visualReview(
  screenshots: Screenshot[],
  taskDescription: string
): Promise<VisualReviewResult>

interface Screenshot {
  name: string;
  path: string;
  base64: string;
}
```

Screenshots are loaded from `.reins/logs/screenshots/` (written by L3 Playwright runs). Each screenshot is base64-encoded and embedded in the vision LLM message. The prompt asks the model to assess whether the UI matches the task description and to identify visible issues. Returns `{ passed: false, observations: [], score: 0 }` when no screenshots are available—caller treats this as skipped, not failed.

**Contract Verifier** (`src/evaluation/contract-verifier.ts`)

```typescript
type ContractStrategy = 'type_sharing' | 'openapi' | 'runtime_record' | 'none';

interface ContractVerifyResult {
  strategy: ContractStrategy;
  passed: boolean;
  skipped: boolean;
  issues: string[];
}

async function verifyContract(projectRoot: string, strategy: ContractStrategy): Promise<ContractVerifyResult>
```

Strategy dispatch:
- `type_sharing`: Runs `tsc --noEmit` on the shared types package. Pass = zero type errors. Prerequisites: `tsconfig.json` with `paths` mapping to shared types directory.
- `openapi`: Diffs `openapi.yaml`/`swagger.yaml` against route files using a lightweight route extractor. Flags routes present in spec but missing in code, and vice versa. No third-party OpenAPI library—regex-based route extraction.
- `runtime_record`: Loads HTTP request/response pairs from `.reins/recordings/`, replays requests against the running service (requires `EnvironmentManager.start()` already called), compares response status and body shape. Falls back to skipped if no recordings exist.
- `none`: Always returns `{ skipped: true }`.

**L4 Integration in evaluator** (`src/evaluation/evaluator.ts`)

```
L2 result available
  → semanticReview(taskDesc, diffs, l0+l1+l2 results)
  → visualReview(screenshots, taskDesc)       // skipped if no screenshots
  → verifyContract(projectRoot, strategy)     // skipped if 'none' or prerequisites absent
  → L4Score = completenessScore * 0.7 + visualScore * 0.3  (if visual available)
           OR completenessScore * 1.0                      (if visual skipped)
  → ExitCondition.L4_confidence = SemanticReviewResult.confidence
    when L4Score >= threshold and L4_confidence >= 80 → exit
```

**Data flow**:
```
evaluator
  → [L0 → L1 → L2 complete]
  → semanticReview(taskDescription, changedFiles, priorResults)
      → LLM call → JSON parse → SemanticReviewResult
  → visualReview(screenshots, taskDescription)
      → vision LLM call → VisualReviewResult     (or skipped)
  → verifyContract(projectRoot, strategy)
      → tsc / route-diff / replay → ContractVerifyResult  (or skipped)
  → aggregate into EvaluationResult.l4
  → update ExitCondition.L4_confidence
```

## Key Decisions

- **JSON-structured LLM output**: Requesting JSON from the LLM gives a parseable result rather than free text. The prompt includes an explicit JSON schema example. A retry with stricter instructions handles the common case of the model wrapping JSON in markdown fences.
- **Visual score weighted at 30%**: Semantic review of code diffs is more reliable than visual review, which can hallucinate. A 70/30 split means a bad visual result can lower the score but cannot single-handedly block completion.
- **Contract verifier is always optional**: Projects that do not maintain an OpenAPI spec or shared types package should not be penalized. `strategy: none` is a valid and explicit choice; absent prerequisites degrade to skipped, not failed.
- **L4 runs after L2, not in parallel**: L4 receives L2 results as input context. Running them in parallel would mean L4 lacks case-level pass/fail detail, reducing the quality of the semantic assessment.
- **Model is configurable, defaults to agent model**: Using the same model as the agent requires no additional API key configuration. Projects can override to `haiku` for cost reduction if L4 is running in a tight loop.

## File Structure

```
src/evaluation/l4-semantic.ts       # semanticReview(): LLM prompt builder + JSON parser
src/evaluation/visual-reviewer.ts   # visualReview(): screenshot loader + vision LLM call
src/evaluation/contract-verifier.ts # verifyContract(): strategy dispatch, 3 implementations
```
