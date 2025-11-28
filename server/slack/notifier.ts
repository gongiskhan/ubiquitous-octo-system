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
