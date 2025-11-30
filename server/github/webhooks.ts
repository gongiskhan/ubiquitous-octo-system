import { Request, Response, Router } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { getRepoConfig, isRepoPaused } from '../config.js';
import { enqueue } from '../build/queue.js';
import { info, warn, error as logError } from '../logging/logger.js';

const router = Router();

interface PushPayload {
  ref: string;
  repository: {
    full_name: string;
    name: string;
    owner: {
      login: string;
      name?: string;
    };
  };
  pusher: {
    name: string;
    email?: string;
  };
  head_commit?: {
    id: string;
    message: string;
    author: {
      name: string;
      email: string;
    };
  };
  commits?: Array<{
    id: string;
    message: string;
  }>;
}

function verifySignature(payload: string, signature: string | undefined): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!secret) {
    warn('GITHUB_WEBHOOK_SECRET is not set, skipping signature verification', 'Webhook');
    return true; // Allow for development
  }

  if (!signature) {
    logError('No signature provided in webhook request', 'Webhook');
    return false;
  }

  const expectedSignature = 'sha256=' + createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  try {
    return timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

function extractBranch(ref: string): string {
  // ref is like "refs/heads/feature-123" or "refs/heads/main"
  const parts = ref.split('/');
  if (parts.length >= 3 && parts[0] === 'refs' && parts[1] === 'heads') {
    return parts.slice(2).join('/');
  }
  return ref;
}

router.post('/', (req: Request, res: Response) => {
  const event = req.headers['x-github-event'] as string;
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const deliveryId = req.headers['x-github-delivery'] as string;

  info(`Received webhook event: ${event}, delivery: ${deliveryId}`, 'Webhook');

  // Get raw body for signature verification
  const rawBody = JSON.stringify(req.body);

  // Verify signature
  if (!verifySignature(rawBody, signature)) {
    logError('Invalid webhook signature', 'Webhook');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // Handle ping event (sent when webhook is created)
  if (event === 'ping') {
    info('Received ping event', 'Webhook');
    res.status(200).json({ message: 'pong' });
    return;
  }

  // Only handle push events
  if (event !== 'push') {
    info(`Ignoring non-push event: ${event}`, 'Webhook');
    res.status(200).json({ message: `Event ${event} ignored` });
    return;
  }

  const payload = req.body as PushPayload;
  const repoFullName = payload.repository.full_name;
  const ref = payload.ref;
  const branch = extractBranch(ref);

  info(`Push event for ${repoFullName} on branch ${branch}`, 'Webhook');

  // Check if this is a branch push (not tag)
  if (!ref.startsWith('refs/heads/')) {
    info(`Ignoring non-branch ref: ${ref}`, 'Webhook');
    res.status(200).json({ message: 'Non-branch ref ignored' });
    return;
  }

  // Check if repo is configured and enabled
  const repoConfig = getRepoConfig(repoFullName);

  if (!repoConfig) {
    warn(`Repo ${repoFullName} is not configured, ignoring webhook`, 'Webhook');
    res.status(200).json({ message: 'Repo not configured' });
    return;
  }

  if (!repoConfig.enabled) {
    info(`Repo ${repoFullName} is disabled, ignoring webhook`, 'Webhook');
    res.status(200).json({ message: 'Repo disabled' });
    return;
  }

  // Check if repo is paused for webhooks
  if (isRepoPaused(repoFullName)) {
    info(`Repo ${repoFullName} is paused for webhooks, ignoring`, 'Webhook');
    res.status(200).json({ message: 'Repo paused' });
    return;
  }

  // Get commit info for logging
  const commitMessage = payload.head_commit?.message || 'No commit message';
  const commitAuthor = payload.head_commit?.author?.name || payload.pusher.name;

  info(
    `Queueing build for ${repoFullName}/${branch} by ${commitAuthor}: "${commitMessage.split('\n')[0]}"`,
    'Webhook'
  );

  // Enqueue the build job
  enqueue({
    repoFullName,
    branch,
    queuedAt: new Date().toISOString(),
    trigger: 'webhook',
    commitMessage: commitMessage.split('\n')[0],
    commitAuthor,
  });

  res.status(202).json({
    message: 'Build queued',
    repo: repoFullName,
    branch,
  });
});

// Handle ping separately (GitHub sends this when webhook is created)
router.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    message: 'BranchRunner webhook endpoint',
  });
});

export default router;
