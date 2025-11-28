import { join } from 'path';
import { FileLogger } from '../../logging/logger.js';
import { runCommand, spawnProcess } from '../runner.js';
import type { ProfileContext, ProfileResult } from './profileTypes.js';

const DEFAULT_SIMULATOR = 'iPhone 15 Pro';
const LOG_STREAM_DURATION = 10000; // 10 seconds
const APP_LAUNCH_DELAY = 8000; // 8 seconds

export async function runIosCapacitor(ctx: ProfileContext): Promise<ProfileResult> {
  const { localPath, branch, runId, logsDir, screenshotsDir } = ctx;

  const buildLogPath = join(logsDir, 'build.log');
  const runtimeLogPath = join(logsDir, 'runtime.log');
  const screenshotPath = join(screenshotsDir, `${runId}.png`);

  const buildLog = new FileLogger(buildLogPath);
  const runtimeLog = new FileLogger(runtimeLogPath);

  let hasError = false;
  let errorMessage: string | undefined;

  try {
    // Step 1: npm ci
    buildLog.appendWithTimestamp('--- Installing dependencies ---');
    const npmResult = await runCommand('npm ci', localPath, buildLog, 300000);
    if (!npmResult.success) {
      hasError = true;
      errorMessage = 'npm ci failed';
      throw new Error(errorMessage);
    }

    // Step 2: Capacitor sync
    buildLog.appendWithTimestamp('--- Syncing Capacitor iOS ---');
    const syncResult = await runCommand('npx cap sync ios', localPath, buildLog, 300000);
    if (!syncResult.success) {
      hasError = true;
      errorMessage = 'Capacitor sync failed';
      throw new Error(errorMessage);
    }

    // Step 3: Boot simulator
    buildLog.appendWithTimestamp(`--- Booting simulator (${DEFAULT_SIMULATOR}) ---`);

    // First, try to shutdown any existing booted state
    await runCommand(`xcrun simctl shutdown "${DEFAULT_SIMULATOR}" 2>/dev/null || true`, localPath, buildLog);

    // Boot the simulator
    await runCommand(`xcrun simctl boot "${DEFAULT_SIMULATOR}" 2>/dev/null || true`, localPath, buildLog);

    // Wait for boot to complete
    const bootResult = await runCommand(
      `xcrun simctl bootstatus "${DEFAULT_SIMULATOR}" -b`,
      localPath,
      buildLog,
      120000
    );

    if (!bootResult.success) {
      buildLog.appendWithTimestamp('Warning: Boot status check failed, continuing anyway');
    }

    // Step 4: Run the app on simulator
    buildLog.appendWithTimestamp('--- Running app on simulator ---');
    const runResult = await runCommand(
      `npx cap run ios --target "${DEFAULT_SIMULATOR}" --no-open`,
      localPath,
      buildLog,
      600000 // 10 minutes for build
    );

    if (!runResult.success) {
      buildLog.appendWithTimestamp('Warning: cap run may have failed, will still attempt screenshot');
    }

    // Step 5: Wait for app to launch
    buildLog.appendWithTimestamp(`--- Waiting ${APP_LAUNCH_DELAY / 1000}s for app to launch ---`);
    await new Promise((resolve) => setTimeout(resolve, APP_LAUNCH_DELAY));

    // Step 6: Take screenshot
    buildLog.appendWithTimestamp('--- Taking screenshot ---');
    const screenshotResult = await runCommand(
      `xcrun simctl io booted screenshot "${screenshotPath}"`,
      localPath,
      buildLog
    );

    if (!screenshotResult.success) {
      buildLog.appendWithTimestamp('Warning: Screenshot capture may have failed');
    }

    // Step 7: Capture iOS logs
    buildLog.appendWithTimestamp(`--- Capturing device logs for ${LOG_STREAM_DURATION / 1000}s ---`);
    runtimeLog.appendWithTimestamp('=== iOS Simulator Logs ===');

    await new Promise<void>((resolve) => {
      const logProcess = spawnProcess(
        'xcrun',
        ['simctl', 'spawn', 'booted', 'log', 'stream', '--level=info'],
        localPath,
        runtimeLog
      );

      const timeout = setTimeout(() => {
        logProcess.kill('SIGTERM');
        resolve();
      }, LOG_STREAM_DURATION);

      logProcess.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      logProcess.on('error', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    buildLog.appendWithTimestamp('--- Build completed successfully ---');

    return {
      status: 'success',
      screenshotPath,
      buildLogPath,
      runtimeLogPath,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    buildLog.appendWithTimestamp(`ERROR: ${errMsg}`);

    return {
      status: 'failure',
      buildLogPath,
      runtimeLogPath,
      errorMessage: errorMessage || errMsg,
    };
  }
}
