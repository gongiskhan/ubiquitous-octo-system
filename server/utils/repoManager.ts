import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { getCloneBaseDir, updateRepoConfig, type RepoConfig } from '../config.js';
import { info, warn, error as logError, FileLogger } from '../logging/logger.js';
import { execWithTimeout, killProcessTree, sleep, retryWithBackoff } from './timeout.js';

const execAsync = promisify(exec);

export interface CloneResult {
  success: boolean;
  localPath: string;
  message: string;
}

export async function cloneRepo(
  repoFullName: string,
  targetPath?: string
): Promise<CloneResult> {
  const githubToken = process.env.GITHUB_TOKEN;

  if (!githubToken) {
    return {
      success: false,
      localPath: '',
      message: 'GITHUB_TOKEN not set',
    };
  }

  const baseDir = targetPath || getCloneBaseDir();
  const [owner, repo] = repoFullName.split('/');
  const localPath = join(baseDir, owner, repo);

  info(`Cloning ${repoFullName} to ${localPath}`, 'RepoManager');

  // Ensure base directory exists
  const parentDir = dirname(localPath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  // Check if already cloned
  if (existsSync(join(localPath, '.git'))) {
    info(`Repository already exists at ${localPath}`, 'RepoManager');
    return {
      success: true,
      localPath,
      message: 'Repository already exists',
    };
  }

  // Clone using HTTPS with token
  const cloneUrl = `https://${githubToken}@github.com/${repoFullName}.git`;

  try {
    const result = await execWithTimeout(
      `git clone --depth=1 "${cloneUrl}" "${localPath}"`,
      parentDir,
      300000 // 5 minutes
    );

    if (!result.success) {
      logError(`Clone failed: ${result.stderr}`, 'RepoManager');
      return {
        success: false,
        localPath: '',
        message: `Clone failed: ${result.stderr}`,
      };
    }

    info(`Successfully cloned ${repoFullName}`, 'RepoManager');

    // Run npm install if package.json exists
    const packageJsonPath = join(localPath, 'package.json');
    if (existsSync(packageJsonPath)) {
      info(`Running npm install for ${repoFullName}`, 'RepoManager');

      const installResult = await execWithTimeout(
        'npm ci --prefer-offline || npm install',
        localPath,
        300000 // 5 minutes
      );

      if (!installResult.success) {
        warn(`npm install failed: ${installResult.stderr}`, 'RepoManager');
      } else {
        info(`npm install completed for ${repoFullName}`, 'RepoManager');
      }
    }

    return {
      success: true,
      localPath,
      message: 'Repository cloned successfully',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`Clone error: ${message}`, 'RepoManager');
    return {
      success: false,
      localPath: '',
      message,
    };
  }
}

export async function ensureRepoCloned(repo: RepoConfig): Promise<RepoConfig> {
  // If localPath exists and is a git repo, we're good
  if (repo.localPath && existsSync(join(repo.localPath, '.git'))) {
    return repo;
  }

  // Clone the repo
  const result = await cloneRepo(repo.repoFullName);

  if (result.success) {
    // Update repo config with new local path
    const updated = updateRepoConfig(repo.repoFullName, {
      localPath: result.localPath,
      autoCloned: true,
    });
    return updated || repo;
  }

  throw new Error(`Failed to clone repo: ${result.message}`);
}

export interface PortDetectionResult {
  port: number;
  confidence: 'high' | 'medium' | 'low';
  source: string;
}

export function detectPortFromPackageJson(localPath: string): PortDetectionResult | null {
  const packageJsonPath = join(localPath, 'package.json');

  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const scripts = packageJson.scripts || {};
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    // Check scripts for explicit port
    const devScript = scripts.dev || scripts.start || scripts.serve || '';

    // Pattern: --port 3000, --port=3000, -p 3000, -p=3000, PORT=3000
    const portMatch = devScript.match(/(?:--port[= ]|PORT=|-p[= ]?)(\d+)/i);
    if (portMatch) {
      return {
        port: parseInt(portMatch[1], 10),
        confidence: 'high',
        source: 'package.json scripts',
      };
    }

    // Check for Vite config
    if (deps.vite || existsSync(join(localPath, 'vite.config.ts')) || existsSync(join(localPath, 'vite.config.js'))) {
      // Try to parse vite config for port
      const viteConfigs = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'];
      for (const configFile of viteConfigs) {
        const configPath = join(localPath, configFile);
        if (existsSync(configPath)) {
          try {
            const content = readFileSync(configPath, 'utf-8');
            const vitePortMatch = content.match(/port:\s*(\d+)/);
            if (vitePortMatch) {
              return {
                port: parseInt(vitePortMatch[1], 10),
                confidence: 'high',
                source: `${configFile}`,
              };
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      return {
        port: 5173,
        confidence: 'medium',
        source: 'Vite default',
      };
    }

    // Check for Next.js
    if (deps.next) {
      return {
        port: 3000,
        confidence: 'medium',
        source: 'Next.js default',
      };
    }

    // Check for Angular
    if (deps['@angular/core'] || deps['@angular/cli']) {
      return {
        port: 4200,
        confidence: 'medium',
        source: 'Angular default',
      };
    }

    // Check for create-react-app
    if (deps['react-scripts']) {
      return {
        port: 3000,
        confidence: 'medium',
        source: 'Create React App default',
      };
    }

    // Check for Vue CLI
    if (deps['@vue/cli-service']) {
      return {
        port: 8080,
        confidence: 'medium',
        source: 'Vue CLI default',
      };
    }

    // Check for Nuxt
    if (deps.nuxt) {
      return {
        port: 3000,
        confidence: 'medium',
        source: 'Nuxt default',
      };
    }

    // Check for SvelteKit
    if (deps['@sveltejs/kit']) {
      return {
        port: 5173,
        confidence: 'medium',
        source: 'SvelteKit default',
      };
    }

    // Default fallback
    return {
      port: 3000,
      confidence: 'low',
      source: 'Default assumption',
    };
  } catch (error) {
    return null;
  }
}

export async function detectPortDynamically(
  localPath: string,
  logger: FileLogger,
  timeoutMs: number = 30000
): Promise<PortDetectionResult | null> {
  const packageJsonPath = join(localPath, 'package.json');

  if (!existsSync(packageJsonPath)) {
    return null;
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const scripts = packageJson.scripts || {};

  // Find the dev script
  const devCommand = scripts.dev ? 'npm run dev' :
                     scripts.start ? 'npm run start' :
                     scripts.serve ? 'npm run serve' : null;

  if (!devCommand) {
    return null;
  }

  logger.appendWithTimestamp(`Starting dev server to detect port: ${devCommand}`);

  const proc = spawn('npm', ['run', devCommand.split(' ').pop()!], {
    cwd: localPath,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  let detectedPort: number | null = null;
  const startTime = Date.now();

  const portPromise = new Promise<number | null>((resolve) => {
    const checkOutput = (data: Buffer) => {
      const output = data.toString();
      logger.append(output);

      // Match common patterns like:
      // - http://localhost:3000
      // - http://127.0.0.1:5173
      // - Local: http://localhost:4200
      // - Server running at http://localhost:8080
      const portMatch = output.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i);
      if (portMatch && !detectedPort) {
        detectedPort = parseInt(portMatch[1], 10);
        resolve(detectedPort);
      }
    };

    proc.stdout?.on('data', checkOutput);
    proc.stderr?.on('data', checkOutput);

    proc.on('exit', () => {
      resolve(null);
    });

    // Timeout
    setTimeout(() => {
      if (!detectedPort) {
        resolve(null);
      }
    }, timeoutMs);
  });

  try {
    const port = await portPromise;

    // Clean up the process
    killProcessTree(proc);
    await sleep(500);

    if (port) {
      logger.appendWithTimestamp(`Detected port: ${port}`);
      return {
        port,
        confidence: 'high',
        source: 'Dynamic detection',
      };
    }
  } catch (error) {
    killProcessTree(proc);
  }

  return null;
}

export async function gitFetchWithRetry(
  localPath: string,
  logger: FileLogger,
  maxRetries: number = 3
): Promise<boolean> {
  return retryWithBackoff(
    async () => {
      const result = await execWithTimeout(
        'git fetch origin --prune',
        localPath,
        60000 // 1 minute
      );

      if (!result.success) {
        throw new Error(result.stderr);
      }

      logger.appendWithTimestamp('Git fetch succeeded');
      return true;
    },
    {
      maxRetries,
      initialDelayMs: 2000,
      maxDelayMs: 16000,
    }
  ).catch((error) => {
    logger.appendWithTimestamp(`Git fetch failed after ${maxRetries} retries: ${error.message}`);
    return false;
  });
}

export async function gitSyncWithRecovery(
  localPath: string,
  branch: string,
  logger: FileLogger
): Promise<{ success: boolean; recoveryAttempted: boolean }> {
  // First, fetch with retry
  const fetchSuccess = await gitFetchWithRetry(localPath, logger);

  if (!fetchSuccess) {
    return { success: false, recoveryAttempted: false };
  }

  // Try to checkout the branch
  let result = await execWithTimeout(
    `git checkout ${branch}`,
    localPath,
    30000
  );

  if (!result.success) {
    // Branch might not exist, try creating from origin
    logger.appendWithTimestamp(`Checkout failed, trying to create branch from origin/${branch}`);

    result = await execWithTimeout(
      `git checkout -b ${branch} origin/${branch} || git checkout ${branch}`,
      localPath,
      30000
    );

    if (!result.success) {
      // Branch might be deleted on remote, fall back to main
      logger.appendWithTimestamp(`Branch ${branch} not found, falling back to main`);

      result = await execWithTimeout(
        'git checkout main || git checkout master',
        localPath,
        30000
      );

      if (!result.success) {
        return { success: false, recoveryAttempted: true };
      }
    }
  }

  // Hard reset to origin
  result = await execWithTimeout(
    `git reset --hard origin/${branch} 2>/dev/null || git reset --hard HEAD`,
    localPath,
    30000
  );

  if (!result.success) {
    // Try recovery: clean working directory
    logger.appendWithTimestamp('Reset failed, attempting recovery...');

    await execWithTimeout('git clean -fd', localPath, 30000);
    await execWithTimeout('git checkout -- .', localPath, 30000);

    result = await execWithTimeout(
      `git reset --hard origin/${branch} 2>/dev/null || git reset --hard HEAD`,
      localPath,
      30000
    );

    return { success: result.success, recoveryAttempted: true };
  }

  logger.appendWithTimestamp(`Synced to ${branch}`);
  return { success: true, recoveryAttempted: false };
}

export async function cleanOrphanedBranches(
  localPath: string,
  logger: FileLogger
): Promise<string[]> {
  const deletedBranches: string[] = [];

  try {
    // Get list of local branches that don't exist on remote
    const result = await execWithTimeout(
      'git branch -vv | grep ": gone]" | awk \'{print $1}\'',
      localPath,
      30000
    );

    if (result.success && result.stdout.trim()) {
      const orphanedBranches = result.stdout.trim().split('\n').filter(Boolean);

      for (const branch of orphanedBranches) {
        const cleanBranch = branch.replace('*', '').trim();
        if (cleanBranch && cleanBranch !== 'main' && cleanBranch !== 'master') {
          const deleteResult = await execWithTimeout(
            `git branch -D "${cleanBranch}"`,
            localPath,
            10000
          );

          if (deleteResult.success) {
            deletedBranches.push(cleanBranch);
            logger.appendWithTimestamp(`Deleted orphaned branch: ${cleanBranch}`);
          }
        }
      }
    }
  } catch (error) {
    logger.appendWithTimestamp(`Error cleaning orphaned branches: ${error}`);
  }

  return deletedBranches;
}

export async function resetToMain(
  localPath: string,
  logger: FileLogger
): Promise<boolean> {
  try {
    await execWithTimeout('git fetch origin', localPath, 60000);

    // Try main first, then master
    let result = await execWithTimeout(
      'git checkout main && git reset --hard origin/main',
      localPath,
      30000
    );

    if (!result.success) {
      result = await execWithTimeout(
        'git checkout master && git reset --hard origin/master',
        localPath,
        30000
      );
    }

    if (result.success) {
      logger.appendWithTimestamp('Reset to main branch');
      return true;
    }

    return false;
  } catch (error) {
    logger.appendWithTimestamp(`Failed to reset to main: ${error}`);
    return false;
  }
}

export function deleteClonedRepo(localPath: string): boolean {
  try {
    if (existsSync(localPath)) {
      rmSync(localPath, { recursive: true, force: true });
      return true;
    }
    return false;
  } catch (error) {
    logError(`Failed to delete repo at ${localPath}: ${error}`, 'RepoManager');
    return false;
  }
}
