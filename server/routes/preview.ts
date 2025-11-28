import { Router, Request, Response } from 'express';
import { existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getRepoConfig, getLatestRun } from '../config.js';
import { getScreenshotsDir } from '../logging/logStore.js';
import { warn } from '../logging/logger.js';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));

// Serve screenshot for repo/branch
// GET /preview/:repoFullName/:branch.png
router.get('/:repoFullName(*)/:branchWithExt', (req: Request, res: Response) => {
  try {
    const { repoFullName, branchWithExt } = req.params;

    // Extract branch name (remove .png extension)
    if (!branchWithExt.endsWith('.png')) {
      res.status(400).json({ error: 'URL must end with .png' });
      return;
    }

    const branch = branchWithExt.slice(0, -4); // Remove .png
    const decodedRepo = decodeURIComponent(repoFullName);
    const decodedBranch = decodeURIComponent(branch);

    // First try to get from config's latest run
    const latestRun = getLatestRun(decodedRepo, decodedBranch);

    if (latestRun?.screenshotPath && existsSync(latestRun.screenshotPath)) {
      res.sendFile(latestRun.screenshotPath);
      return;
    }

    // Fallback: Look in screenshots directory for latest file
    const safeName = decodedRepo.replace(/\//g, '_');
    const safeBranch = decodedBranch.replace(/\//g, '_');
    const screenshotsDir = join(getScreenshotsDir(), safeName, safeBranch);

    if (!existsSync(screenshotsDir)) {
      res.status(404).json({ error: 'No screenshots found for this repo/branch' });
      return;
    }

    // Get the latest screenshot file
    const files = readdirSync(screenshotsDir)
      .filter((f) => f.endsWith('.png'))
      .sort()
      .reverse();

    if (files.length === 0) {
      res.status(404).json({ error: 'No screenshots found' });
      return;
    }

    const latestScreenshot = join(screenshotsDir, files[0]);
    res.sendFile(latestScreenshot);
  } catch (error) {
    warn(`Preview error: ${error}`, 'Preview');
    res.status(500).json({ error: 'Failed to serve screenshot' });
  }
});

// List available screenshots for a repo
router.get('/:repoFullName(*)', (req: Request, res: Response) => {
  try {
    const { repoFullName } = req.params;
    const decodedRepo = decodeURIComponent(repoFullName);
    const safeName = decodedRepo.replace(/\//g, '_');
    const repoDir = join(getScreenshotsDir(), safeName);

    if (!existsSync(repoDir)) {
      res.json({ branches: [] });
      return;
    }

    const branches = readdirSync(repoDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const branchDir = join(repoDir, d.name);
        const screenshots = readdirSync(branchDir)
          .filter((f) => f.endsWith('.png'))
          .sort()
          .reverse();

        return {
          branch: d.name.replace(/_/g, '/'),
          latestScreenshot: screenshots[0] || null,
          count: screenshots.length,
        };
      });

    res.json({ branches });
  } catch (error) {
    warn(`List screenshots error: ${error}`, 'Preview');
    res.status(500).json({ error: 'Failed to list screenshots' });
  }
});

export default router;
