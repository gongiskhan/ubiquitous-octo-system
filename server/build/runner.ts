import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Server port - must match server/index.ts
const SERVER_PORT = parseInt(process.env.PORT || '3892', 10);
import {
  getRepoConfig,
  addRunRecord,
  updateRunRecord,
  getEffectiveBuildOptions,
  getEffectiveTestingConfig,
  type RunRecord,
  type DiffResult,
  type TestingConfig,
} from '../config.js';
import { info, warn, error as logError, FileLogger } from '../logging/logger.js';
import { getLogPaths, getScreenshotPath } from '../logging/logStore.js';
import type { BuildJob } from './queue.js';
import type { ProfileContext, ProfileResult, Durations } from './profiles/profileTypes.js';
import { runIosCapacitor } from './profiles/iosCapacitor.js';
import { runWebGeneric } from './profiles/webGeneric.js';
import { runNodeService } from './profiles/nodeService.js';
import { runAndroidCapacitor } from './profiles/androidCapacitor.js';
import { runTauriApp } from './profiles/tauriApp.js';
import {
  sendBuildResultSuccess,
  sendBuildResultFailure,
  sendTestIterationNotification,
  sendTestWorkflowSummary,
} from '../slack/notifier.js';
import { getTailscaleIp } from '../tailscale/ip.js';
import { ensureRepoCloned, gitSyncWithRecovery, cleanOrphanedBranches, getLastCommitInfo } from '../utils/repoManager.js';
import { analyzeLogFile } from '../utils/errorAnalyzer.js';
import { executeTestAndFix } from '../agents/workflows/test-and-fix.js';
import type { AgentContext } from '../agents/types.js';

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

interface RunMetadata {
  repoFullName: string;
  branch: string;
  runId: string;
  timestamp: string;
  status: 'success' | 'failure' | 'running';
  profile: string;
  durations?: Durations;
  screenshotPath?: string;
  diffResult?: DiffResult;
  errorMessage?: string;
  errorSummary?: {
    errorLines: string[];
    warningCount: number;
  };
  buildLogPath: string;
  runtimeLogPath?: string;
  networkLogPath?: string;
}

function saveRunMetadata(logsDir: string, metadata: RunMetadata): void {
  const metadataPath = join(logsDir, 'run.json');
  try {
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  } catch (error) {
    warn(`Failed to save run metadata: ${error}`, 'Runner');
  }
}

export async function executeJob(job: BuildJob): Promise<void> {
  const { repoFullName, branch } = job;
  const runId = generateRunId();
  const startTime = Date.now();

  info(`Starting job execution: ${repoFullName}/${branch} (${runId})`, 'Runner');

  // Get repo config
  let repoConfig = getRepoConfig(repoFullName);
  if (!repoConfig) {
    logError(`No config found for ${repoFullName}`, 'Runner');
    return;
  }

  // Set up directories early for logging
  const safeName = repoFullName.replace(/\//g, '_');
  const safeBranch = branch.replace(/\//g, '_');
  const logsDir = join(DATA_DIR, 'logs', safeName, safeBranch, runId);
  const screenshotsDir = join(DATA_DIR, 'screenshots', safeName, safeBranch);

  ensureDir(logsDir);
  ensureDir(screenshotsDir);

  // Get log paths
  const logPaths = getLogPaths(repoFullName, branch, runId);
  const screenshotPath = getScreenshotPath(repoFullName, branch, runId);

  // Create build log early
  const buildLog = new FileLogger(logPaths.buildLogPath);

  // Create initial run record
  const runRecord: RunRecord = {
    branch,
    timestamp: new Date().toISOString(),
    runId,
    status: 'running',
    buildLogPath: logPaths.buildLogPath,
    runtimeLogPath: logPaths.runtimeLogPath,
    networkLogPath: logPaths.networkLogPath,
    runJsonPath: join(logsDir, 'run.json'),
  };

  addRunRecord(repoFullName, runRecord);

  const { profile, devPort } = repoConfig;
  const buildOptions = getEffectiveBuildOptions(repoConfig);

  buildLog.appendWithTimestamp(`=== Build started for ${repoFullName}/${branch} ===`);
  buildLog.appendWithTimestamp(`Run ID: ${runId}`);
  buildLog.appendWithTimestamp(`Profile: ${profile}`);
  buildLog.appendWithTimestamp(`Build options: ${JSON.stringify(buildOptions)}`);
  buildLog.appendLine('');

  const durations: Durations = {};

  try {
    // Step 1: Ensure repo is cloned
    buildLog.appendWithTimestamp('--- Repository Setup ---');

    try {
      repoConfig = await ensureRepoCloned(repoConfig);
      buildLog.appendWithTimestamp(`Local path: ${repoConfig.localPath}`);
    } catch (error) {
      throw new Error(`Failed to clone repository: ${error}`);
    }

    const { localPath } = repoConfig;

    // Validate local path exists
    if (!existsSync(localPath)) {
      throw new Error(`Local path does not exist: ${localPath}`);
    }

    // Step 2: Git sync with recovery
    buildLog.appendLine('');
    buildLog.appendWithTimestamp('--- Git Sync ---');
    const gitStart = Date.now();

    const gitResult = await gitSyncWithRecovery(localPath, branch, buildLog);
    durations.git = Date.now() - gitStart;

    if (!gitResult.success) {
      throw new Error('Git sync failed');
    }

    if (gitResult.recoveryAttempted) {
      buildLog.appendWithTimestamp('Recovery was attempted during git sync');
    }

    // Clean orphaned branches periodically
    await cleanOrphanedBranches(localPath, buildLog);

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
      buildOptions,
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

    // Merge durations
    if (result.durations) {
      Object.assign(durations, result.durations);
    }
    durations.total = Date.now() - startTime;

    buildLog.appendLine('');
    buildLog.appendWithTimestamp(`=== Build ${result.status.toUpperCase()} ===`);
    buildLog.appendWithTimestamp(`Total time: ${(durations.total / 1000).toFixed(1)}s`);

    // Analyze logs for error summary
    let errorSummary;
    if (result.status === 'failure' && result.buildLogPath) {
      errorSummary = analyzeLogFile(result.buildLogPath);
    }

    // Update run record
    updateRunRecord(repoFullName, runId, {
      status: result.status,
      screenshotPath: result.screenshotPath,
      errorMessage: result.errorMessage,
      diffResult: result.diffResult,
      durations,
      errorSummary: errorSummary ? {
        errorLines: errorSummary.errorLines,
        warningCount: errorSummary.warningCount,
      } : undefined,
    });

    // Save run metadata
    saveRunMetadata(logsDir, {
      repoFullName,
      branch,
      runId,
      timestamp: new Date().toISOString(),
      status: result.status,
      profile,
      durations,
      screenshotPath: result.screenshotPath,
      diffResult: result.diffResult,
      errorMessage: result.errorMessage,
      errorSummary: errorSummary ? {
        errorLines: errorSummary.errorLines,
        warningCount: errorSummary.warningCount,
      } : undefined,
      buildLogPath: result.buildLogPath,
      runtimeLogPath: result.runtimeLogPath,
      networkLogPath: result.networkLogPath,
    });

    // Send Slack notification
    const tailscaleIp = await getTailscaleIp();
    const baseUrl = tailscaleIp ? `http://${tailscaleIp}:${SERVER_PORT}` : `http://localhost:${SERVER_PORT}`;
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
        diffResult: result.diffResult,
        durations,
      });

      // Run testing workflow if enabled
      const testingConfig = getEffectiveTestingConfig(repoConfig);
      if (testingConfig.enabled) {
        buildLog.appendLine('');
        buildLog.appendWithTimestamp('=== Starting Testing Workflow ===');

        // Get commit info for context
        const commitInfo = await getLastCommitInfo(repoConfig.localPath);

        // Prepare agent context
        const agentContext: AgentContext = {
          repoFullName,
          projectPath: repoConfig.localPath,
          branch,
          commitMessage: commitInfo?.message,
          changedFiles: commitInfo?.files,
          testingConfig: {
            enabled: testingConfig.enabled,
            testingUrl: testingConfig.testingUrl || (devPort ? `http://localhost:${devPort}` : undefined),
            maxIterations: testingConfig.maxIterations,
            passThreshold: testingConfig.passThreshold,
            testingProfile: testingConfig.testingProfile,
            credentials: testingConfig.credentials,
            mobileConfig: testingConfig.mobileConfig,
          },
          runId,
          logsDir,
          screenshotsDir,
        };

        // Execute test-and-fix workflow with Slack notifications
        const testWorkflowResult = await executeTestAndFix({
          context: agentContext,
          onSlackNotify: async (params) => {
            await sendTestIterationNotification({
              ...params,
              screenshotUrl,
            });
          },
        });

        buildLog.appendWithTimestamp(`Testing workflow completed: ${testWorkflowResult.success ? 'PASSED' : 'NEEDS ATTENTION'}`);
        buildLog.appendWithTimestamp(`Final score: ${testWorkflowResult.finalScore}%`);
        buildLog.appendWithTimestamp(`Iterations: ${testWorkflowResult.iterations.length}`);
        buildLog.appendWithTimestamp(`Duration: ${(testWorkflowResult.duration / 1000).toFixed(1)}s`);

        // Send final workflow summary
        await sendTestWorkflowSummary({
          repoFullName,
          branch,
          success: testWorkflowResult.success,
          iterations: testWorkflowResult.iterations.length,
          maxIterations: testingConfig.maxIterations,
          finalScore: testWorkflowResult.finalScore,
          passThreshold: testingConfig.passThreshold,
          totalDuration: testWorkflowResult.duration,
          screenshotUrl,
        });
      }
    } else {
      await sendBuildResultFailure({
        repoFullName,
        branch,
        screenshotUrl,
        buildLogPath: result.buildLogPath,
        runtimeLogPath: result.runtimeLogPath,
        networkLogPath: result.networkLogPath,
        errorMessage: result.errorMessage || 'Unknown error',
        errorSummary,
        durations,
      });
    }

    info(`Job completed with status: ${result.status}`, 'Runner');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    durations.total = Date.now() - startTime;

    buildLog.appendLine('');
    buildLog.appendWithTimestamp(`=== Build FAILED ===`);
    buildLog.appendWithTimestamp(`Error: ${errorMessage}`);

    logError(`Job failed: ${errorMessage}`, 'Runner');

    // Analyze logs
    const errorSummary = analyzeLogFile(logPaths.buildLogPath);

    // Update run record
    updateRunRecord(repoFullName, runId, {
      status: 'failure',
      errorMessage,
      durations,
      errorSummary: errorSummary ? {
        errorLines: errorSummary.errorLines,
        warningCount: errorSummary.warningCount,
      } : undefined,
    });

    // Save run metadata
    saveRunMetadata(logsDir, {
      repoFullName,
      branch,
      runId,
      timestamp: new Date().toISOString(),
      status: 'failure',
      profile,
      durations,
      errorMessage,
      errorSummary: errorSummary ? {
        errorLines: errorSummary.errorLines,
        warningCount: errorSummary.warningCount,
      } : undefined,
      buildLogPath: logPaths.buildLogPath,
      runtimeLogPath: logPaths.runtimeLogPath,
      networkLogPath: logPaths.networkLogPath,
    });

    // Send failure notification
    await sendBuildResultFailure({
      repoFullName,
      branch,
      buildLogPath: logPaths.buildLogPath,
      errorMessage,
      errorSummary,
      durations,
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
      maxBuffer: 50 * 1024 * 1024, // 50MB
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
    detached: true,
  });

  proc.stdout?.on('data', (data) => {
    logger.append(data.toString());
  });

  proc.stderr?.on('data', (data) => {
    logger.append(data.toString());
  });

  return proc;
}
