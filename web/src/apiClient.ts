const API_BASE = '/api';

export interface RepoConfig {
  repoFullName: string;
  localPath: string;
  enabled: boolean;
  profile: 'ios-capacitor' | 'web-generic' | 'node-service' | 'android-capacitor' | 'tauri-app' | 'custom';
  webhookId?: number;
  devPort?: number;
  detectedPort?: number;
  autoCloned?: boolean;
  buildOptions?: BuildOptions;
  lastRuns?: RunRecord[];
  testingConfig?: TestingConfig;
}

export interface BuildOptions {
  buildTimeout?: number;
  runtimeTimeout?: number;
  screenshotTimeout?: number;
  screenshotDelay?: number;
  simulatorDevice?: string;
  androidAvd?: string;
  envVars?: Record<string, string>;
}

export type TestingProfile = 'web' | 'ios-capacitor' | 'android-capacitor' | 'both-mobile';

export interface MobileTestingConfig {
  iosEnabled: boolean;
  androidEnabled: boolean;
  iosBundleId?: string;
  androidPackage?: string;
  iosSimulator?: string;
  androidEmulator?: string;
}

export interface CredentialConfig {
  username: string;
  password: string;
  loginSelectors?: {
    usernameField: string;
    passwordField: string;
    submitButton: string;
  };
}

export interface TestingConfig {
  enabled: boolean;
  testingUrl?: string;
  maxIterations: number;
  passThreshold: number;
  testingProfile: TestingProfile;
  credentials?: CredentialConfig;
  mobileConfig?: MobileTestingConfig;
}

export interface DiffResult {
  hasDiff: boolean;
  diffPercentage: number;
  diffPath?: string;
  previousRunId?: string;
  error?: string;
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
  runJsonPath?: string;
  errorMessage?: string;
  diffResult?: DiffResult;
  durations?: {
    total?: number;
    git?: number;
    install?: number;
    build?: number;
    screenshot?: number;
  };
  errorSummary?: {
    errorLines: string[];
    warningCount: number;
  };
}

export interface RunMetadata {
  repoFullName: string;
  branch: string;
  runId: string;
  timestamp: string;
  status: 'success' | 'failure' | 'running';
  profile: string;
  durations?: RunRecord['durations'];
  screenshotPath?: string;
  diffResult?: DiffResult;
  errorMessage?: string;
  errorSummary?: RunRecord['errorSummary'];
  buildLogPath: string;
  runtimeLogPath?: string;
  networkLogPath?: string;
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

export interface MachineInfo {
  platform: string;
  arch: string;
  hostname: string;
  cpuCount: number;
  cpuModel: string;
  totalMemoryGB: number;
  freeMemoryGB: number;
  memoryUsagePercent: number;
  uptime: number;
}

export interface ConfigInfo {
  cloneBaseDir: string;
  cacheEnabled: boolean;
  defaultBuildOptions: BuildOptions;
}

export interface CacheStats {
  totalSize: number;
  cacheCount: number;
  caches: Array<{
    repo: string;
    size: number;
    createdAt: string;
  }>;
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
  machine?: MachineInfo;
  config?: ConfigInfo;
}

export interface SavedCommand {
  id: string;
  command: string;
  description?: string;
  createdAt: string;
}

export interface TerminalSession {
  output: string;
  status: 'running' | 'completed' | 'error';
  exitCode?: number;
}

// ============ Agent Types ============

export type AgentMode = 'branch' | 'project' | 'task' | 'review' | 'refactor';
export type SessionState = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface AgentCapabilities {
  allowSubAgents: boolean;
  allowFileEdits: boolean;
  allowGitOps: boolean;
  allowBash: boolean;
  allowWebSearch: boolean;
  allowMcp: boolean;
  maxSubAgentDepth: number;
  timeout: number;
}

export interface McpServerDefinition {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  description?: string;
}

export interface StartAgentRequest {
  workingDir?: string;
  repoFullName?: string;
  branch?: string;
  mode: AgentMode;
  prompt: string;
  systemPrompt?: string;
  permissionPreset?: 'full' | 'safe' | 'custom';
  capabilities?: Partial<AgentCapabilities>;
  mcpServers?: string[];
  customMcpServers?: McpServerDefinition[];
  allowSlashCommands?: boolean;
  model?: string;
}

export interface StartAgentResponse {
  sessionId: string;
  message: string;
  streamUrl: string;
}

export interface AgentSessionStatus {
  sessionId: string;
  state: SessionState;
  startedAt: string;
  lastActivity: string;
  config: {
    mode: AgentMode;
    repoFullName?: string;
    branch?: string;
    workingDir: string;
    prompt: string;
  };
  eventsCount: number;
  filesModified: string[];
  subAgentsSpawned: number;
  currentPhase?: string;
  error?: string;
}

export interface AgentHistoryEntry {
  sessionId: string;
  repoFullName?: string;
  branch?: string;
  mode: AgentMode;
  prompt: string;
  state: SessionState;
  startedAt: string;
  endedAt?: string;
  duration?: number;
  filesModified: string[];
  summary?: string;
}

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  mode: AgentMode;
  promptTemplate: string;
  systemPrompt?: string;
  capabilities: AgentCapabilities;
  mcpServers: string[];
  createdAt: string;
  updatedAt: string;
}

export type StreamEventType =
  | 'session_start'
  | 'thinking'
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'subagent_spawn'
  | 'subagent_result'
  | 'file_edit'
  | 'bash_command'
  | 'bash_output'
  | 'error'
  | 'warning'
  | 'progress'
  | 'session_end';

export interface StreamEvent {
  type: StreamEventType;
  timestamp: string;
  sessionId: string;
  [key: string]: unknown;
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
  deleteRepo: (repoFullName: string, deleteLocalClone = false) =>
    fetchJson<{ success: boolean }>(
      `/config/repos/${encodeURIComponent(repoFullName)}${deleteLocalClone ? '?deleteLocalClone=true' : ''}`,
      { method: 'DELETE' }
    ),

  // Repo operations
  cloneRepo: (repoFullName: string, targetPath?: string) =>
    fetchJson<{ success: boolean; localPath?: string; message?: string; error?: string }>(
      `/config/repos/${encodeURIComponent(repoFullName)}/clone`,
      {
        method: 'POST',
        body: JSON.stringify({ targetPath }),
      }
    ),
  detectPort: (repoFullName: string) =>
    fetchJson<{ success: boolean; port?: number; confidence?: string; source?: string; error?: string }>(
      `/config/repos/${encodeURIComponent(repoFullName)}/detect-port`,
      { method: 'POST' }
    ),
  resetToMain: (repoFullName: string) =>
    fetchJson<{ success: boolean }>(
      `/config/repos/${encodeURIComponent(repoFullName)}/reset-to-main`,
      { method: 'POST' }
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

  // Clone base directory
  getCloneBaseDir: () => fetchJson<{ dir: string }>('/config/clone-base-dir'),
  setCloneBaseDir: (dir: string) =>
    fetchJson<{ success: boolean; dir: string }>('/config/clone-base-dir', {
      method: 'POST',
      body: JSON.stringify({ dir }),
    }),

  // Default build options
  getBuildOptions: () => fetchJson<BuildOptions>('/config/build-options'),
  setBuildOptions: (options: BuildOptions) =>
    fetchJson<{ success: boolean; options: BuildOptions }>('/config/build-options', {
      method: 'POST',
      body: JSON.stringify(options),
    }),

  // Cache management
  getCacheStatus: () => fetchJson<{ enabled: boolean; stats: CacheStats }>('/config/cache'),
  toggleCache: (enabled: boolean) =>
    fetchJson<{ success: boolean; enabled: boolean }>('/config/cache/toggle', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  clearCache: (repoFullName?: string) =>
    fetchJson<{ success: boolean; deletedCount?: number; repoFullName?: string }>('/config/cache/clear', {
      method: 'POST',
      body: JSON.stringify({ repoFullName }),
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
  triggerRunMain: (repoFullName: string) =>
    fetchJson<{ success: boolean; message: string }>('/trigger-run-main', {
      method: 'POST',
      body: JSON.stringify({ repoFullName }),
    }),

  // Queue
  getQueue: () => fetchJson<Status['queue']>('/queue'),
  clearQueue: () => fetchJson<{ success: boolean; message: string }>('/admin/clear-queue', { method: 'POST' }),

  // Runs
  getRuns: (repoFullName: string, branch?: string, limit?: number) => {
    const params = new URLSearchParams();
    if (branch) params.set('branch', branch);
    if (limit) params.set('limit', String(limit));
    const query = params.toString();
    return fetchJson<RunRecord[]>(`/runs/${encodeURIComponent(repoFullName)}${query ? '?' + query : ''}`);
  },
  getRunMetadata: (repoFullName: string, branch: string, runId: string) =>
    fetchJson<RunMetadata>(
      `/runs/${encodeURIComponent(repoFullName)}/branches/${encodeURIComponent(branch)}/runs/${runId}/metadata`
    ),

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
  adminCleanup: (options: {
    maxAgeDays?: number;
    dryRun?: boolean;
    resetToMain?: boolean;
    cleanOrphanedClones?: boolean;
  }) =>
    fetchJson<{
      success: boolean;
      logsDeleted?: number;
      screenshotsDeleted?: number;
      deletedCaches?: number;
      resetResults?: Array<{ repo: string; success: boolean }>;
    }>('/admin/cleanup', {
      method: 'POST',
      body: JSON.stringify(options),
    }),

  // Terminal
  executeCommand: (command: string, repoFullName?: string) =>
    fetchJson<{ sessionId: string; message: string }>('/terminal/execute', {
      method: 'POST',
      body: JSON.stringify({ command, repoFullName }),
    }),
  getTerminalSession: (sessionId: string) =>
    fetchJson<TerminalSession>(`/terminal/session/${sessionId}`),
  killTerminalSession: (sessionId: string) =>
    fetchJson<{ success: boolean }>(`/terminal/session/${sessionId}/kill`, {
      method: 'POST',
    }),

  // Saved Commands
  getSavedCommands: () => fetchJson<SavedCommand[]>('/commands'),
  addSavedCommand: (command: string, description?: string) =>
    fetchJson<{ success: boolean; command: SavedCommand }>('/commands', {
      method: 'POST',
      body: JSON.stringify({ command, description }),
    }),
  deleteSavedCommand: (id: string) =>
    fetchJson<{ success: boolean }>(`/commands/${id}`, {
      method: 'DELETE',
    }),

  // Pause/Resume Repos
  getPausedRepos: () => fetchJson<string[]>('/paused-repos'),
  isRepoPaused: (repoFullName: string) =>
    fetchJson<{ paused: boolean }>(`/repos/${encodeURIComponent(repoFullName)}/paused`),
  toggleRepoPause: (repoFullName: string) =>
    fetchJson<{ success: boolean; paused: boolean }>(
      `/repos/${encodeURIComponent(repoFullName)}/toggle-pause`,
      { method: 'POST' }
    ),

  // ============ Agent API ============

  // Start a new agent session
  startAgent: (request: StartAgentRequest) =>
    fetchJson<StartAgentResponse>('/agent/start', {
      method: 'POST',
      body: JSON.stringify(request),
    }),

  // Start agent from template
  startAgentFromTemplate: (templateId: string, variables?: Record<string, string>, overrides?: Partial<StartAgentRequest>) =>
    fetchJson<StartAgentResponse>(`/agent/start-from-template/${templateId}`, {
      method: 'POST',
      body: JSON.stringify({ variables, ...overrides }),
    }),

  // Get session status
  getAgentSession: (sessionId: string) =>
    fetchJson<AgentSessionStatus>(`/agent/session/${sessionId}`),

  // Get session events
  getAgentEvents: (sessionId: string, afterIndex?: number) => {
    const params = afterIndex !== undefined ? `?after=${afterIndex}` : '';
    return fetchJson<StreamEvent[]>(`/agent/session/${sessionId}/events${params}`);
  },

  // Cancel a session
  cancelAgentSession: (sessionId: string, reason?: string) =>
    fetchJson<{ success: boolean; message: string }>(`/agent/session/${sessionId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  // List active sessions
  listAgentSessions: () =>
    fetchJson<AgentSessionStatus[]>('/agent/sessions'),

  // Get session history
  getAgentHistory: (limit?: number) => {
    const params = limit ? `?limit=${limit}` : '';
    return fetchJson<AgentHistoryEntry[]>(`/agent/history${params}`);
  },

  // Get all templates
  getAgentTemplates: () =>
    fetchJson<AgentTemplate[]>('/agent/templates'),

  // Get a specific template
  getAgentTemplate: (templateId: string) =>
    fetchJson<AgentTemplate>(`/agent/templates/${templateId}`),

  // Create a new template
  createAgentTemplate: (template: Omit<AgentTemplate, 'id' | 'createdAt' | 'updatedAt'>) =>
    fetchJson<AgentTemplate>('/agent/templates', {
      method: 'POST',
      body: JSON.stringify(template),
    }),

  // Update a template
  updateAgentTemplate: (templateId: string, updates: Partial<AgentTemplate>) =>
    fetchJson<AgentTemplate>(`/agent/templates/${templateId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),

  // Delete a template
  deleteAgentTemplate: (templateId: string) =>
    fetchJson<{ success: boolean }>(`/agent/templates/${templateId}`, {
      method: 'DELETE',
    }),

  // Get available MCP servers
  getMcpServers: () =>
    fetchJson<Array<McpServerDefinition & { id: string }>>('/agent/mcp-servers'),

  // Get capability presets
  getCapabilityPresets: () =>
    fetchJson<{ full: AgentCapabilities; safe: AgentCapabilities }>('/agent/capability-presets'),

  // Cleanup old sessions
  cleanupAgentSessions: (maxAge?: number) =>
    fetchJson<{ success: boolean; cleanedSessions: number }>('/agent/cleanup', {
      method: 'POST',
      body: JSON.stringify({ maxAge }),
    }),
};

/**
 * Create an EventSource for streaming agent events
 */
export function createAgentEventSource(
  sessionId: string,
  options?: { catchUp?: boolean }
): EventSource {
  const params = options?.catchUp ? '?catchUp=true' : '';
  return new EventSource(`${API_BASE}/agent/stream/${sessionId}${params}`);
}

/**
 * Subscribe to agent stream events
 * Returns cleanup function to close the connection
 */
export function subscribeToAgentStream(
  sessionId: string,
  callbacks: {
    onEvent?: (event: StreamEvent) => void;
    onText?: (content: string, isPartial: boolean) => void;
    onThinking?: (content: string) => void;
    onToolUse?: (toolName: string, toolId: string, input: Record<string, unknown>) => void;
    onToolResult?: (toolId: string, result: unknown, success: boolean) => void;
    onFileEdit?: (filePath: string, action: string, diff?: string) => void;
    onBashCommand?: (command: string) => void;
    onBashOutput?: (output: string, isStderr: boolean) => void;
    onSubAgentSpawn?: (subAgentId: string, description: string) => void;
    onSubAgentResult?: (subAgentId: string, result: string, success: boolean) => void;
    onProgress?: (phase: string, message: string, percentage?: number) => void;
    onError?: (message: string, recoverable: boolean) => void;
    onWarning?: (message: string) => void;
    onSessionEnd?: (success: boolean, summary: string, filesModified: string[], duration: number) => void;
    onConnected?: () => void;
    onDisconnected?: () => void;
  },
  options?: { catchUp?: boolean }
): () => void {
  const eventSource = createAgentEventSource(sessionId, options);

  eventSource.addEventListener('connected', () => {
    callbacks.onConnected?.();
  });

  eventSource.addEventListener('text', (e) => {
    const event = JSON.parse(e.data);
    callbacks.onEvent?.(event);
    callbacks.onText?.(event.content, event.isPartial);
  });

  eventSource.addEventListener('thinking', (e) => {
    const event = JSON.parse(e.data);
    callbacks.onEvent?.(event);
    callbacks.onThinking?.(event.content);
  });

  eventSource.addEventListener('tool_use', (e) => {
    const event = JSON.parse(e.data);
    callbacks.onEvent?.(event);
    callbacks.onToolUse?.(event.toolName, event.toolId, event.input);
  });

  eventSource.addEventListener('tool_result', (e) => {
    const event = JSON.parse(e.data);
    callbacks.onEvent?.(event);
    callbacks.onToolResult?.(event.toolId, event.result, event.success);
  });

  eventSource.addEventListener('file_edit', (e) => {
    const event = JSON.parse(e.data);
    callbacks.onEvent?.(event);
    callbacks.onFileEdit?.(event.filePath, event.action, event.diff);
  });

  eventSource.addEventListener('bash_command', (e) => {
    const event = JSON.parse(e.data);
    callbacks.onEvent?.(event);
    callbacks.onBashCommand?.(event.command);
  });

  eventSource.addEventListener('bash_output', (e) => {
    const event = JSON.parse(e.data);
    callbacks.onEvent?.(event);
    callbacks.onBashOutput?.(event.output, event.isStderr);
  });

  eventSource.addEventListener('subagent_spawn', (e) => {
    const event = JSON.parse(e.data);
    callbacks.onEvent?.(event);
    callbacks.onSubAgentSpawn?.(event.subAgentId, event.description);
  });

  eventSource.addEventListener('subagent_result', (e) => {
    const event = JSON.parse(e.data);
    callbacks.onEvent?.(event);
    callbacks.onSubAgentResult?.(event.subAgentId, event.result, event.success);
  });

  eventSource.addEventListener('progress', (e) => {
    const event = JSON.parse(e.data);
    callbacks.onEvent?.(event);
    callbacks.onProgress?.(event.phase, event.message, event.percentage);
  });

  eventSource.addEventListener('error', (e) => {
    const event = JSON.parse(e.data);
    callbacks.onEvent?.(event);
    callbacks.onError?.(event.message, event.recoverable);
  });

  eventSource.addEventListener('warning', (e) => {
    const event = JSON.parse(e.data);
    callbacks.onEvent?.(event);
    callbacks.onWarning?.(event.message);
  });

  eventSource.addEventListener('session_end', (e) => {
    const event = JSON.parse(e.data);
    callbacks.onEvent?.(event);
    callbacks.onSessionEnd?.(event.success, event.summary, event.filesModified, event.duration);
    eventSource.close();
    callbacks.onDisconnected?.();
  });

  eventSource.addEventListener('close', () => {
    eventSource.close();
    callbacks.onDisconnected?.();
  });

  eventSource.onerror = () => {
    callbacks.onDisconnected?.();
  };

  // Return cleanup function
  return () => {
    eventSource.close();
  };
}

// Get the base URL for assets (uses Tailscale IP if available)
export function getAssetBaseUrl(tailscaleIp: string | null, port: number = 3892): string {
  if (tailscaleIp) {
    return `http://${tailscaleIp}:${port}`;
  }
  return '';
}

export function getScreenshotUrl(repoFullName: string, branch: string, tailscaleIp?: string | null): string {
  const base = tailscaleIp ? getAssetBaseUrl(tailscaleIp) : '';
  return `${base}/preview/${encodeURIComponent(repoFullName)}/${encodeURIComponent(branch)}.png`;
}

export function getRunScreenshotUrl(repoFullName: string, branch: string, runId: string, tailscaleIp?: string | null): string {
  const safeName = repoFullName.replace(/\//g, '_');
  const safeBranch = branch.replace(/\//g, '_');
  const base = tailscaleIp ? getAssetBaseUrl(tailscaleIp) : '';
  return `${base}/data/screenshots/${safeName}/${safeBranch}/${runId}.png`;
}

export function getDiffScreenshotUrl(repoFullName: string, branch: string, runId: string, tailscaleIp?: string | null): string {
  const safeName = repoFullName.replace(/\//g, '_');
  const safeBranch = branch.replace(/\//g, '_');
  const base = tailscaleIp ? getAssetBaseUrl(tailscaleIp) : '';
  return `${base}/data/screenshots/${safeName}/${safeBranch}/${runId}_diff.png`;
}
