import { join } from 'path';
import { FileLogger } from '../../logging/logger.js';
import { runCommand } from '../runner.js';
import type { ProfileContext, ProfileResult } from './profileTypes.js';

export async function runNodeService(ctx: ProfileContext): Promise<ProfileResult> {
  const { localPath, logsDir } = ctx;

  const buildLogPath = join(logsDir, 'build.log');
  const runtimeLogPath = join(logsDir, 'runtime.log');

  const buildLog = new FileLogger(buildLogPath);
  const runtimeLog = new FileLogger(runtimeLogPath);

  try {
    buildLog.appendWithTimestamp('=== Node Service Profile ===');
    buildLog.appendWithTimestamp('This profile runs npm ci, npm run build (if available), and npm test.');

    // Step 1: npm ci
    buildLog.appendWithTimestamp('--- Installing dependencies ---');
    const npmResult = await runCommand('npm ci', localPath, buildLog, 300000);
    if (!npmResult.success) {
      throw new Error('npm ci failed');
    }

    // Step 2: npm run build (if script exists)
    buildLog.appendWithTimestamp('--- Building ---');
    const buildResult = await runCommand('npm run build --if-present', localPath, buildLog, 300000);
    if (!buildResult.success) {
      buildLog.appendWithTimestamp('Warning: Build step failed or not present');
    }

    // Step 3: npm test (if script exists)
    buildLog.appendWithTimestamp('--- Running tests ---');
    runtimeLog.appendWithTimestamp('=== Test Output ===');

    const testResult = await runCommand('npm test --if-present', localPath, buildLog, 300000);

    if (testResult.stdout) {
      runtimeLog.appendLine(testResult.stdout);
    }
    if (testResult.stderr) {
      runtimeLog.appendLine(testResult.stderr);
    }

    if (!testResult.success) {
      throw new Error('Tests failed');
    }

    buildLog.appendWithTimestamp('--- Build completed successfully ---');

    return {
      status: 'success',
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
      errorMessage: errMsg,
    };
  }
}
