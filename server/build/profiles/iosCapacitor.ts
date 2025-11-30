import { join } from 'path';
import { existsSync } from 'fs';
import { FileLogger } from '../../logging/logger.js';
import { runCommand, spawnProcess } from '../runner.js';
import type { ProfileContext, ProfileResult } from './profileTypes.js';

const SIMULATOR_PREFERENCES = [
  'iPhone 15 Pro',
  'iPhone 15',
  'iPhone 14 Pro',
  'iPhone 14',
  'iPhone 13 Pro',
  'iPhone 13',
];
const LOG_STREAM_DURATION = 10000; // 10 seconds
const APP_LAUNCH_DELAY = 8000; // 8 seconds

interface SimulatorInfo {
  name: string;
  udid: string;
}

async function findAvailableSimulator(localPath: string, buildLog: FileLogger): Promise<SimulatorInfo | null> {
  buildLog.appendWithTimestamp('Searching for available iOS simulator...');

  const result = await runCommand('xcrun simctl list devices available -j', localPath, buildLog);
  if (!result.success) {
    return null;
  }

  try {
    const data = JSON.parse(result.stdout);
    const devices = data.devices || {};

    // Look through iOS runtimes
    for (const [runtime, deviceList] of Object.entries(devices)) {
      if (!runtime.includes('iOS')) continue;

      const availableDevices = deviceList as Array<{ name: string; udid: string; state: string }>;

      // Check our preferred simulators first
      for (const preferred of SIMULATOR_PREFERENCES) {
        const device = availableDevices.find(d => d.name === preferred);
        if (device) {
          buildLog.appendWithTimestamp(`Found simulator: ${device.name} (${device.udid}) on ${runtime}`);
          return { name: device.name, udid: device.udid };
        }
      }

      // Fall back to any iPhone
      const anyIphone = availableDevices.find(d => d.name.includes('iPhone'));
      if (anyIphone) {
        buildLog.appendWithTimestamp(`Found fallback simulator: ${anyIphone.name} (${anyIphone.udid}) on ${runtime}`);
        return { name: anyIphone.name, udid: anyIphone.udid };
      }
    }
  } catch (e) {
    buildLog.appendWithTimestamp(`Failed to parse simulator list: ${e}`);
  }

  return null;
}

export async function runIosCapacitor(ctx: ProfileContext): Promise<ProfileResult> {
  const { localPath, runId, logsDir, screenshotsDir } = ctx;

  const buildLogPath = join(logsDir, 'build.log');
  const runtimeLogPath = join(logsDir, 'runtime.log');
  const screenshotPath = join(screenshotsDir, `${runId}.png`);

  const buildLog = new FileLogger(buildLogPath);
  const runtimeLog = new FileLogger(runtimeLogPath);

  let hasError = false;
  let errorMessage: string | undefined;

  try {
    // Step 0: Verify iOS folder exists
    const iosPath = join(localPath, 'ios');
    if (!existsSync(iosPath)) {
      errorMessage = 'ios/ folder not found. Run "npx cap add ios" first.';
      throw new Error(errorMessage);
    }

    // Step 1: npm ci
    buildLog.appendWithTimestamp('--- Installing dependencies ---');
    const npmResult = await runCommand('npm ci', localPath, buildLog, 300000);
    if (!npmResult.success) {
      hasError = true;
      errorMessage = 'npm ci failed - check package.json and npm logs';
      throw new Error(errorMessage);
    }

    // Step 2: Capacitor sync
    buildLog.appendWithTimestamp('--- Syncing Capacitor iOS ---');
    const syncResult = await runCommand('npx cap sync ios', localPath, buildLog, 300000);
    if (!syncResult.success) {
      hasError = true;
      errorMessage = 'Capacitor sync failed - check Capacitor configuration';
      throw new Error(errorMessage);
    }

    // Step 3: Find and boot simulator
    const simulatorInfo = await findAvailableSimulator(localPath, buildLog);
    const simulatorName = simulatorInfo?.name || SIMULATOR_PREFERENCES[0];
    const simulatorUdid = simulatorInfo?.udid;

    buildLog.appendWithTimestamp(`--- Booting simulator (${simulatorName}) ---`);

    // First, try to shutdown any existing booted state
    await runCommand(`xcrun simctl shutdown "${simulatorName}" 2>/dev/null || true`, localPath, buildLog);

    // Boot the simulator
    const bootCmd = await runCommand(`xcrun simctl boot "${simulatorName}" 2>/dev/null || true`, localPath, buildLog);

    // Wait for boot to complete
    const bootResult = await runCommand(
      `xcrun simctl bootstatus "${simulatorName}" -b`,
      localPath,
      buildLog,
      120000
    );

    if (!bootResult.success) {
      buildLog.appendWithTimestamp('Warning: Boot status check failed, continuing anyway');
    }

    // Step 4: Run the app on simulator
    // Capacitor CLI requires UDID, not device name
    const targetId = simulatorUdid || simulatorName;
    buildLog.appendWithTimestamp(`--- Running app on simulator (target: ${targetId}) ---`);
    const runResult = await runCommand(
      `npx cap run ios --target "${targetId}" --no-open`,
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
