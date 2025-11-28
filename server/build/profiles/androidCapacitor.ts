import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { FileLogger } from '../../logging/logger.js';
import { execWithTimeout, sleep, killProcessOnPort } from '../../utils/timeout.js';
import { restoreNodeModules, cacheNodeModules } from '../../utils/buildCache.js';
import { performScreenshotDiff } from '../../utils/screenshotDiff.js';
import type { ProfileContext, ProfileResult, Durations } from './profileTypes.js';

const execAsync = promisify(exec);

const DEFAULT_AVD = 'Pixel_7_Pro_API_34';
const EMULATOR_BOOT_TIMEOUT = 120000; // 2 minutes
const APP_LAUNCH_WAIT = 8000; // 8 seconds
const LOGCAT_DURATION = 5000; // 5 seconds

async function isEmulatorRunning(): Promise<boolean> {
  try {
    const { stdout } = await execAsync('adb devices');
    return stdout.includes('emulator') && stdout.includes('device');
  } catch {
    return false;
  }
}

async function getRunningEmulatorName(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('adb devices');
    const match = stdout.match(/emulator-(\d+)\s+device/);
    if (match) {
      return `emulator-${match[1]}`;
    }
    return null;
  } catch {
    return null;
  }
}

async function listAvailableAvds(buildLog: FileLogger): Promise<string[]> {
  try {
    const { stdout } = await execAsync('emulator -list-avds');
    const avds = stdout.trim().split('\n').filter(Boolean);
    buildLog.appendWithTimestamp(`Available AVDs: ${avds.join(', ')}`);
    return avds;
  } catch (error) {
    buildLog.appendWithTimestamp(`Failed to list AVDs: ${error}`);
    return [];
  }
}

async function startEmulator(
  avdName: string,
  buildLog: FileLogger,
  timeoutMs: number
): Promise<boolean> {
  buildLog.appendWithTimestamp(`Starting emulator with AVD: ${avdName}`);

  // Start emulator in background
  const emulatorCmd = `emulator -avd "${avdName}" -no-snapshot-save -no-audio -gpu swiftshader_indirect &`;

  try {
    exec(emulatorCmd);
  } catch {
    // Ignore - emulator starts in background
  }

  // Wait for emulator to boot
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const { stdout } = await execAsync('adb shell getprop sys.boot_completed 2>/dev/null || echo ""');
      if (stdout.trim() === '1') {
        buildLog.appendWithTimestamp('Emulator booted successfully');
        await sleep(2000); // Extra wait for UI to be ready
        return true;
      }
    } catch {
      // Emulator not ready yet
    }
    await sleep(2000);
  }

  buildLog.appendWithTimestamp('Emulator boot timed out');
  return false;
}

async function stopEmulator(buildLog: FileLogger): Promise<void> {
  try {
    await execAsync('adb emu kill 2>/dev/null || true');
    buildLog.appendWithTimestamp('Emulator stopped');
  } catch {
    // Ignore errors
  }
}

async function captureAndroidScreenshot(
  outputPath: string,
  buildLog: FileLogger
): Promise<boolean> {
  try {
    // Take screenshot on device
    await execAsync('adb shell screencap -p /sdcard/screenshot.png');

    // Pull to local
    await execAsync(`adb pull /sdcard/screenshot.png "${outputPath}"`);

    // Clean up on device
    await execAsync('adb shell rm /sdcard/screenshot.png');

    buildLog.appendWithTimestamp(`Screenshot saved to: ${outputPath}`);
    return true;
  } catch (error) {
    buildLog.appendWithTimestamp(`Screenshot capture failed: ${error}`);
    return false;
  }
}

async function captureLogcat(
  outputPath: string,
  durationMs: number,
  buildLog: FileLogger
): Promise<void> {
  try {
    // Clear logcat first
    await execAsync('adb logcat -c');

    // Capture for duration
    buildLog.appendWithTimestamp(`Capturing logcat for ${durationMs}ms...`);
    await sleep(durationMs);

    // Dump logcat to file
    await execAsync(`adb logcat -d > "${outputPath}"`);
    buildLog.appendWithTimestamp('Logcat captured');
  } catch (error) {
    buildLog.appendWithTimestamp(`Logcat capture failed: ${error}`);
  }
}

export async function runAndroidCapacitor(ctx: ProfileContext): Promise<ProfileResult> {
  const {
    repoFullName,
    branch,
    localPath,
    runId,
    logsDir,
    screenshotsDir,
    buildOptions,
  } = ctx;

  const durations: Durations = {};
  const startTime = Date.now();

  const buildLogPath = join(logsDir, 'build.log');
  const runtimeLogPath = join(logsDir, 'runtime.log');
  const buildLog = new FileLogger(buildLogPath);
  const runtimeLog = new FileLogger(runtimeLogPath);

  const screenshotPath = join(screenshotsDir, `${runId}.png`);

  buildLog.appendWithTimestamp('=== Android Capacitor Profile ===');
  buildLog.appendWithTimestamp(`Repository: ${repoFullName}`);
  buildLog.appendWithTimestamp(`Branch: ${branch}`);
  buildLog.appendWithTimestamp(`Run ID: ${runId}`);
  buildLog.appendLine('');

  const buildTimeout = buildOptions.buildTimeout || 240000;
  const runtimeTimeout = buildOptions.runtimeTimeout || 60000;
  const avdName = buildOptions.androidAvd || DEFAULT_AVD;

  let emulatorStartedByUs = false;

  try {
    // Check for Android directory
    const androidPath = join(localPath, 'android');
    if (!existsSync(androidPath)) {
      throw new Error('No android/ directory found. Run "npx cap add android" first.');
    }

    // Check for required tools
    try {
      await execAsync('which adb');
      await execAsync('which emulator');
    } catch {
      throw new Error('Android SDK tools (adb, emulator) not found in PATH');
    }

    // Step 1: Try to restore cached node_modules
    const installStart = Date.now();
    buildLog.appendWithTimestamp('--- Dependency Installation ---');

    const cacheRestored = await restoreNodeModules(repoFullName, localPath);
    if (!cacheRestored) {
      const npmResult = await execWithTimeout(
        'npm ci --prefer-offline || npm install',
        localPath,
        buildTimeout
      );

      if (!npmResult.success) {
        throw new Error(`npm install failed: ${npmResult.stderr}`);
      }

      buildLog.appendLine(npmResult.stdout);
      await cacheNodeModules(repoFullName, localPath);
    } else {
      buildLog.appendWithTimestamp('Using cached node_modules');
    }

    durations.install = Date.now() - installStart;

    // Step 2: Capacitor sync
    buildLog.appendLine('');
    buildLog.appendWithTimestamp('--- Capacitor Sync ---');

    const syncResult = await execWithTimeout(
      'npx cap sync android',
      localPath,
      buildTimeout
    );

    if (!syncResult.success) {
      throw new Error(`cap sync failed: ${syncResult.stderr}`);
    }

    buildLog.appendLine(syncResult.stdout);

    // Step 3: Check if emulator is running or start one
    buildLog.appendLine('');
    buildLog.appendWithTimestamp('--- Emulator Setup ---');

    const alreadyRunning = await isEmulatorRunning();

    if (!alreadyRunning) {
      // List available AVDs
      const avds = await listAvailableAvds(buildLog);

      if (avds.length === 0) {
        throw new Error('No Android Virtual Devices (AVDs) found. Create one with Android Studio.');
      }

      // Use configured AVD or first available
      const targetAvd = avds.includes(avdName) ? avdName : avds[0];

      const emulatorStarted = await startEmulator(targetAvd, buildLog, EMULATOR_BOOT_TIMEOUT);
      if (!emulatorStarted) {
        throw new Error('Failed to start Android emulator');
      }

      emulatorStartedByUs = true;
    } else {
      buildLog.appendWithTimestamp('Using already running emulator');
    }

    // Step 4: Build and install APK
    buildLog.appendLine('');
    buildLog.appendWithTimestamp('--- Build & Install ---');
    const buildStart = Date.now();

    const runResult = await execWithTimeout(
      'npx cap run android --no-sync',
      localPath,
      buildTimeout
    );

    if (!runResult.success && !runResult.stdout.includes('Successfully')) {
      buildLog.appendLine(runResult.stderr);
      throw new Error(`cap run android failed: ${runResult.stderr.slice(0, 200)}`);
    }

    buildLog.appendLine(runResult.stdout);
    durations.build = Date.now() - buildStart;

    // Step 5: Wait for app to launch and stabilize
    buildLog.appendLine('');
    buildLog.appendWithTimestamp('--- Waiting for App ---');

    const screenshotDelay = buildOptions.screenshotDelay || APP_LAUNCH_WAIT;
    await sleep(screenshotDelay);

    // Step 6: Capture screenshot
    buildLog.appendLine('');
    buildLog.appendWithTimestamp('--- Screenshot Capture ---');
    const screenshotStart = Date.now();

    const screenshotSuccess = await captureAndroidScreenshot(screenshotPath, buildLog);
    durations.screenshot = Date.now() - screenshotStart;

    // Step 7: Capture logcat
    buildLog.appendLine('');
    buildLog.appendWithTimestamp('--- Logcat Capture ---');

    await captureLogcat(runtimeLogPath, LOGCAT_DURATION, buildLog);

    // Step 8: Perform screenshot diff
    let diffResult;
    if (screenshotSuccess && existsSync(screenshotPath)) {
      diffResult = await performScreenshotDiff(
        repoFullName,
        branch,
        runId,
        screenshotPath,
        screenshotsDir
      );
    }

    durations.total = Date.now() - startTime;

    buildLog.appendLine('');
    buildLog.appendWithTimestamp('=== Build Completed Successfully ===');
    buildLog.appendWithTimestamp(`Total time: ${(durations.total / 1000).toFixed(1)}s`);

    return {
      status: 'success',
      screenshotPath: screenshotSuccess ? screenshotPath : undefined,
      buildLogPath,
      runtimeLogPath,
      durations,
      diffResult: diffResult || undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    durations.total = Date.now() - startTime;

    buildLog.appendLine('');
    buildLog.appendWithTimestamp('=== Build Failed ===');
    buildLog.appendWithTimestamp(`Error: ${errorMessage}`);

    return {
      status: 'failure',
      buildLogPath,
      runtimeLogPath: existsSync(runtimeLogPath) ? runtimeLogPath : undefined,
      errorMessage,
      durations,
    };
  } finally {
    // Clean up emulator if we started it
    if (emulatorStartedByUs) {
      await stopEmulator(buildLog);
    }
  }
}
