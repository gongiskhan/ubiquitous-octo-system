import { join } from 'path';
import { FileLogger } from '../../logging/logger.js';
import type { ProfileContext, ProfileResult } from './profileTypes.js';

export async function runCustomProfile(ctx: ProfileContext): Promise<ProfileResult> {
  const { logsDir } = ctx;

  const buildLogPath = join(logsDir, 'build.log');
  const buildLog = new FileLogger(buildLogPath);

  buildLog.appendWithTimestamp('=== Custom Profile ===');
  buildLog.appendWithTimestamp('');
  buildLog.appendWithTimestamp('This profile is a placeholder for user-defined build steps.');
  buildLog.appendWithTimestamp('');
  buildLog.appendWithTimestamp('To implement custom profiles, you could:');
  buildLog.appendWithTimestamp('1. Read a branchrunner.json or .branchrunner.yml from the repo');
  buildLog.appendWithTimestamp('2. Execute the defined build/run/screenshot steps');
  buildLog.appendWithTimestamp('3. Allow custom scripts and commands');
  buildLog.appendWithTimestamp('');
  buildLog.appendWithTimestamp('Returning failure status as profile is not implemented.');

  return {
    status: 'failure',
    buildLogPath,
    errorMessage: 'Custom profile is not yet implemented',
  };
}
