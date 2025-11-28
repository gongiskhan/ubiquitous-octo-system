import { join } from 'path';
import { existsSync } from 'fs';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';
import { FileLogger } from '../../logging/logger.js';
import { execWithTimeout, sleep, killProcessTree } from '../../utils/timeout.js';
import { restoreNodeModules, cacheNodeModules } from '../../utils/buildCache.js';
import { performScreenshotDiff } from '../../utils/screenshotDiff.js';
import type { ProfileContext, ProfileResult, Durations } from './profileTypes.js';

const execAsync = promisify(exec);

const APP_LAUNCH_WAIT = 5000; // 5 seconds
const SCREENSHOT_TIMEOUT = 10000; // 10 seconds

async function findTauriWindow(appName: string): Promise<number | null> {
  const os = platform();

  if (os === 'darwin') {
    try {
      // Use AppleScript to find the window
      const script = `
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          if name of frontApp contains "${appName}" then
            return id of first window of frontApp
          end if
          -- Try to find by partial name match
          set matchingApps to every application process whose name contains "${appName}"
          if (count of matchingApps) > 0 then
            set targetApp to item 1 of matchingApps
            if (count of windows of targetApp) > 0 then
              return id of first window of targetApp
            end if
          end if
        end tell
        return -1
      `;

      const { stdout } = await execAsync(`osascript -e '${script}'`);
      const windowId = parseInt(stdout.trim(), 10);
      return windowId > 0 ? windowId : null;
    } catch {
      return null;
    }
  } else if (os === 'linux') {
    try {
      // Use wmctrl or xdotool on Linux
      const { stdout } = await execAsync(`xdotool search --name "${appName}" | head -1`);
      const windowId = parseInt(stdout.trim(), 10);
      return windowId > 0 ? windowId : null;
    } catch {
      return null;
    }
  }

  return null;
}

async function captureTauriScreenshot(
  appName: string,
  outputPath: string,
  buildLog: FileLogger
): Promise<boolean> {
  const os = platform();

  try {
    if (os === 'darwin') {
      // Try to capture specific window first
      const windowId = await findTauriWindow(appName);

      if (windowId) {
        // Capture specific window
        await execAsync(`screencapture -l ${windowId} "${outputPath}"`);
        buildLog.appendWithTimestamp(`Captured window ${windowId}`);
        return true;
      }

      // Fallback: capture frontmost window
      await execAsync(`screencapture -w "${outputPath}"`);
      buildLog.appendWithTimestamp('Captured frontmost window');
      return true;
    } else if (os === 'linux') {
      // Try to find and capture the window
      try {
        const { stdout } = await execAsync(`xdotool search --name "${appName}" | head -1`);
        const windowId = stdout.trim();

        if (windowId) {
          // Use import (ImageMagick) to capture window
          await execAsync(`import -window ${windowId} "${outputPath}"`);
          buildLog.appendWithTimestamp(`Captured window ${windowId}`);
          return true;
        }
      } catch {
        // Fallback to full screen
      }

      // Fallback: capture entire screen
      await execAsync(`import -window root "${outputPath}"`);
      buildLog.appendWithTimestamp('Captured full screen');
      return true;
    } else {
      buildLog.appendWithTimestamp(`Screenshot not implemented for platform: ${os}`);
      return false;
    }
  } catch (error) {
    buildLog.appendWithTimestamp(`Screenshot capture failed: ${error}`);
    return false;
  }
}

async function getAppName(localPath: string): Promise<string> {
  try {
    // Try to get name from tauri.conf.json
    const tauriConfPath = join(localPath, 'src-tauri', 'tauri.conf.json');
    if (existsSync(tauriConfPath)) {
      const conf = JSON.parse(require('fs').readFileSync(tauriConfPath, 'utf-8'));
      return conf.package?.productName || conf.productName || 'tauri-app';
    }

    // Try Cargo.toml
    const cargoPath = join(localPath, 'src-tauri', 'Cargo.toml');
    if (existsSync(cargoPath)) {
      const content = require('fs').readFileSync(cargoPath, 'utf-8');
      const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
      if (nameMatch) {
        return nameMatch[1];
      }
    }
  } catch {
    // Ignore errors
  }

  return 'tauri-app';
}

export async function runTauriApp(ctx: ProfileContext): Promise<ProfileResult> {
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

  buildLog.appendWithTimestamp('=== Tauri App Profile ===');
  buildLog.appendWithTimestamp(`Repository: ${repoFullName}`);
  buildLog.appendWithTimestamp(`Branch: ${branch}`);
  buildLog.appendWithTimestamp(`Run ID: ${runId}`);
  buildLog.appendWithTimestamp(`Platform: ${platform()}`);
  buildLog.appendLine('');

  const buildTimeout = buildOptions.buildTimeout || 240000;
  let tauriProcess: ChildProcess | null = null;

  try {
    // Check for src-tauri directory
    const tauriPath = join(localPath, 'src-tauri');
    if (!existsSync(tauriPath)) {
      throw new Error('No src-tauri/ directory found. This is not a Tauri project.');
    }

    // Check for Rust/Cargo
    try {
      await execAsync('which cargo');
    } catch {
      throw new Error('Cargo (Rust) not found in PATH. Install Rust from rustup.rs');
    }

    // Get app name for window detection
    const appName = await getAppName(localPath);
    buildLog.appendWithTimestamp(`App name: ${appName}`);

    // Step 1: Install npm dependencies
    const installStart = Date.now();
    buildLog.appendWithTimestamp('--- NPM Dependencies ---');

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

    // Step 2: Start Tauri in dev mode
    buildLog.appendLine('');
    buildLog.appendWithTimestamp('--- Starting Tauri Dev ---');

    // Launch tauri dev
    tauriProcess = spawn('npm', ['run', 'tauri', 'dev'], {
      cwd: localPath,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    // Capture output
    tauriProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      buildLog.append(output);
      runtimeLog.append(output);
    });

    tauriProcess.stderr?.on('data', (data) => {
      const output = data.toString();
      buildLog.append(output);
      runtimeLog.append(output);
    });

    // Wait for app to start and render
    buildLog.appendWithTimestamp('Waiting for Tauri app to start...');

    // Watch for signs the app is ready
    let appReady = false;
    const readyPromise = new Promise<void>((resolve) => {
      const checkOutput = (data: Buffer) => {
        const output = data.toString().toLowerCase();
        if (
          output.includes('running') ||
          output.includes('ready') ||
          output.includes('listening') ||
          output.includes('dev server')
        ) {
          appReady = true;
          resolve();
        }
      };

      tauriProcess?.stdout?.on('data', checkOutput);
      tauriProcess?.stderr?.on('data', checkOutput);

      // Timeout
      setTimeout(() => resolve(), 60000);
    });

    await Promise.race([
      readyPromise,
      sleep(60000),
    ]);

    // Additional wait for window to render
    const screenshotDelay = buildOptions.screenshotDelay || APP_LAUNCH_WAIT;
    await sleep(screenshotDelay);

    // Step 3: Capture screenshot
    buildLog.appendLine('');
    buildLog.appendWithTimestamp('--- Screenshot Capture ---');
    const screenshotStart = Date.now();

    const screenshotSuccess = await captureTauriScreenshot(appName, screenshotPath, buildLog);
    durations.screenshot = Date.now() - screenshotStart;

    // Step 4: Screenshot diff
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
    // Clean up Tauri process
    if (tauriProcess) {
      buildLog.appendWithTimestamp('Stopping Tauri app...');
      killProcessTree(tauriProcess);
      await sleep(1000);
    }
  }
}
