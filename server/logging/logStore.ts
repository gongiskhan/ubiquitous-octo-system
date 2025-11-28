import { readFileSync, existsSync, readdirSync, statSync, unlinkSync, rmdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { info, warn } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, '..', '..', 'data', 'logs');
const SCREENSHOTS_DIR = join(__dirname, '..', '..', 'data', 'screenshots');

export interface LogPaths {
  buildLogPath: string;
  runtimeLogPath: string;
  networkLogPath: string;
}

export function getLogPaths(
  repoFullName: string,
  branch: string,
  runId: string
): LogPaths {
  const safeName = repoFullName.replace(/\//g, '_');
  const safeBranch = branch.replace(/\//g, '_');
  const baseDir = join(LOG_DIR, safeName, safeBranch, runId);

  return {
    buildLogPath: join(baseDir, 'build.log'),
    runtimeLogPath: join(baseDir, 'runtime.log'),
    networkLogPath: join(baseDir, 'network.log'),
  };
}

export function getScreenshotPath(
  repoFullName: string,
  branch: string,
  runId: string
): string {
  const safeName = repoFullName.replace(/\//g, '_');
  const safeBranch = branch.replace(/\//g, '_');
  return join(SCREENSHOTS_DIR, safeName, safeBranch, `${runId}.png`);
}

export function readLogFile(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return readFileSync(filePath, 'utf-8');
  } catch (error) {
    warn(`Failed to read log file ${filePath}: ${error}`, 'LogStore');
    return null;
  }
}

export function readLogTail(filePath: string, lines: number = 40): string {
  const content = readLogFile(filePath);
  if (!content) {
    return '';
  }

  const allLines = content.split('\n');
  const tailLines = allLines.slice(-lines);
  return tailLines.join('\n');
}

export function getBuildLog(
  repoFullName: string,
  branch: string,
  runId: string
): string | null {
  const paths = getLogPaths(repoFullName, branch, runId);
  return readLogFile(paths.buildLogPath);
}

export function getRuntimeLog(
  repoFullName: string,
  branch: string,
  runId: string
): string | null {
  const paths = getLogPaths(repoFullName, branch, runId);
  return readLogFile(paths.runtimeLogPath);
}

export function getNetworkLog(
  repoFullName: string,
  branch: string,
  runId: string
): string | null {
  const paths = getLogPaths(repoFullName, branch, runId);
  return readLogFile(paths.networkLogPath);
}

export function listRunIds(repoFullName: string, branch: string): string[] {
  const safeName = repoFullName.replace(/\//g, '_');
  const safeBranch = branch.replace(/\//g, '_');
  const branchDir = join(LOG_DIR, safeName, safeBranch);

  if (!existsSync(branchDir)) {
    return [];
  }

  try {
    const entries = readdirSync(branchDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse();
  } catch (error) {
    warn(`Failed to list run IDs for ${repoFullName}/${branch}: ${error}`, 'LogStore');
    return [];
  }
}

export function listBranches(repoFullName: string): string[] {
  const safeName = repoFullName.replace(/\//g, '_');
  const repoDir = join(LOG_DIR, safeName);

  if (!existsSync(repoDir)) {
    return [];
  }

  try {
    const entries = readdirSync(repoDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name.replace(/_/g, '/'));
  } catch (error) {
    warn(`Failed to list branches for ${repoFullName}: ${error}`, 'LogStore');
    return [];
  }
}

function getFileAge(filePath: string): number {
  try {
    const stats = statSync(filePath);
    return Date.now() - stats.mtimeMs;
  } catch {
    return 0;
  }
}

function removeDirectoryRecursive(dirPath: string): void {
  if (!existsSync(dirPath)) return;

  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      removeDirectoryRecursive(fullPath);
    } else {
      unlinkSync(fullPath);
    }
  }
  rmdirSync(dirPath);
}

export function cleanupOldData(maxAgeDays: number = 7): { logsDeleted: number; screenshotsDeleted: number } {
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  let logsDeleted = 0;
  let screenshotsDeleted = 0;

  // Cleanup logs
  if (existsSync(LOG_DIR)) {
    const repos = readdirSync(LOG_DIR, { withFileTypes: true }).filter((e) => e.isDirectory());

    for (const repo of repos) {
      const repoPath = join(LOG_DIR, repo.name);
      const branches = readdirSync(repoPath, { withFileTypes: true }).filter((e) => e.isDirectory());

      for (const branch of branches) {
        const branchPath = join(repoPath, branch.name);
        const runs = readdirSync(branchPath, { withFileTypes: true }).filter((e) => e.isDirectory());

        for (const run of runs) {
          const runPath = join(branchPath, run.name);
          const buildLogPath = join(runPath, 'build.log');

          if (existsSync(buildLogPath) && getFileAge(buildLogPath) > maxAgeMs) {
            removeDirectoryRecursive(runPath);
            logsDeleted++;
            info(`Deleted old log directory: ${runPath}`, 'Cleanup');
          }
        }
      }
    }
  }

  // Cleanup screenshots
  if (existsSync(SCREENSHOTS_DIR)) {
    const repos = readdirSync(SCREENSHOTS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory());

    for (const repo of repos) {
      const repoPath = join(SCREENSHOTS_DIR, repo.name);
      const branches = readdirSync(repoPath, { withFileTypes: true }).filter((e) => e.isDirectory());

      for (const branch of branches) {
        const branchPath = join(repoPath, branch.name);
        const screenshots = readdirSync(branchPath).filter((f) => f.endsWith('.png'));

        for (const screenshot of screenshots) {
          const screenshotPath = join(branchPath, screenshot);

          if (getFileAge(screenshotPath) > maxAgeMs) {
            unlinkSync(screenshotPath);
            screenshotsDeleted++;
            info(`Deleted old screenshot: ${screenshotPath}`, 'Cleanup');
          }
        }
      }
    }
  }

  return { logsDeleted, screenshotsDeleted };
}

export function getScreenshotsDir(): string {
  return SCREENSHOTS_DIR;
}

export function getLogsDir(): string {
  return LOG_DIR;
}
