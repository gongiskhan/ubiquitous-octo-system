import { readLogTail } from '../logging/logStore.js';
import { info, warn, error as logError } from '../logging/logger.js';

const BUILD_LOG_TAIL_LINES = 40;
const RUNTIME_LOG_TAIL_LINES = 20;
const NETWORK_LOG_TAIL_LINES = 20;

interface BuildResultParams {
  repoFullName: string;
  branch: string;
  screenshotUrl?: string;
  buildLogPath?: string;
  runtimeLogPath?: string;
  networkLogPath?: string;
}

interface BuildFailureParams extends BuildResultParams {
  errorMessage: string;
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

function truncateForSlack(text: string, maxLength: number = 2900): string {
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
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const text = await response.text();
      logError(`Slack API error: ${response.status} ${text}`, 'Slack');
      return false;
    }

    info('Slack notification sent successfully', 'Slack');
    return true;
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

export async function sendBuildResultSuccess(params: BuildResultParams): Promise<boolean> {
  const { repoFullName, branch, screenshotUrl, buildLogPath, runtimeLogPath, networkLogPath } = params;

  let text = `:white_check_mark: *BranchRunner: Build SUCCESS*\n`;
  text += `*Repository:* \`${repoFullName}\`\n`;
  text += `*Branch:* \`${branch}\`\n`;

  if (screenshotUrl) {
    text += `*Screenshot:* ${screenshotUrl}\n`;
  }

  text += formatLogSection('Build log (last lines)', buildLogPath, BUILD_LOG_TAIL_LINES);
  text += formatLogSection('Runtime log (last lines)', runtimeLogPath, RUNTIME_LOG_TAIL_LINES);
  text += formatLogSection('Network log (last lines)', networkLogPath, NETWORK_LOG_TAIL_LINES);

  return sendSlackMessage({ text });
}

export async function sendBuildResultFailure(params: BuildFailureParams): Promise<boolean> {
  const { repoFullName, branch, screenshotUrl, buildLogPath, runtimeLogPath, networkLogPath, errorMessage } = params;

  let text = `:x: *BranchRunner: Build FAILED*\n`;
  text += `*Repository:* \`${repoFullName}\`\n`;
  text += `*Branch:* \`${branch}\`\n`;
  text += `*Error:* ${errorMessage}\n`;

  if (screenshotUrl) {
    text += `*Screenshot:* ${screenshotUrl}\n`;
  }

  text += formatLogSection('Build log (last lines)', buildLogPath, BUILD_LOG_TAIL_LINES);
  text += formatLogSection('Runtime log (last lines)', runtimeLogPath, RUNTIME_LOG_TAIL_LINES);
  text += formatLogSection('Network log (last lines)', networkLogPath, NETWORK_LOG_TAIL_LINES);

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
