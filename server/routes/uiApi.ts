import { Router, Request, Response, NextFunction } from 'express';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { spawn, ChildProcess } from 'child_process';
import {
  getConfigs,
  getRepoConfig,
  addRepoConfig,
  updateRepoConfig,
  deleteRepoConfig,
  getWebhookBaseUrl,
  setWebhookBaseUrl,
  getCloneBaseDir,
  setCloneBaseDir,
  isCacheEnabled,
  setCacheEnabled,
  getDefaultBuildOptions,
  setDefaultBuildOptions,
  getRunsByBranch,
  getSavedCommands,
  addSavedCommand,
  deleteSavedCommand,
  getPausedRepos,
  isRepoPaused,
  toggleRepoPause,
  getLastTestInstruction,
  setLastTestInstruction,
  type RepoConfig,
  type ProfileType,
  type BuildOptions,
  type SavedCommand,
} from '../config.js';
import {
  listUserRepos,
  listBranches,
  ensureWebhook,
  deleteWebhook,
  isGitHubTokenSet,
} from '../github/api.js';
import { enqueue, getQueueStatus, clearQueue } from '../build/queue.js';
import {
  getBuildLog,
  getRuntimeLog,
  getNetworkLog,
  listRunIds,
  listBranches as listLogBranches,
  cleanupOldData,
} from '../logging/logStore.js';
import { getTailscaleIp, isTailscaleRunning } from '../tailscale/ip.js';
import { isSlackConfigured, sendTestNotification } from '../slack/notifier.js';
import { info, error as logError } from '../logging/logger.js';
import { cloneRepo, detectPortFromPackageJson, resetToMain, deleteClonedRepo } from '../utils/repoManager.js';
import { getCacheStats, clearCache, cleanOldCaches } from '../utils/buildCache.js';

const router = Router();

// Async handler wrapper for error handling
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// Global status endpoint with machine info
router.get('/status', asyncHandler(async (_req: Request, res: Response) => {
  const tailscaleIp = await getTailscaleIp();
  const tailscaleRunning = await isTailscaleRunning();
  const queueStatus = getQueueStatus();

  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  res.json({
    tailscaleIp,
    tailscaleRunning,
    queue: queueStatus,
    githubTokenSet: isGitHubTokenSet(),
    webhookSecretSet: !!process.env.GITHUB_WEBHOOK_SECRET,
    slackConfigured: isSlackConfigured(),
    machine: {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      cpuCount: cpus.length,
      cpuModel: cpus[0]?.model,
      totalMemoryGB: Math.round(totalMem / 1024 / 1024 / 1024 * 10) / 10,
      freeMemoryGB: Math.round(freeMem / 1024 / 1024 / 1024 * 10) / 10,
      memoryUsagePercent: Math.round((1 - freeMem / totalMem) * 100),
      uptime: Math.round(os.uptime() / 60), // minutes
    },
    config: {
      cloneBaseDir: getCloneBaseDir(),
      cacheEnabled: isCacheEnabled(),
      defaultBuildOptions: getDefaultBuildOptions(),
    },
  });
}));

// List configured repos
router.get('/config/repos', (_req: Request, res: Response) => {
  try {
    const repos = getConfigs();
    res.json(repos);
  } catch (error) {
    logError(`List repos error: ${error}`, 'API');
    res.status(500).json({ error: 'Failed to list repos' });
  }
});

// Get single repo config
router.get('/config/repos/:repoFullName(*)', (req: Request, res: Response) => {
  try {
    const { repoFullName } = req.params;
    const repo = getRepoConfig(decodeURIComponent(repoFullName));

    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }

    res.json(repo);
  } catch (error) {
    logError(`Get repo error: ${error}`, 'API');
    res.status(500).json({ error: 'Failed to get repo' });
  }
});

// Add or update repo config
router.post('/config/repos', (req: Request, res: Response) => {
  try {
    const repo = req.body as RepoConfig;

    if (!repo.repoFullName || !repo.profile) {
      res.status(400).json({ error: 'Missing required fields: repoFullName, profile' });
      return;
    }

    // If no localPath, use default clone directory
    if (!repo.localPath) {
      const [owner, repoName] = repo.repoFullName.split('/');
      repo.localPath = join(getCloneBaseDir(), owner, repoName);
    }

    addRepoConfig(repo);
    info(`Added/updated repo config: ${repo.repoFullName}`, 'API');

    res.json({ success: true, repo });
  } catch (error) {
    logError(`Add repo error: ${error}`, 'API');
    res.status(500).json({ error: 'Failed to add repo' });
  }
});

// Update repo config
router.patch('/config/repos/:repoFullName(*)', (req: Request, res: Response) => {
  try {
    const { repoFullName } = req.params;
    const updates = req.body as Partial<RepoConfig>;

    const updated = updateRepoConfig(decodeURIComponent(repoFullName), updates);

    if (!updated) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }

    res.json({ success: true, repo: updated });
  } catch (error) {
    logError(`Update repo error: ${error}`, 'API');
    res.status(500).json({ error: 'Failed to update repo' });
  }
});

// Delete repo config
router.delete('/config/repos/:repoFullName(*)', (req: Request, res: Response) => {
  try {
    const { repoFullName } = req.params;
    const { deleteLocalClone } = req.query;

    const repo = getRepoConfig(decodeURIComponent(repoFullName));

    // Optionally delete the local clone
    if (deleteLocalClone === 'true' && repo?.autoCloned && repo?.localPath) {
      deleteClonedRepo(repo.localPath);
    }

    const deleted = deleteRepoConfig(decodeURIComponent(repoFullName));

    if (!deleted) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    logError(`Delete repo error: ${error}`, 'API');
    res.status(500).json({ error: 'Failed to delete repo' });
  }
});

// Clone a repo
router.post('/config/repos/:repoFullName(*)/clone', asyncHandler(async (req: Request, res: Response) => {
  const { repoFullName } = req.params;
  const { targetPath } = req.body;

  const result = await cloneRepo(decodeURIComponent(repoFullName), targetPath);

  if (result.success) {
    // Update repo config with the new path
    updateRepoConfig(decodeURIComponent(repoFullName), {
      localPath: result.localPath,
      autoCloned: true,
    });

    res.json({ success: true, localPath: result.localPath, message: result.message });
  } else {
    res.status(500).json({ success: false, error: result.message });
  }
}));

// Detect port for a repo
router.post('/config/repos/:repoFullName(*)/detect-port', (req: Request, res: Response) => {
  try {
    const { repoFullName } = req.params;
    const repo = getRepoConfig(decodeURIComponent(repoFullName));

    if (!repo || !repo.localPath) {
      res.status(404).json({ error: 'Repo not found or no local path' });
      return;
    }

    const result = detectPortFromPackageJson(repo.localPath);

    if (result) {
      // Update repo config with detected port
      updateRepoConfig(decodeURIComponent(repoFullName), {
        detectedPort: result.port,
        devPort: repo.devPort || result.port,
      });

      res.json({
        success: true,
        port: result.port,
        confidence: result.confidence,
        source: result.source,
      });
    } else {
      res.json({
        success: false,
        error: 'Could not detect port',
      });
    }
  } catch (error) {
    logError(`Detect port error: ${error}`, 'API');
    res.status(500).json({ error: 'Failed to detect port' });
  }
});

// Reset repo to main branch
router.post('/config/repos/:repoFullName(*)/reset-to-main', asyncHandler(async (req: Request, res: Response) => {
  const { repoFullName } = req.params;
  const repo = getRepoConfig(decodeURIComponent(repoFullName));

  if (!repo || !repo.localPath) {
    res.status(404).json({ error: 'Repo not found or no local path' });
    return;
  }

  const { FileLogger } = await import('../logging/logger.js');
  const logger = new FileLogger('/dev/null'); // Discard logs

  const success = await resetToMain(repo.localPath, logger);

  res.json({ success });
}));

// Create webhook for repo
router.post('/config/repos/:repoFullName(*)/create-webhook', asyncHandler(async (req: Request, res: Response) => {
  const { repoFullName } = req.params;
  const decodedName = decodeURIComponent(repoFullName);

  const repo = getRepoConfig(decodedName);
  if (!repo) {
    res.status(404).json({ error: 'Repo not found in config' });
    return;
  }

  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!webhookSecret) {
    res.status(400).json({ error: 'GITHUB_WEBHOOK_SECRET not configured' });
    return;
  }

  const baseUrl = getWebhookBaseUrl();
  const payloadUrl = `${baseUrl}/webhook`;

  const webhook = await ensureWebhook(decodedName, payloadUrl, webhookSecret);

  // Update repo config with webhook ID
  updateRepoConfig(decodedName, { webhookId: webhook.id });

  res.json({ success: true, webhook });
}));

// Delete webhook for repo
router.delete('/config/repos/:repoFullName(*)/webhook', asyncHandler(async (req: Request, res: Response) => {
  const { repoFullName } = req.params;
  const decodedName = decodeURIComponent(repoFullName);

  const repo = getRepoConfig(decodedName);
  if (!repo || !repo.webhookId) {
    res.status(404).json({ error: 'No webhook configured for this repo' });
    return;
  }

  await deleteWebhook(decodedName, repo.webhookId);
  updateRepoConfig(decodedName, { webhookId: undefined });

  res.json({ success: true });
}));

// Get/Set webhook base URL
router.get('/config/webhook-url', (_req: Request, res: Response) => {
  res.json({ url: getWebhookBaseUrl() });
});

router.post('/config/webhook-url', (req: Request, res: Response) => {
  const { url } = req.body;
  if (!url) {
    res.status(400).json({ error: 'URL is required' });
    return;
  }
  setWebhookBaseUrl(url);
  res.json({ success: true, url });
});

// Get/Set clone base directory
router.get('/config/clone-base-dir', (_req: Request, res: Response) => {
  res.json({ dir: getCloneBaseDir() });
});

router.post('/config/clone-base-dir', (req: Request, res: Response) => {
  const { dir } = req.body;
  if (!dir) {
    res.status(400).json({ error: 'Directory is required' });
    return;
  }
  setCloneBaseDir(dir);
  res.json({ success: true, dir });
});

// Get/Set default build options
router.get('/config/build-options', (_req: Request, res: Response) => {
  res.json(getDefaultBuildOptions());
});

router.post('/config/build-options', (req: Request, res: Response) => {
  const options = req.body as BuildOptions;
  setDefaultBuildOptions(options);
  res.json({ success: true, options: getDefaultBuildOptions() });
});

// Cache management
router.get('/config/cache', (_req: Request, res: Response) => {
  res.json({
    enabled: isCacheEnabled(),
    stats: getCacheStats(),
  });
});

router.post('/config/cache/toggle', (req: Request, res: Response) => {
  const { enabled } = req.body;
  setCacheEnabled(!!enabled);
  res.json({ success: true, enabled: isCacheEnabled() });
});

router.post('/config/cache/clear', (req: Request, res: Response) => {
  const { repoFullName } = req.body;
  if (repoFullName) {
    const success = clearCache(repoFullName);
    res.json({ success, repoFullName });
  } else {
    // Clear old caches
    const deleted = cleanOldCaches(0); // Delete all
    res.json({ success: true, deletedCount: deleted });
  }
});

// List GitHub repos
router.get('/github/repos', asyncHandler(async (_req: Request, res: Response) => {
  if (!process.env.GITHUB_TOKEN) {
    res.status(401).json({ error: 'GITHUB_TOKEN is not configured. Set it in your .env file.' });
    return;
  }
  const repos = await listUserRepos();
  res.json(repos);
}));

// List branches for a repo
router.get('/github/repos/:repoFullName(*)/branches', asyncHandler(async (req: Request, res: Response) => {
  if (!process.env.GITHUB_TOKEN) {
    res.status(401).json({ error: 'GITHUB_TOKEN is not configured. Set it in your .env file.' });
    return;
  }
  const { repoFullName } = req.params;
  const branches = await listBranches(decodeURIComponent(repoFullName));
  res.json(branches);
}));

// Trigger manual run
router.post('/trigger-run', (req: Request, res: Response) => {
  try {
    const { repoFullName, branch = 'main', testInstruction } = req.body;

    if (!repoFullName) {
      res.status(400).json({ error: 'repoFullName is required' });
      return;
    }

    const repo = getRepoConfig(repoFullName);
    if (!repo) {
      res.status(404).json({ error: 'Repo not configured' });
      return;
    }

    if (!repo.enabled) {
      res.status(400).json({ error: 'Repo is disabled' });
      return;
    }

    // Save test instruction if provided (for recall next time)
    if (testInstruction) {
      setLastTestInstruction(repoFullName, testInstruction);
    }

    enqueue({
      repoFullName,
      branch,
      queuedAt: new Date().toISOString(),
      trigger: 'manual',
      customTestInstruction: testInstruction,
    });

    info(`Manual run triggered for ${repoFullName}/${branch}${testInstruction ? ' with custom test instruction' : ''}`, 'API');

    res.json({ success: true, message: `Build queued for ${repoFullName}/${branch}` });
  } catch (error) {
    logError(`Trigger run error: ${error}`, 'API');
    res.status(500).json({ error: 'Failed to trigger run' });
  }
});

// Get last test instruction for a repo
router.get('/test-instruction/:repoFullName(*)', (req: Request, res: Response) => {
  const { repoFullName } = req.params;
  const instruction = getLastTestInstruction(decodeURIComponent(repoFullName));
  res.json({ instruction: instruction || '' });
});

// Shortcut for triggering main branch
router.post('/trigger-run-main', (req: Request, res: Response) => {
  try {
    const { repoFullName } = req.body;

    if (!repoFullName) {
      res.status(400).json({ error: 'repoFullName is required' });
      return;
    }

    const repo = getRepoConfig(repoFullName);
    if (!repo) {
      res.status(404).json({ error: 'Repo not configured' });
      return;
    }

    if (!repo.enabled) {
      res.status(400).json({ error: 'Repo is disabled' });
      return;
    }

    enqueue({
      repoFullName,
      branch: 'main',
      queuedAt: new Date().toISOString(),
      trigger: 'manual',
    });

    info(`Manual run triggered for ${repoFullName}/main`, 'API');

    res.json({ success: true, message: `Build queued for ${repoFullName}/main` });
  } catch (error) {
    logError(`Trigger run-main error: ${error}`, 'API');
    res.status(500).json({ error: 'Failed to trigger run' });
  }
});

// Get queue status
router.get('/queue', (_req: Request, res: Response) => {
  res.json(getQueueStatus());
});

// Get run history for a repo
router.get('/runs/:repoFullName(*)', (req: Request, res: Response) => {
  try {
    const { repoFullName } = req.params;
    const { branch, limit } = req.query;

    if (branch) {
      const runs = getRunsByBranch(
        decodeURIComponent(repoFullName),
        String(branch),
        limit ? parseInt(String(limit)) : 20
      );
      res.json(runs);
      return;
    }

    const repo = getRepoConfig(decodeURIComponent(repoFullName));

    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }

    res.json(repo.lastRuns || []);
  } catch (error) {
    logError(`Get runs error: ${error}`, 'API');
    res.status(500).json({ error: 'Failed to get runs' });
  }
});

// Get run metadata (run.json)
router.get('/runs/:repoFullName(*)/branches/:branch(*)/runs/:runId/metadata', (req: Request, res: Response) => {
  try {
    const { repoFullName, branch, runId } = req.params;
    const safeName = decodeURIComponent(repoFullName).replace(/\//g, '_');
    const safeBranch = decodeURIComponent(branch).replace(/\//g, '_');
    const runJsonPath = join(process.cwd(), 'data', 'logs', safeName, safeBranch, runId, 'run.json');

    if (!existsSync(runJsonPath)) {
      res.status(404).json({ error: 'Run metadata not found' });
      return;
    }

    const metadata = JSON.parse(readFileSync(runJsonPath, 'utf-8'));
    res.json(metadata);
  } catch (error) {
    logError(`Get run metadata error: ${error}`, 'API');
    res.status(500).json({ error: 'Failed to get run metadata' });
  }
});

// Get log branches for a repo
router.get('/logs/:repoFullName(*)/branches', (req: Request, res: Response) => {
  try {
    const { repoFullName } = req.params;
    const branches = listLogBranches(decodeURIComponent(repoFullName));
    res.json(branches);
  } catch (error) {
    logError(`List log branches error: ${error}`, 'API');
    res.status(500).json({ error: 'Failed to list branches' });
  }
});

// Get run IDs for a branch
router.get('/logs/:repoFullName(*)/branches/:branch(*)/runs', (req: Request, res: Response) => {
  try {
    const { repoFullName, branch } = req.params;
    const runIds = listRunIds(
      decodeURIComponent(repoFullName),
      decodeURIComponent(branch)
    );
    res.json(runIds);
  } catch (error) {
    logError(`List run IDs error: ${error}`, 'API');
    res.status(500).json({ error: 'Failed to list runs' });
  }
});

// Get specific logs
router.get('/logs/:repoFullName(*)/branches/:branch(*)/runs/:runId/build', (req: Request, res: Response) => {
  try {
    const { repoFullName, branch, runId } = req.params;
    const log = getBuildLog(
      decodeURIComponent(repoFullName),
      decodeURIComponent(branch),
      runId
    );

    if (log === null) {
      res.status(404).json({ error: 'Build log not found' });
      return;
    }

    res.type('text/plain').send(log);
  } catch (error) {
    logError(`Get build log error: ${error}`, 'API');
    res.status(500).json({ error: 'Failed to get build log' });
  }
});

router.get('/logs/:repoFullName(*)/branches/:branch(*)/runs/:runId/runtime', (req: Request, res: Response) => {
  try {
    const { repoFullName, branch, runId } = req.params;
    const log = getRuntimeLog(
      decodeURIComponent(repoFullName),
      decodeURIComponent(branch),
      runId
    );

    if (log === null) {
      res.status(404).json({ error: 'Runtime log not found' });
      return;
    }

    res.type('text/plain').send(log);
  } catch (error) {
    logError(`Get runtime log error: ${error}`, 'API');
    res.status(500).json({ error: 'Failed to get runtime log' });
  }
});

router.get('/logs/:repoFullName(*)/branches/:branch(*)/runs/:runId/network', (req: Request, res: Response) => {
  try {
    const { repoFullName, branch, runId } = req.params;
    const log = getNetworkLog(
      decodeURIComponent(repoFullName),
      decodeURIComponent(branch),
      runId
    );

    if (log === null) {
      res.status(404).json({ error: 'Network log not found' });
      return;
    }

    res.type('text/plain').send(log);
  } catch (error) {
    logError(`Get network log error: ${error}`, 'API');
    res.status(500).json({ error: 'Failed to get network log' });
  }
});

// Auto-detect profile
router.post('/detect-profile', async (req: Request, res: Response) => {
  try {
    const { localPath } = req.body;

    if (!localPath || !existsSync(localPath)) {
      res.status(400).json({ error: 'Invalid or missing localPath' });
      return;
    }

    const packageJsonPath = join(localPath, 'package.json');
    const iosPath = join(localPath, 'ios');
    const androidPath = join(localPath, 'android');
    const srcTauriPath = join(localPath, 'src-tauri');

    let profile: ProfileType = 'web-generic';
    let devPort = 3000;

    // Check for Capacitor iOS
    if (existsSync(iosPath) && existsSync(join(localPath, 'capacitor.config.ts')) ||
        existsSync(iosPath) && existsSync(join(localPath, 'capacitor.config.json'))) {
      profile = 'ios-capacitor';
    }
    // Check for Capacitor Android
    else if (existsSync(androidPath) && (
      existsSync(join(localPath, 'capacitor.config.ts')) ||
      existsSync(join(localPath, 'capacitor.config.json'))
    )) {
      profile = 'android-capacitor';
    }
    // Check for Tauri
    else if (existsSync(srcTauriPath)) {
      profile = 'tauri-app';
    }
    // Check package.json for clues
    else if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      const scripts = packageJson.scripts || {};
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

      // Detect if it's a Node service (no frontend scripts)
      if (!scripts.dev && !scripts.start && scripts.build) {
        profile = 'node-service';
      }

      // Use smart port detection
      const portResult = detectPortFromPackageJson(localPath);
      if (portResult) {
        devPort = portResult.port;
      }
    }

    res.json({ profile, devPort });
  } catch (error) {
    logError(`Detect profile error: ${error}`, 'API');
    res.status(500).json({ error: 'Failed to detect profile' });
  }
});

// Test Slack notification
router.post('/test-slack', asyncHandler(async (_req: Request, res: Response) => {
  const success = await sendTestNotification();
  if (success) {
    res.json({ success: true, message: 'Test notification sent' });
  } else {
    res.status(500).json({ success: false, error: 'Failed to send notification' });
  }
}));

// Test Tailscale
router.get('/test-tailscale', asyncHandler(async (_req: Request, res: Response) => {
  const ip = await getTailscaleIp();
  const running = await isTailscaleRunning();
  res.json({ ip, running });
}));

// Cleanup old data
router.post('/cleanup', (req: Request, res: Response) => {
  try {
    const { maxAgeDays = 7 } = req.body;
    const result = cleanupOldData(maxAgeDays);
    res.json({ success: true, ...result });
  } catch (error) {
    logError(`Cleanup error: ${error}`, 'API');
    res.status(500).json({ error: 'Failed to cleanup' });
  }
});

// Admin cleanup endpoint (alias for /cleanup with more options)
router.post('/admin/cleanup', asyncHandler(async (req: Request, res: Response) => {
  const {
    maxAgeDays = 7,
    dryRun = false,
    resetToMain: shouldResetToMain = false,
    cleanOrphanedClones = false,
  } = req.body;

  info(`Admin cleanup requested: maxAgeDays=${maxAgeDays}, dryRun=${dryRun}, resetToMain=${shouldResetToMain}`, 'API');

  if (dryRun) {
    // In dry run mode, just report what would be cleaned
    const cacheStats = getCacheStats();
    res.json({
      success: true,
      dryRun: true,
      message: `Would clean up data older than ${maxAgeDays} days`,
      cacheStats,
      resetToMain: shouldResetToMain,
    });
    return;
  }

  const result = cleanupOldData(maxAgeDays);

  // Clean old caches
  const deletedCaches = cleanOldCaches(maxAgeDays);

  // Reset repos to main if requested
  let resetResults: { repo: string; success: boolean }[] = [];
  if (shouldResetToMain) {
    const repos = getConfigs();
    const { FileLogger } = await import('../logging/logger.js');

    for (const repo of repos) {
      if (repo.localPath && existsSync(repo.localPath)) {
        const logger = new FileLogger('/dev/null');
        const success = await resetToMain(repo.localPath, logger);
        resetResults.push({ repo: repo.repoFullName, success });
      }
    }
  }

  info(`Cleanup completed: ${result.logsDeleted} logs, ${result.screenshotsDeleted} screenshots, ${deletedCaches} caches deleted`, 'API');

  res.json({
    success: true,
    ...result,
    deletedCaches,
    resetResults: shouldResetToMain ? resetResults : undefined,
  });
}));

// Clear build queue
router.post('/admin/clear-queue', (_req: Request, res: Response) => {
  try {
    clearQueue();
    res.json({ success: true, message: 'Queue cleared' });
  } catch (error) {
    logError(`Clear queue error: ${error}`, 'API');
    res.status(500).json({ error: 'Failed to clear queue' });
  }
});

// Open folder (returns path for client to handle)
router.get('/open-folder', (req: Request, res: Response) => {
  const { path: folderPath } = req.query;

  if (!folderPath || !existsSync(String(folderPath))) {
    res.status(404).json({ error: 'Path not found' });
    return;
  }

  // Just return the path - the client can use this
  res.json({ path: folderPath });
});

// ============ Terminal Execution ============

// Store active terminal sessions
const terminalSessions: Map<string, {
  process: ChildProcess;
  output: string[];
  status: 'running' | 'completed' | 'error';
  exitCode?: number;
}> = new Map();

// Execute a command in a repo's directory
router.post('/terminal/execute', asyncHandler(async (req: Request, res: Response) => {
  const { repoFullName, command } = req.body;

  if (!command) {
    res.status(400).json({ error: 'Command is required' });
    return;
  }

  const repo = repoFullName ? getRepoConfig(repoFullName) : null;
  const cwd = repo?.localPath || getCloneBaseDir();

  if (!existsSync(cwd)) {
    res.status(400).json({ error: 'Working directory does not exist' });
    return;
  }

  const sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);

  info(`Terminal execute: ${command} in ${cwd}`, 'Terminal');

  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
  const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command];

  // Set up environment for better TTY simulation
  const termEnv = {
    ...process.env,
    TERM: 'xterm-256color',
    FORCE_COLOR: '1',
    COLORTERM: 'truecolor',
    CLICOLOR: '1',
    CLICOLOR_FORCE: '1',
    // npm/yarn colors
    NPM_CONFIG_COLOR: 'always',
    YARN_COLOR: 'always',
    // Git colors
    GIT_PAGER: '',
    // Columns for formatting
    COLUMNS: '120',
    LINES: '40',
  };

  const childProcess = spawn(shell, shellArgs, {
    cwd,
    env: termEnv,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const session: {
    process: ChildProcess;
    output: string[];
    status: 'running' | 'completed' | 'error';
    exitCode?: number;
  } = {
    process: childProcess,
    output: [],
    status: 'running',
    exitCode: undefined,
  };

  terminalSessions.set(sessionId, session);

  childProcess.stdout?.on('data', (data) => {
    session.output.push(data.toString());
  });

  childProcess.stderr?.on('data', (data) => {
    session.output.push(data.toString());
  });

  childProcess.on('close', (code) => {
    session.status = code === 0 ? 'completed' : 'error';
    session.exitCode = code ?? undefined;
  });

  childProcess.on('error', (err) => {
    session.output.push(`Error: ${err.message}`);
    session.status = 'error';
  });

  res.json({ sessionId, message: 'Command started' });
}));

// Get terminal session output
router.get('/terminal/session/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const session = terminalSessions.get(sessionId);

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  res.json({
    output: session.output.join(''),
    status: session.status,
    exitCode: session.exitCode,
  });
});

// Kill a terminal session
router.post('/terminal/session/:sessionId/kill', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const session = terminalSessions.get(sessionId);

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  try {
    session.process.kill('SIGTERM');
    session.status = 'completed';
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to kill process' });
  }
});

// ============ Saved Commands ============

// Get all saved commands
router.get('/commands', (_req: Request, res: Response) => {
  res.json(getSavedCommands());
});

// Add a saved command
router.post('/commands', (req: Request, res: Response) => {
  const { command, description } = req.body;

  if (!command) {
    res.status(400).json({ error: 'Command is required' });
    return;
  }

  const savedCommand = addSavedCommand(command, description);
  res.json({ success: true, command: savedCommand });
});

// Delete a saved command
router.delete('/commands/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const deleted = deleteSavedCommand(id);

  if (!deleted) {
    res.status(404).json({ error: 'Command not found' });
    return;
  }

  res.json({ success: true });
});

// ============ Pause/Resume Repos ============

// Get paused repos
router.get('/paused-repos', (_req: Request, res: Response) => {
  res.json(getPausedRepos());
});

// Check if a repo is paused
router.get('/repos/:repoFullName(*)/paused', (req: Request, res: Response) => {
  const { repoFullName } = req.params;
  res.json({ paused: isRepoPaused(decodeURIComponent(repoFullName)) });
});

// Toggle pause for a repo
router.post('/repos/:repoFullName(*)/toggle-pause', (req: Request, res: Response) => {
  const { repoFullName } = req.params;
  const decodedName = decodeURIComponent(repoFullName);
  const isPaused = toggleRepoPause(decodedName);

  info(`Repo ${decodedName} is now ${isPaused ? 'paused' : 'resumed'} for webhooks`, 'API');

  res.json({ success: true, paused: isPaused });
});

export default router;
