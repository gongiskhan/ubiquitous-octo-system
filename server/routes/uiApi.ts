import { Router, Request, Response } from 'express';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  getConfigs,
  getRepoConfig,
  addRepoConfig,
  updateRepoConfig,
  deleteRepoConfig,
  getWebhookBaseUrl,
  setWebhookBaseUrl,
  type RepoConfig,
  type ProfileType,
} from '../config.js';
import {
  listUserRepos,
  listBranches,
  ensureWebhook,
  deleteWebhook,
  isGitHubTokenSet,
} from '../github/api.js';
import { enqueue, getQueueStatus } from '../build/queue.js';
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

const router = Router();

// Status endpoint
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const tailscaleIp = await getTailscaleIp();
    const tailscaleRunning = await isTailscaleRunning();
    const queueStatus = getQueueStatus();

    res.json({
      tailscaleIp,
      tailscaleRunning,
      queue: queueStatus,
      githubTokenSet: isGitHubTokenSet(),
      webhookSecretSet: !!process.env.GITHUB_WEBHOOK_SECRET,
      slackConfigured: isSlackConfigured(),
    });
  } catch (error) {
    logError(`Status endpoint error: ${error}`, 'API');
    res.status(500).json({ error: 'Failed to get status' });
  }
});

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

    if (!repo.repoFullName || !repo.localPath || !repo.profile) {
      res.status(400).json({ error: 'Missing required fields: repoFullName, localPath, profile' });
      return;
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

// Create webhook for repo
router.post('/config/repos/:repoFullName(*)/create-webhook', async (req: Request, res: Response) => {
  try {
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
  } catch (error) {
    logError(`Create webhook error: ${error}`, 'API');
    res.status(500).json({ error: `Failed to create webhook: ${error}` });
  }
});

// Delete webhook for repo
router.delete('/config/repos/:repoFullName(*)/webhook', async (req: Request, res: Response) => {
  try {
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
  } catch (error) {
    logError(`Delete webhook error: ${error}`, 'API');
    res.status(500).json({ error: `Failed to delete webhook: ${error}` });
  }
});

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

// List GitHub repos
router.get('/github/repos', async (_req: Request, res: Response) => {
  try {
    const repos = await listUserRepos();
    res.json(repos);
  } catch (error) {
    logError(`List GitHub repos error: ${error}`, 'API');
    res.status(500).json({ error: `Failed to list repos: ${error}` });
  }
});

// List branches for a repo
router.get('/github/repos/:repoFullName(*)/branches', async (req: Request, res: Response) => {
  try {
    const { repoFullName } = req.params;
    const branches = await listBranches(decodeURIComponent(repoFullName));
    res.json(branches);
  } catch (error) {
    logError(`List branches error: ${error}`, 'API');
    res.status(500).json({ error: `Failed to list branches: ${error}` });
  }
});

// Trigger manual run
router.post('/trigger-run', (req: Request, res: Response) => {
  try {
    const { repoFullName, branch = 'main' } = req.body;

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
      branch,
      queuedAt: new Date().toISOString(),
      trigger: 'manual',
    });

    info(`Manual run triggered for ${repoFullName}/${branch}`, 'API');

    res.json({ success: true, message: `Build queued for ${repoFullName}/${branch}` });
  } catch (error) {
    logError(`Trigger run error: ${error}`, 'API');
    res.status(500).json({ error: 'Failed to trigger run' });
  }
});

// Shortcut for triggering main
router.post('/trigger-run-main', (req: Request, res: Response) => {
  req.body.branch = 'main';
  return router.handle(req, res, () => {});
});

// Get queue status
router.get('/queue', (_req: Request, res: Response) => {
  res.json(getQueueStatus());
});

// Get run history for a repo
router.get('/runs/:repoFullName(*)', (req: Request, res: Response) => {
  try {
    const { repoFullName } = req.params;
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

      // Try to detect port from scripts
      const devScript = scripts.dev || scripts.start || '';
      const portMatch = devScript.match(/--port[= ](\d+)|PORT=(\d+)|-p[= ]?(\d+)/);
      if (portMatch) {
        devPort = parseInt(portMatch[1] || portMatch[2] || portMatch[3]);
      } else if (deps.vite) {
        devPort = 5173;
      } else if (deps['@angular/core']) {
        devPort = 4200;
      }
    }

    res.json({ profile, devPort });
  } catch (error) {
    logError(`Detect profile error: ${error}`, 'API');
    res.status(500).json({ error: 'Failed to detect profile' });
  }
});

// Test Slack notification
router.post('/test-slack', async (_req: Request, res: Response) => {
  try {
    const success = await sendTestNotification();
    if (success) {
      res.json({ success: true, message: 'Test notification sent' });
    } else {
      res.status(500).json({ success: false, error: 'Failed to send notification' });
    }
  } catch (error) {
    logError(`Test Slack error: ${error}`, 'API');
    res.status(500).json({ error: 'Failed to send test notification' });
  }
});

// Test Tailscale
router.get('/test-tailscale', async (_req: Request, res: Response) => {
  try {
    const ip = await getTailscaleIp();
    const running = await isTailscaleRunning();
    res.json({ ip, running });
  } catch (error) {
    logError(`Test Tailscale error: ${error}`, 'API');
    res.status(500).json({ error: 'Failed to test Tailscale' });
  }
});

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

export default router;
