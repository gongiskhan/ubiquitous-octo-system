import { Octokit } from '@octokit/rest';
import { info, error as logError, warn } from '../logging/logger.js';

let octokitInstance: Octokit | null = null;

function getOctokit(): Octokit {
  if (!octokitInstance) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error('GITHUB_TOKEN environment variable is not set');
    }
    octokitInstance = new Octokit({ auth: token });
    info('Octokit client initialized', 'GitHub');
  }
  return octokitInstance;
}

export interface RepoInfo {
  fullName: string;
  name: string;
  owner: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
}

export interface BranchInfo {
  name: string;
  protected: boolean;
}

export interface WebhookInfo {
  id: number;
  name: string;
  active: boolean;
  events: string[];
  config: {
    url?: string;
    contentType?: string;
  };
}

export async function listUserRepos(): Promise<RepoInfo[]> {
  const octokit = getOctokit();

  try {
    const repos: RepoInfo[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const response = await octokit.repos.listForAuthenticatedUser({
        per_page: perPage,
        page,
        sort: 'updated',
        direction: 'desc',
      });

      for (const repo of response.data) {
        repos.push({
          fullName: repo.full_name,
          name: repo.name,
          owner: repo.owner.login,
          description: repo.description,
          private: repo.private,
          defaultBranch: repo.default_branch,
          htmlUrl: repo.html_url,
        });
      }

      if (response.data.length < perPage) {
        break;
      }
      page++;

      // Limit to first 500 repos
      if (repos.length >= 500) {
        warn('Limiting repos list to 500 entries', 'GitHub');
        break;
      }
    }

    info(`Fetched ${repos.length} repositories`, 'GitHub');
    return repos;
  } catch (err) {
    logError(`Failed to list repos: ${err}`, 'GitHub');
    throw err;
  }
}

export async function listBranches(repoFullName: string): Promise<BranchInfo[]> {
  const octokit = getOctokit();
  const [owner, repo] = repoFullName.split('/');

  try {
    const branches: BranchInfo[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const response = await octokit.repos.listBranches({
        owner,
        repo,
        per_page: perPage,
        page,
      });

      for (const branch of response.data) {
        branches.push({
          name: branch.name,
          protected: branch.protected,
        });
      }

      if (response.data.length < perPage) {
        break;
      }
      page++;
    }

    info(`Fetched ${branches.length} branches for ${repoFullName}`, 'GitHub');
    return branches;
  } catch (err) {
    logError(`Failed to list branches for ${repoFullName}: ${err}`, 'GitHub');
    throw err;
  }
}

export async function listWebhooks(repoFullName: string): Promise<WebhookInfo[]> {
  const octokit = getOctokit();
  const [owner, repo] = repoFullName.split('/');

  try {
    const response = await octokit.repos.listWebhooks({
      owner,
      repo,
    });

    const webhooks: WebhookInfo[] = response.data.map((hook) => ({
      id: hook.id,
      name: hook.name,
      active: hook.active,
      events: hook.events,
      config: {
        url: hook.config.url as string | undefined,
        contentType: hook.config.content_type as string | undefined,
      },
    }));

    info(`Fetched ${webhooks.length} webhooks for ${repoFullName}`, 'GitHub');
    return webhooks;
  } catch (err) {
    logError(`Failed to list webhooks for ${repoFullName}: ${err}`, 'GitHub');
    throw err;
  }
}

export async function createWebhook(
  repoFullName: string,
  payloadUrl: string,
  secret: string
): Promise<WebhookInfo> {
  const octokit = getOctokit();
  const [owner, repo] = repoFullName.split('/');

  try {
    const response = await octokit.repos.createWebhook({
      owner,
      repo,
      config: {
        url: payloadUrl,
        content_type: 'json',
        secret,
        insecure_ssl: '0',
      },
      events: ['push'],
      active: true,
    });

    const webhook: WebhookInfo = {
      id: response.data.id,
      name: response.data.name,
      active: response.data.active,
      events: response.data.events,
      config: {
        url: response.data.config.url as string | undefined,
        contentType: response.data.config.content_type as string | undefined,
      },
    };

    info(`Created webhook ${webhook.id} for ${repoFullName}`, 'GitHub');
    return webhook;
  } catch (err) {
    logError(`Failed to create webhook for ${repoFullName}: ${err}`, 'GitHub');
    throw err;
  }
}

export async function deleteWebhook(
  repoFullName: string,
  webhookId: number
): Promise<void> {
  const octokit = getOctokit();
  const [owner, repo] = repoFullName.split('/');

  try {
    await octokit.repos.deleteWebhook({
      owner,
      repo,
      hook_id: webhookId,
    });

    info(`Deleted webhook ${webhookId} for ${repoFullName}`, 'GitHub');
  } catch (err) {
    logError(`Failed to delete webhook ${webhookId} for ${repoFullName}: ${err}`, 'GitHub');
    throw err;
  }
}

export async function ensureWebhook(
  repoFullName: string,
  payloadUrl: string,
  secret: string
): Promise<WebhookInfo> {
  // First check if a webhook with this URL already exists
  const existingWebhooks = await listWebhooks(repoFullName);
  const existingHook = existingWebhooks.find(
    (hook) => hook.config.url === payloadUrl
  );

  if (existingHook) {
    info(`Webhook already exists for ${repoFullName} with URL ${payloadUrl}`, 'GitHub');
    return existingHook;
  }

  // Create new webhook
  return createWebhook(repoFullName, payloadUrl, secret);
}

export function isGitHubTokenSet(): boolean {
  return !!process.env.GITHUB_TOKEN;
}
