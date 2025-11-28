import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', 'config', 'config.json');
const CONFIG_DIR = dirname(CONFIG_PATH);

export type ProfileType =
  | 'ios-capacitor'
  | 'web-generic'
  | 'node-service'
  | 'android-capacitor'
  | 'tauri-app'
  | 'custom';

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

export interface RepoConfig {
  repoFullName: string;
  localPath: string;
  enabled: boolean;
  profile: ProfileType;
  webhookId?: number;
  devPort?: number;
  lastRuns?: RunRecord[];
}

export interface AppConfig {
  repos: RepoConfig[];
  webhookBaseUrl: string;
  defaultPort: number;
}

let configCache: AppConfig | null = null;
let saveTimeout: NodeJS.Timeout | null = null;

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function getDefaultConfig(): AppConfig {
  return {
    repos: [],
    webhookBaseUrl: 'https://YOUR-FUNNEL-URL',
    defaultPort: 3000,
  };
}

export function loadConfig(): AppConfig {
  if (configCache) {
    return configCache;
  }

  ensureConfigDir();

  if (!existsSync(CONFIG_PATH)) {
    const defaultConfig = getDefaultConfig();
    writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
    configCache = defaultConfig;
    return configCache;
  }

  try {
    const content = readFileSync(CONFIG_PATH, 'utf-8');
    configCache = JSON.parse(content) as AppConfig;
    return configCache;
  } catch (error) {
    console.error('Error loading config, using defaults:', error);
    configCache = getDefaultConfig();
    return configCache;
  }
}

function saveConfigImmediate(): void {
  if (!configCache) return;

  ensureConfigDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(configCache, null, 2));
}

export function saveConfig(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    saveConfigImmediate();
    saveTimeout = null;
  }, 500);
}

export function saveConfigSync(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  saveConfigImmediate();
}

export function getConfigs(): RepoConfig[] {
  const config = loadConfig();
  return config.repos;
}

export function getRepoConfig(repoFullName: string): RepoConfig | undefined {
  const config = loadConfig();
  return config.repos.find((r) => r.repoFullName === repoFullName);
}

export function addRepoConfig(repo: RepoConfig): void {
  const config = loadConfig();
  const existingIndex = config.repos.findIndex(
    (r) => r.repoFullName === repo.repoFullName
  );

  if (existingIndex >= 0) {
    config.repos[existingIndex] = { ...config.repos[existingIndex], ...repo };
  } else {
    config.repos.push(repo);
  }

  saveConfig();
}

export function updateRepoConfig(
  repoFullName: string,
  updates: Partial<RepoConfig>
): RepoConfig | null {
  const config = loadConfig();
  const repo = config.repos.find((r) => r.repoFullName === repoFullName);

  if (!repo) {
    return null;
  }

  Object.assign(repo, updates);
  saveConfig();
  return repo;
}

export function deleteRepoConfig(repoFullName: string): boolean {
  const config = loadConfig();
  const index = config.repos.findIndex((r) => r.repoFullName === repoFullName);

  if (index < 0) {
    return false;
  }

  config.repos.splice(index, 1);
  saveConfig();
  return true;
}

export function addRunRecord(repoFullName: string, run: RunRecord): void {
  const config = loadConfig();
  const repo = config.repos.find((r) => r.repoFullName === repoFullName);

  if (!repo) {
    return;
  }

  if (!repo.lastRuns) {
    repo.lastRuns = [];
  }

  repo.lastRuns.unshift(run);

  if (repo.lastRuns.length > 50) {
    repo.lastRuns = repo.lastRuns.slice(0, 50);
  }

  saveConfig();
}

export function updateRunRecord(
  repoFullName: string,
  runId: string,
  updates: Partial<RunRecord>
): void {
  const config = loadConfig();
  const repo = config.repos.find((r) => r.repoFullName === repoFullName);

  if (!repo || !repo.lastRuns) {
    return;
  }

  const run = repo.lastRuns.find((r) => r.runId === runId);
  if (run) {
    Object.assign(run, updates);
    saveConfig();
  }
}

export function getWebhookBaseUrl(): string {
  const config = loadConfig();
  return config.webhookBaseUrl;
}

export function setWebhookBaseUrl(url: string): void {
  const config = loadConfig();
  config.webhookBaseUrl = url;
  saveConfig();
}

export function getLatestRun(
  repoFullName: string,
  branch?: string
): RunRecord | undefined {
  const repo = getRepoConfig(repoFullName);
  if (!repo || !repo.lastRuns || repo.lastRuns.length === 0) {
    return undefined;
  }

  if (branch) {
    return repo.lastRuns.find((r) => r.branch === branch);
  }

  return repo.lastRuns[0];
}
