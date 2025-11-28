const API_BASE = '/api';

export interface RepoConfig {
  repoFullName: string;
  localPath: string;
  enabled: boolean;
  profile: 'ios-capacitor' | 'web-generic' | 'node-service' | 'android-capacitor' | 'tauri-app' | 'custom';
  webhookId?: number;
  devPort?: number;
  lastRuns?: RunRecord[];
}

export interface RunRecord {
  branch: string;
  timestamp: string;
  runId: string;
  status: 'success' | 'failure' | 'running';
  screenshotPath?: string;
  buildLogPath?: string;
  runtimeLogPath?: string;
  networkLogPath?: string;
  errorMessage?: string;
}

export interface GitHubRepo {
  fullName: string;
  name: string;
  owner: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
}

export interface GitHubBranch {
  name: string;
  protected: boolean;
}

export interface Status {
  tailscaleIp: string | null;
  tailscaleRunning: boolean;
  queue: {
    queueLength: number;
    isProcessing: boolean;
    currentJob: any | null;
    queuedJobs: any[];
  };
  githubTokenSet: boolean;
  webhookSecretSet: boolean;
  slackConfigured: boolean;
}

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  return response.json();
}

async function fetchText(path: string): Promise<string> {
  const response = await fetch(`${API_BASE}${path}`);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

export const api = {
  // Status
  getStatus: () => fetchJson<Status>('/status'),

  // Config repos
  getRepos: () => fetchJson<RepoConfig[]>('/config/repos'),
  getRepo: (repoFullName: string) =>
    fetchJson<RepoConfig>(`/config/repos/${encodeURIComponent(repoFullName)}`),
  addRepo: (repo: Partial<RepoConfig>) =>
    fetchJson<{ success: boolean; repo: RepoConfig }>('/config/repos', {
      method: 'POST',
      body: JSON.stringify(repo),
    }),
  updateRepo: (repoFullName: string, updates: Partial<RepoConfig>) =>
    fetchJson<{ success: boolean; repo: RepoConfig }>(
      `/config/repos/${encodeURIComponent(repoFullName)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(updates),
      }
    ),
  deleteRepo: (repoFullName: string) =>
    fetchJson<{ success: boolean }>(
      `/config/repos/${encodeURIComponent(repoFullName)}`,
      { method: 'DELETE' }
    ),

  // Webhooks
  createWebhook: (repoFullName: string) =>
    fetchJson<{ success: boolean; webhook: any }>(
      `/config/repos/${encodeURIComponent(repoFullName)}/create-webhook`,
      { method: 'POST' }
    ),
  deleteWebhook: (repoFullName: string) =>
    fetchJson<{ success: boolean }>(
      `/config/repos/${encodeURIComponent(repoFullName)}/webhook`,
      { method: 'DELETE' }
    ),

  // Webhook URL
  getWebhookUrl: () => fetchJson<{ url: string }>('/config/webhook-url'),
  setWebhookUrl: (url: string) =>
    fetchJson<{ success: boolean; url: string }>('/config/webhook-url', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  // GitHub
  getGitHubRepos: () => fetchJson<GitHubRepo[]>('/github/repos'),
  getGitHubBranches: (repoFullName: string) =>
    fetchJson<GitHubBranch[]>(
      `/github/repos/${encodeURIComponent(repoFullName)}/branches`
    ),

  // Trigger builds
  triggerRun: (repoFullName: string, branch: string = 'main') =>
    fetchJson<{ success: boolean; message: string }>('/trigger-run', {
      method: 'POST',
      body: JSON.stringify({ repoFullName, branch }),
    }),

  // Queue
  getQueue: () => fetchJson<Status['queue']>('/queue'),

  // Runs
  getRuns: (repoFullName: string) =>
    fetchJson<RunRecord[]>(`/runs/${encodeURIComponent(repoFullName)}`),

  // Logs
  getLogBranches: (repoFullName: string) =>
    fetchJson<string[]>(`/logs/${encodeURIComponent(repoFullName)}/branches`),
  getLogRuns: (repoFullName: string, branch: string) =>
    fetchJson<string[]>(
      `/logs/${encodeURIComponent(repoFullName)}/branches/${encodeURIComponent(branch)}/runs`
    ),
  getBuildLog: (repoFullName: string, branch: string, runId: string) =>
    fetchText(
      `/logs/${encodeURIComponent(repoFullName)}/branches/${encodeURIComponent(branch)}/runs/${runId}/build`
    ),
  getRuntimeLog: (repoFullName: string, branch: string, runId: string) =>
    fetchText(
      `/logs/${encodeURIComponent(repoFullName)}/branches/${encodeURIComponent(branch)}/runs/${runId}/runtime`
    ),
  getNetworkLog: (repoFullName: string, branch: string, runId: string) =>
    fetchText(
      `/logs/${encodeURIComponent(repoFullName)}/branches/${encodeURIComponent(branch)}/runs/${runId}/network`
    ),

  // Profile detection
  detectProfile: (localPath: string) =>
    fetchJson<{ profile: string; devPort: number }>('/detect-profile', {
      method: 'POST',
      body: JSON.stringify({ localPath }),
    }),

  // Testing
  testSlack: () =>
    fetchJson<{ success: boolean; message?: string; error?: string }>('/test-slack', {
      method: 'POST',
    }),
  testTailscale: () =>
    fetchJson<{ ip: string | null; running: boolean }>('/test-tailscale'),

  // Cleanup
  cleanup: (maxAgeDays: number = 7) =>
    fetchJson<{ success: boolean; logsDeleted: number; screenshotsDeleted: number }>(
      '/cleanup',
      {
        method: 'POST',
        body: JSON.stringify({ maxAgeDays }),
      }
    ),
};

export function getScreenshotUrl(repoFullName: string, branch: string): string {
  return `/preview/${encodeURIComponent(repoFullName)}/${encodeURIComponent(branch)}.png`;
}
