import { readLogTail } from '../logging/logStore.js';
import { info, warn, error as logError } from '../logging/logger.js';
import { retryWithBackoff } from '../utils/timeout.js';
import type { DiffResult } from '../config.js';
import type { Durations } from '../build/profiles/profileTypes.js';
import type { ErrorAnalysisResult } from '../utils/errorAnalyzer.js';

const BUILD_LOG_TAIL_LINES = 30;
const RUNTIME_LOG_TAIL_LINES = 15;

interface BuildResultParams {
  repoFullName: string;
  branch: string;
  screenshotUrl?: string;
  buildLogPath?: string;
  runtimeLogPath?: string;
  networkLogPath?: string;
  diffResult?: DiffResult;
  durations?: Durations;
}

interface BuildFailureParams extends BuildResultParams {
  errorMessage: string;
  errorSummary?: ErrorAnalysisResult | null;
}

interface SlackMessage {
  text: string;
  blocks?: SlackBlock[];
}

interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
  };
  accessory?: {
    type: string;
    image_url?: string;
    alt_text?: string;
  };
}

function getSlackWebhookUrl(): string | null {
  return process.env.SLACK_WEBHOOK_URL || null;
}

function truncateForSlack(text: string, maxLength: number = 2500): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + '\n... (truncated)';
}

async function sendSlackMessage(message: SlackMessage): Promise<boolean> {
  const webhookUrl = getSlackWebhookUrl();

  if (!webhookUrl) {
    warn('SLACK_WEBHOOK_URL not set, skipping notification', 'Slack');
    return false;
  }

  try {
    return await retryWithBackoff(
      async () => {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(message),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Slack API error: ${response.status} ${text}`);
        }

        info('Slack notification sent successfully', 'Slack');
        return true;
      },
      {
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 8000,
      }
    );
  } catch (error) {
    logError(`Failed to send Slack notification: ${error}`, 'Slack');
    return false;
  }
}

function formatLogSection(title: string, logPath: string | undefined, tailLines: number): string {
  if (!logPath) {
    return '';
  }

  const tail = readLogTail(logPath, tailLines);
  if (!tail || tail.trim().length === 0) {
    return '';
  }

  return `\n*${title}:*\n\`\`\`\n${truncateForSlack(tail)}\n\`\`\``;
}

function formatDuration(durations?: Durations): string {
  if (!durations?.total) {
    return '';
  }

  const parts: string[] = [];
  const total = Math.round(durations.total / 1000);

  if (durations.git) {
    parts.push(`git: ${Math.round(durations.git / 1000)}s`);
  }
  if (durations.install) {
    parts.push(`install: ${Math.round(durations.install / 1000)}s`);
  }
  if (durations.build) {
    parts.push(`build: ${Math.round(durations.build / 1000)}s`);
  }
  if (durations.screenshot) {
    parts.push(`screenshot: ${Math.round(durations.screenshot / 1000)}s`);
  }

  return `*Duration:* ${total}s (${parts.join(', ')})\n`;
}

function formatDiffResult(diffResult?: DiffResult): string {
  if (!diffResult) {
    return '';
  }

  const percentage = diffResult.diffPercentage.toFixed(2);

  if (diffResult.diffPercentage === 0) {
    return '*Visual changes:* None detected :white_check_mark:\n';
  }

  if (diffResult.diffPercentage < 1) {
    return `*Visual changes:* ${percentage}% (minor) :small_blue_diamond:\n`;
  }

  if (diffResult.diffPercentage < 10) {
    return `*Visual changes:* ${percentage}% :large_blue_diamond:\n`;
  }

  return `*Visual changes:* ${percentage}% :warning:\n`;
}

function formatErrorSummary(errorSummary?: ErrorAnalysisResult | null): string {
  if (!errorSummary) {
    return '';
  }

  let text = '';

  if (errorSummary.summary) {
    text += `*Summary:* ${errorSummary.summary}\n`;
  }

  if (errorSummary.warningCount > 0) {
    text += `*Warnings:* ${errorSummary.warningCount}\n`;
  }

  if (errorSummary.errorLines.length > 0) {
    text += `*Top errors:*\n`;
    for (const errorLine of errorSummary.errorLines.slice(0, 5)) {
      const truncated = errorLine.length > 150 ? errorLine.slice(0, 147) + '...' : errorLine;
      text += `• \`${truncated}\`\n`;
    }
  }

  return text;
}

export async function sendBuildResultSuccess(params: BuildResultParams): Promise<boolean> {
  const {
    repoFullName,
    branch,
    screenshotUrl,
    buildLogPath,
    runtimeLogPath,
    diffResult,
    durations,
  } = params;

  let text = `:white_check_mark: *BranchRunner: Build SUCCESS*\n`;
  text += `*Repository:* \`${repoFullName}\`\n`;
  text += `*Branch:* \`${branch}\`\n`;
  text += formatDuration(durations);
  text += formatDiffResult(diffResult);

  if (screenshotUrl) {
    text += `*Screenshot:* ${screenshotUrl}\n`;
  }

  // Keep log sections minimal for success
  text += formatLogSection('Build log (last lines)', buildLogPath, 15);

  return sendSlackMessage({ text });
}

export async function sendBuildResultFailure(params: BuildFailureParams): Promise<boolean> {
  const {
    repoFullName,
    branch,
    screenshotUrl,
    buildLogPath,
    runtimeLogPath,
    errorMessage,
    errorSummary,
    durations,
  } = params;

  let text = `:x: *BranchRunner: Build FAILED*\n`;
  text += `*Repository:* \`${repoFullName}\`\n`;
  text += `*Branch:* \`${branch}\`\n`;
  text += formatDuration(durations);
  text += `*Error:* ${errorMessage}\n`;

  // Add error analysis
  text += formatErrorSummary(errorSummary);

  if (screenshotUrl) {
    text += `*Screenshot:* ${screenshotUrl}\n`;
  }

  text += formatLogSection('Build log (last lines)', buildLogPath, BUILD_LOG_TAIL_LINES);
  text += formatLogSection('Runtime log (last lines)', runtimeLogPath, RUNTIME_LOG_TAIL_LINES);

  return sendSlackMessage({ text });
}

export async function sendTestNotification(): Promise<boolean> {
  const text = `:wave: *BranchRunner Test Notification*\n` +
    `This is a test message to verify your Slack webhook is working correctly.\n` +
    `Timestamp: ${new Date().toISOString()}`;

  return sendSlackMessage({ text });
}

export function isSlackConfigured(): boolean {
  return !!getSlackWebhookUrl();
}

/**
 * Test failure detail for notifications
 */
export interface TestFailureDetail {
  path: string;
  feature?: string;
  error: string;
  type: 'console-error' | 'network-error' | 'functional-error' | 'visual-error';
}

/**
 * Testing iteration notification parameters
 */
export interface TestIterationParams {
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
  // Error details for better debugging
  failures?: TestFailureDetail[];
  consoleErrors?: string[];
  networkErrors?: string[];
  rawTestOutput?: string;
}

/**
 * Format error details for Slack
 */
function formatTestErrors(params: {
  failures?: TestFailureDetail[];
  consoleErrors?: string[];
  networkErrors?: string[];
  rawTestOutput?: string;
}): string {
  const { failures, consoleErrors, networkErrors, rawTestOutput } = params;
  let text = '';

  // Format console errors
  if (consoleErrors && consoleErrors.length > 0) {
    text += `\n:rotating_light: *Console Errors:*\n`;
    for (const error of consoleErrors.slice(0, 5)) {
      const truncated = error.length > 150 ? error.slice(0, 147) + '...' : error;
      text += `• \`${truncated}\`\n`;
    }
    if (consoleErrors.length > 5) {
      text += `  _...and ${consoleErrors.length - 5} more_\n`;
    }
  }

  // Format network errors
  if (networkErrors && networkErrors.length > 0) {
    text += `\n:globe_with_meridians: *Network Errors:*\n`;
    for (const error of networkErrors.slice(0, 5)) {
      const truncated = error.length > 150 ? error.slice(0, 147) + '...' : error;
      text += `• \`${truncated}\`\n`;
    }
    if (networkErrors.length > 5) {
      text += `  _...and ${networkErrors.length - 5} more_\n`;
    }
  }

  // Format other failures
  if (failures && failures.length > 0) {
    const functionalFailures = failures.filter(f => f.type === 'functional-error' || f.type === 'visual-error');
    if (functionalFailures.length > 0) {
      text += `\n:x: *Test Failures:*\n`;
      for (const failure of functionalFailures.slice(0, 5)) {
        const truncatedError = failure.error.length > 150 ? failure.error.slice(0, 147) + '...' : failure.error;
        text += `• ${failure.path}: \`${truncatedError}\`\n`;
      }
      if (functionalFailures.length > 5) {
        text += `  _...and ${functionalFailures.length - 5} more_\n`;
      }
    }
  }

  // If no specific errors but we have raw output, show a snippet
  if (!text && rawTestOutput && rawTestOutput.length > 0) {
    const lines = rawTestOutput.split('\n').filter(l => l.trim());
    const lastLines = lines.slice(-10).join('\n');
    if (lastLines.trim()) {
      text += `\n*Test Output (last lines):*\n\`\`\`\n${truncateForSlack(lastLines, 500)}\n\`\`\`\n`;
    }
  }

  return text;
}

/**
 * Send a testing iteration notification
 */
export async function sendTestIterationNotification(params: TestIterationParams): Promise<boolean> {
  const {
    repoFullName,
    branch,
    iteration,
    maxIterations,
    phase,
    score,
    testsPassed,
    testsFailed,
    changesApplied,
    filesChanged,
    summary,
    status,
    screenshotUrl,
    duration,
    failures,
    consoleErrors,
    networkErrors,
    rawTestOutput,
  } = params;

  // Choose emoji based on status
  let emoji: string;
  let statusText: string;
  switch (status) {
    case 'success':
      emoji = ':white_check_mark:';
      statusText = 'PASSED';
      break;
    case 'failed':
      emoji = ':x:';
      statusText = 'FAILED';
      break;
    case 'max-iterations':
      emoji = ':warning:';
      statusText = 'MAX ITERATIONS';
      break;
    default:
      emoji = ':hourglass_flowing_sand:';
      statusText = 'IN PROGRESS';
  }

  // Choose phase emoji
  let phaseEmoji: string;
  switch (phase) {
    case 'testing':
      phaseEmoji = ':mag:';
      break;
    case 'fixing':
      phaseEmoji = ':wrench:';
      break;
    default:
      phaseEmoji = ':checkered_flag:';
  }

  let text = `${emoji} *BranchRunner: Testing ${statusText}*\n`;
  text += `*Repository:* \`${repoFullName}\`\n`;
  text += `*Branch:* \`${branch}\`\n`;
  text += `*Iteration:* ${iteration}/${maxIterations} ${phaseEmoji} ${phase}\n`;
  text += `*Score:* ${score}%${score >= 95 ? ' :star:' : ''}\n`;
  text += `*Tests:* ${testsPassed} passed, ${testsFailed} failed\n`;

  if (changesApplied !== undefined) {
    text += `*Fixes Applied:* ${changesApplied}\n`;
  }

  if (filesChanged && filesChanged.length > 0) {
    const filesList = filesChanged.slice(0, 5).join(', ');
    const moreCount = filesChanged.length - 5;
    text += `*Files Modified:* ${filesList}${moreCount > 0 ? ` (+${moreCount} more)` : ''}\n`;
  }

  text += `*Duration:* ${Math.round(duration / 1000)}s\n`;
  text += `*Summary:* ${summary}\n`;

  // Add error details when score is low or status indicates failure
  if (score < 95 || status === 'failed' || status === 'max-iterations') {
    text += formatTestErrors({ failures, consoleErrors, networkErrors, rawTestOutput });
  }

  if (screenshotUrl) {
    text += `*Screenshot:* ${screenshotUrl}\n`;
  }

  return sendSlackMessage({ text });
}

/**
 * Send a complete test workflow summary
 */
export async function sendTestWorkflowSummary(params: {
  repoFullName: string;
  branch: string;
  success: boolean;
  iterations: number;
  maxIterations: number;
  finalScore: number;
  passThreshold: number;
  totalDuration: number;
  screenshotUrl?: string;
  // Error details for failed tests
  failures?: TestFailureDetail[];
  consoleErrors?: string[];
  networkErrors?: string[];
  rawTestOutput?: string;
  workflowError?: string;
}): Promise<boolean> {
  const {
    repoFullName,
    branch,
    success,
    iterations,
    maxIterations,
    finalScore,
    passThreshold,
    totalDuration,
    screenshotUrl,
    failures,
    consoleErrors,
    networkErrors,
    rawTestOutput,
    workflowError,
  } = params;

  const emoji = success ? ':trophy:' : ':warning:';
  const statusText = success ? 'PASSED' : 'NEEDS ATTENTION';

  let text = `${emoji} *BranchRunner: Test Workflow ${statusText}*\n`;
  text += `*Repository:* \`${repoFullName}\`\n`;
  text += `*Branch:* \`${branch}\`\n`;
  text += `*Final Score:* ${finalScore}% (threshold: ${passThreshold}%)\n`;
  text += `*Iterations:* ${iterations}/${maxIterations}\n`;
  text += `*Total Duration:* ${Math.round(totalDuration / 1000)}s\n`;

  if (success) {
    text += `:sparkles: All tests passed!\n`;
  } else {
    text += `:point_right: Manual review recommended\n`;

    // Add workflow error if present
    if (workflowError) {
      text += `\n:boom: *Workflow Error:*\n\`${truncateForSlack(workflowError, 300)}\`\n`;
    }

    // Add detailed error information
    text += formatTestErrors({ failures, consoleErrors, networkErrors, rawTestOutput });

    // If still no error info, indicate that
    const hasAnyErrors = (failures && failures.length > 0) ||
                        (consoleErrors && consoleErrors.length > 0) ||
                        (networkErrors && networkErrors.length > 0) ||
                        rawTestOutput ||
                        workflowError;
    if (!hasAnyErrors) {
      text += `\n:question: _No specific error details captured. Check the test-agent.log in the run directory for more info._\n`;
    }
  }

  if (screenshotUrl) {
    text += `*Screenshot:* ${screenshotUrl}\n`;
  }

  return sendSlackMessage({ text });
}
