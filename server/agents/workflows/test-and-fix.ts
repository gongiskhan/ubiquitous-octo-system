/**
 * Test and Fix Workflow
 * Orchestrates the iterative test → fix → retest loop with Slack notifications
 */

import { runTest } from '../test-agent.js';
import { fixIssues } from '../code-agent.js';
import { storeIterationResult } from '../rag/index.js';
import type {
  AgentContext,
  TestResult,
  CodeAgentResult,
  IterationResult,
  WorkflowResult,
} from '../types.js';
import { DEFAULT_PASS_THRESHOLD, DEFAULT_MAX_ITERATIONS } from '../types.js';
import { info, warn, error as logError } from '../../logging/logger.js';

/**
 * Slack notification callback type
 */
export type SlackNotifyCallback = (params: {
  repoFullName: string;
  branch: string;
  iteration: number;
  maxIterations: number;
  phase: 'testing' | 'fixing' | 'complete';
  score: number;
  testsPassed: number;
  testsFailed: number;
  changesApplied?: number;
  filesChanged?: string[];
  summary: string;
  status: 'in-progress' | 'success' | 'failed' | 'max-iterations';
  screenshotUrl?: string;
  duration: number;
}) => Promise<void>;

/**
 * Workflow options
 */
export interface TestAndFixOptions {
  context: AgentContext;
  maxIterations?: number;
  passThreshold?: number;
  onSlackNotify?: SlackNotifyCallback;
}

/**
 * Execute the test-and-fix workflow
 * Runs iterative test → fix loops until score >= threshold or max iterations reached
 */
export async function executeTestAndFix(options: TestAndFixOptions): Promise<WorkflowResult> {
  const startTime = Date.now();
  const iterations: IterationResult[] = [];

  const { context, onSlackNotify } = options;
  const maxIterations = options.maxIterations ?? context.testingConfig.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const passThreshold = options.passThreshold ?? context.testingConfig.passThreshold ?? DEFAULT_PASS_THRESHOLD;

  const { repoFullName, branch, testingConfig } = context;

  info(`Starting test-and-fix workflow for ${repoFullName}/${branch}`, 'Workflow');
  info(`Max iterations: ${maxIterations}, Pass threshold: ${passThreshold}%`, 'Workflow');

  let lastTestResult: TestResult | null = null;
  let lastFixResult: CodeAgentResult | null = null;
  let finalStatus: 'success' | 'failed' | 'max-iterations' = 'max-iterations';
  let allScreenshots: string[] = [];

  try {
    for (let i = 1; i <= maxIterations; i++) {
      const iterationStart = Date.now();

      info(`=== Iteration ${i}/${maxIterations} ===`, 'Workflow');

      // PHASE 1: Test
      info('Phase: Testing...', 'Workflow');

      // Notify Slack about testing phase
      if (onSlackNotify) {
        await onSlackNotify({
          repoFullName,
          branch,
          iteration: i,
          maxIterations,
          phase: 'testing',
          score: lastTestResult?.score ?? 0,
          testsPassed: lastTestResult?.testsPassed ?? 0,
          testsFailed: lastTestResult?.testsFailed ?? 0,
          summary: `Starting iteration ${i} - testing...`,
          status: 'in-progress',
          duration: Date.now() - startTime,
        });
      }

      const testStart = Date.now();
      lastTestResult = await runTest(context);
      const testDuration = Date.now() - testStart;

      info(`Test completed: score=${lastTestResult.score}%, passed=${lastTestResult.testsPassed}, failed=${lastTestResult.testsFailed}`, 'Workflow');

      // Collect screenshots
      if (lastTestResult.screenshotPaths.length > 0) {
        allScreenshots.push(...lastTestResult.screenshotPaths);
      }

      // Store test iteration result
      const testIteration: IterationResult = {
        iteration: i,
        phase: 'test',
        testResult: lastTestResult,
        score: lastTestResult.score,
        timestamp: new Date().toISOString(),
        duration: testDuration,
      };
      iterations.push(testIteration);

      await storeIterationResult(repoFullName, {
        iteration: i,
        phase: 'test',
        score: lastTestResult.score,
        testsPassed: lastTestResult.testsPassed,
        testsFailed: lastTestResult.testsFailed,
        duration: testDuration,
      });

      // Check if tests pass threshold
      if (lastTestResult.score >= passThreshold) {
        info(`Tests passed with score ${lastTestResult.score}% (threshold: ${passThreshold}%)`, 'Workflow');

        // Notify Slack about success
        if (onSlackNotify) {
          await onSlackNotify({
            repoFullName,
            branch,
            iteration: i,
            maxIterations,
            phase: 'complete',
            score: lastTestResult.score,
            testsPassed: lastTestResult.testsPassed,
            testsFailed: lastTestResult.testsFailed,
            summary: `Tests passed! Score: ${lastTestResult.score}%`,
            status: 'success',
            duration: Date.now() - startTime,
          });
        }

        finalStatus = 'success';
        break;
      }

      // If not last iteration, try to fix
      if (i < maxIterations) {
        // PHASE 2: Fix
        info('Phase: Fixing...', 'Workflow');

        // Notify Slack about fixing phase
        if (onSlackNotify) {
          await onSlackNotify({
            repoFullName,
            branch,
            iteration: i,
            maxIterations,
            phase: 'fixing',
            score: lastTestResult.score,
            testsPassed: lastTestResult.testsPassed,
            testsFailed: lastTestResult.testsFailed,
            summary: `Score ${lastTestResult.score}% below threshold ${passThreshold}%. Attempting to fix...`,
            status: 'in-progress',
            duration: Date.now() - startTime,
          });
        }

        const fixStart = Date.now();
        lastFixResult = await fixIssues(context, lastTestResult);
        const fixDuration = Date.now() - fixStart;

        info(`Fix completed: ${lastFixResult.changesApplied} changes applied to ${lastFixResult.files.length} files`, 'Workflow');

        // Store fix iteration result
        const fixIteration: IterationResult = {
          iteration: i,
          phase: 'fix',
          fixResult: lastFixResult,
          score: lastTestResult.score,
          timestamp: new Date().toISOString(),
          duration: fixDuration,
        };
        iterations.push(fixIteration);

        await storeIterationResult(repoFullName, {
          iteration: i,
          phase: 'fix',
          score: lastTestResult.score,
          testsPassed: lastTestResult.testsPassed,
          testsFailed: lastTestResult.testsFailed,
          fixesApplied: lastFixResult.changesApplied,
          filesChanged: lastFixResult.files,
          duration: fixDuration,
        });

        // Notify Slack about fix results
        if (onSlackNotify) {
          await onSlackNotify({
            repoFullName,
            branch,
            iteration: i,
            maxIterations,
            phase: 'fixing',
            score: lastTestResult.score,
            testsPassed: lastTestResult.testsPassed,
            testsFailed: lastTestResult.testsFailed,
            changesApplied: lastFixResult.changesApplied,
            filesChanged: lastFixResult.files,
            summary: `Applied ${lastFixResult.changesApplied} fixes. Will retest in next iteration.`,
            status: 'in-progress',
            duration: Date.now() - startTime,
          });
        }

        // If no changes were applied, stop trying
        if (lastFixResult.changesApplied === 0) {
          warn('No fixes could be applied, stopping iterations', 'Workflow');
          finalStatus = 'failed';
          break;
        }
      } else {
        // Last iteration and still failing
        warn(`Reached maximum iterations (${maxIterations}) without passing threshold`, 'Workflow');

        // Notify Slack about max iterations reached
        if (onSlackNotify) {
          await onSlackNotify({
            repoFullName,
            branch,
            iteration: i,
            maxIterations,
            phase: 'complete',
            score: lastTestResult.score,
            testsPassed: lastTestResult.testsPassed,
            testsFailed: lastTestResult.testsFailed,
            summary: `Max iterations reached. Final score: ${lastTestResult.score}% (threshold: ${passThreshold}%)`,
            status: 'max-iterations',
            duration: Date.now() - startTime,
          });
        }

        finalStatus = 'max-iterations';
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`Workflow error: ${message}`, 'Workflow');

    // Notify Slack about failure
    if (onSlackNotify) {
      await onSlackNotify({
        repoFullName,
        branch,
        iteration: iterations.length + 1,
        maxIterations,
        phase: 'complete',
        score: lastTestResult?.score ?? 0,
        testsPassed: lastTestResult?.testsPassed ?? 0,
        testsFailed: lastTestResult?.testsFailed ?? 1,
        summary: `Workflow error: ${message}`,
        status: 'failed',
        duration: Date.now() - startTime,
      });
    }

    finalStatus = 'failed';
  }

  const totalDuration = Date.now() - startTime;

  // Build final summary
  const finalScore = lastTestResult?.score ?? 0;
  let summary: string;

  switch (finalStatus) {
    case 'success':
      summary = `Tests passed with score ${finalScore}% after ${iterations.length} iteration(s)`;
      break;
    case 'max-iterations':
      summary = `Max iterations (${maxIterations}) reached. Final score: ${finalScore}% (threshold: ${passThreshold}%)`;
      break;
    case 'failed':
      summary = `Workflow failed. Final score: ${finalScore}%`;
      break;
  }

  info(`Workflow completed: ${finalStatus} - ${summary}`, 'Workflow');

  return {
    success: finalStatus === 'success',
    summary,
    iterations,
    finalScore,
    duration: totalDuration,
    screenshotPaths: allScreenshots,
  };
}

/**
 * Execute just testing (no fix loop)
 */
export async function executeJustTest(context: AgentContext): Promise<WorkflowResult> {
  const startTime = Date.now();

  info(`Starting test-only workflow for ${context.repoFullName}/${context.branch}`, 'Workflow');

  const testResult = await runTest(context);
  const duration = Date.now() - startTime;

  const iteration: IterationResult = {
    iteration: 1,
    phase: 'test',
    testResult,
    score: testResult.score,
    timestamp: new Date().toISOString(),
    duration,
  };

  await storeIterationResult(context.repoFullName, {
    iteration: 1,
    phase: 'test',
    score: testResult.score,
    testsPassed: testResult.testsPassed,
    testsFailed: testResult.testsFailed,
    duration,
  });

  return {
    success: testResult.success,
    summary: testResult.summary,
    iterations: [iteration],
    finalScore: testResult.score,
    duration,
    screenshotPaths: testResult.screenshotPaths,
  };
}
