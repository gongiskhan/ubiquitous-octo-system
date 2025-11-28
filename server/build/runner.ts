import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getRepoConfig, addRunRecord, updateRunRecord, type RunRecord } from '../config.js';
import { info, error as logError, FileLogger } from '../logging/logger.js';
import { getLogPaths, getScreenshotPath } from '../logging/logStore.js';
import type { BuildJob } from './queue.js';
import type { ProfileContext, ProfileResult } from './profiles/profileTypes.js';
import { runIosCapacitor } from './profiles/iosCapacitor.js';
import { runWebGeneric } from './profiles/webGeneric.js';
import { runNodeService } from './profiles/nodeService.js';
import { runAndroidCapacitor } from './profiles/androidCapacitor.js';
import { runTauriApp } from './profiles/tauriApp.js';
import { sendBuildResultSuccess, sendBuildResultFailure } from '../slack/notifier.js';
import { getTailscaleIp } from '../tailscale/ip.js';

const execAsync = promisify(exec);

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');

function generateRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

async function gitSync(localPath: string, branch: string, buildLog: FileLogger): Promise<boolean> {
  const commands = [
    'git fetch origin',
    `git checkout ${branch}`,
    `git reset --hard origin/${branch}`,
  ];

  for (const cmd of commands) {
    buildLog.appendWithTimestamp(`$ ${cmd}`);

    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: localPath,
        timeout: 120000, // 2 minutes
      });

      if (stdout) buildLog.appendLine(stdout);
      if (stderr) buildLog.appendLine(stderr);
    } catch (error: unknown) {
      const err = error as { message: string; stderr?: string };
      buildLog.appendWithTimestamp(`ERROR: ${err.message}`);
      if (err.stderr) buildLog.appendLine(err.stderr);
      return false;
    }
  }

  return true;
}

export async function executeJob(job: BuildJob): Promise<void> {
  const { repoFullName, branch } = job;
  const runId = generateRunId();

  info(`Starting job execution: ${repoFullName}/${branch} (${runId})`, 'Runner');

  // Get repo config
  const repoConfig = getRepoConfig(repoFullName);
  if (!repoConfig) {
    logError(`No config found for ${repoFullName}`, 'Runner');
    return;
  }

  const { localPath, profile, devPort } = repoConfig;

  // Validate local path exists
  if (!existsSync(localPath)) {
    logError(`Local path does not exist: ${localPath}`, 'Runner');
    return;
  }

  // Set up directories
  const safeName = repoFullName.replace(/\//g, '_');
  const safeBranch = branch.replace(/\//g, '_');
  const logsDir = join(DATA_DIR, 'logs', safeName, safeBranch, runId);
  const screenshotsDir = join(DATA_DIR, 'screenshots', safeName, safeBranch);

  ensureDir(logsDir);
  ensureDir(screenshotsDir);

  // Get log paths
  const logPaths = getLogPaths(repoFullName, branch, runId);
  const screenshotPath = getScreenshotPath(repoFullName, branch, runId);

  // Create initial run record
  const runRecord: RunRecord = {
    branch,
    timestamp: new Date().toISOString(),
    runId,
    status: 'running',
    buildLogPath: logPaths.buildLogPath,
    runtimeLogPath: logPaths.runtimeLogPath,
    networkLogPath: logPaths.networkLogPath,
  };

  addRunRecord(repoFullName, runRecord);

  // Create build log
  const buildLog = new FileLogger(logPaths.buildLogPath);
  buildLog.appendWithTimestamp(`=== Build started for ${repoFullName}/${branch} ===`);
  buildLog.appendWithTimestamp(`Run ID: ${runId}`);
  buildLog.appendWithTimestamp(`Profile: ${profile}`);
  buildLog.appendWithTimestamp(`Local path: ${localPath}`);
  buildLog.appendLine('');

  try {
    // Git sync
    buildLog.appendWithTimestamp('--- Git Sync ---');
    const gitSuccess = await gitSync(localPath, branch, buildLog);

    if (!gitSuccess) {
      throw new Error('Git sync failed');
    }

    buildLog.appendLine('');
    buildLog.appendWithTimestamp('--- Running Profile ---');

    // Prepare profile context
    const context: ProfileContext = {
      repoFullName,
      branch,
      localPath,
      runId,
      logsDir,
      screenshotsDir,
      devPort,
    };

    // Run the appropriate profile
    let result: ProfileResult;

    switch (profile) {
      case 'ios-capacitor':
        result = await runIosCapacitor(context);
        break;
      case 'web-generic':
        result = await runWebGeneric(context);
        break;
      case 'node-service':
        result = await runNodeService(context);
        break;
      case 'android-capacitor':
        result = await runAndroidCapacitor(context);
        break;
      case 'tauri-app':
        result = await runTauriApp(context);
        break;
      default:
        throw new Error(`Unknown profile: ${profile}`);
    }

    buildLog.appendLine('');
    buildLog.appendWithTimestamp(`=== Build ${result.status.toUpperCase()} ===`);

    // Update run record
    updateRunRecord(repoFullName, runId, {
      status: result.status,
      screenshotPath: result.screenshotPath,
      errorMessage: result.errorMessage,
    });

    // Send Slack notification
    const tailscaleIp = await getTailscaleIp();
    const baseUrl = tailscaleIp ? `http://${tailscaleIp}:3000` : 'http://localhost:3000';
    const screenshotUrl = result.screenshotPath
      ? `${baseUrl}/preview/${encodeURIComponent(repoFullName)}/${encodeURIComponent(branch)}.png`
      : undefined;

    if (result.status === 'success') {
      await sendBuildResultSuccess({
        repoFullName,
        branch,
        screenshotUrl,
        buildLogPath: result.buildLogPath,
        runtimeLogPath: result.runtimeLogPath,
        networkLogPath: result.networkLogPath,
      });
    } else {
      await sendBuildResultFailure({
        repoFullName,
        branch,
        screenshotUrl,
        buildLogPath: result.buildLogPath,
        runtimeLogPath: result.runtimeLogPath,
        networkLogPath: result.networkLogPath,
        errorMessage: result.errorMessage || 'Unknown error',
      });
    }

    info(`Job completed with status: ${result.status}`, 'Runner');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    buildLog.appendLine('');
    buildLog.appendWithTimestamp(`=== Build FAILED ===`);
    buildLog.appendWithTimestamp(`Error: ${errorMessage}`);

    logError(`Job failed: ${errorMessage}`, 'Runner');

    // Update run record
    updateRunRecord(repoFullName, runId, {
      status: 'failure',
      errorMessage,
    });

    // Send failure notification
    await sendBuildResultFailure({
      repoFullName,
      branch,
      buildLogPath: logPaths.buildLogPath,
      errorMessage,
    });
  }
}

export async function runCommand(
  cmd: string,
  cwd: string,
  logger: FileLogger,
  timeout: number = 300000
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  logger.appendWithTimestamp(`$ ${cmd}`);

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    if (stdout) logger.appendLine(stdout);
    if (stderr) logger.appendLine(stderr);

    return { success: true, stdout, stderr };
  } catch (error: unknown) {
    const err = error as { message: string; stdout?: string; stderr?: string };
    logger.appendWithTimestamp(`ERROR: ${err.message}`);
    if (err.stdout) logger.appendLine(err.stdout);
    if (err.stderr) logger.appendLine(err.stderr);
    return { success: false, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

export function spawnProcess(
  cmd: string,
  args: string[],
  cwd: string,
  logger: FileLogger
): ReturnType<typeof spawn> {
  logger.appendWithTimestamp(`$ ${cmd} ${args.join(' ')}`);

  const proc = spawn(cmd, args, {
    cwd,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stdout?.on('data', (data) => {
    logger.append(data.toString());
  });

  proc.stderr?.on('data', (data) => {
    logger.append(data.toString());
  });

  return proc;
}
