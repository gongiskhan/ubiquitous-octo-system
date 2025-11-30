import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

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
  diffPercentage: number;
  diffPixelCount: number;
  diffImagePath?: string;
  previousScreenshotPath?: string;
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

export interface BuildOptions {
  buildTimeout?: number;
  runtimeTimeout?: number;
  screenshotTimeout?: number;
  screenshotDelay?: number;
  simulatorDevice?: string;
  androidAvd?: string;
  envVars?: Record<string, string>;
}

export interface RepoConfig {
  repoFullName: string;
  localPath: string;
  enabled: boolean;
  profile: ProfileType;
  webhookId?: number;
  devPort?: number;
  detectedPort?: number;
  lastRuns?: RunRecord[];
  buildOptions?: BuildOptions;
  autoCloned?: boolean;
  testingConfig?: TestingConfig;
}

export interface AppConfig {
  repos: RepoConfig[];
  webhookBaseUrl: string;
  defaultPort: number;
  cloneBaseDir: string;
  cacheEnabled: boolean;
  defaultBuildOptions: BuildOptions;
  defaultTestingConfig: TestingConfig;
}

let configCache: AppConfig | null = null;
let saveTimeout: NodeJS.Timeout | null = null;

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function getDefaultCloneDir(): string {
  return join(os.homedir(), 'branchrunner-repos');
}

function getDefaultTestingConfig(): TestingConfig {
  return {
    enabled: true,
    maxIterations: 5,
    passThreshold: 95,
    testingProfile: 'web',
  };
}

function getDefaultConfig(): AppConfig {
  return {
    repos: [],
    webhookBaseUrl: 'https://YOUR-FUNNEL-URL',
    defaultPort: 3000,
    cloneBaseDir: getDefaultCloneDir(),
    cacheEnabled: true,
    defaultBuildOptions: {
      buildTimeout: 240000,
      runtimeTimeout: 60000,
      screenshotTimeout: 10000,
      screenshotDelay: 2000,
    },
    defaultTestingConfig: getDefaultTestingConfig(),
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
    const loaded = JSON.parse(content) as Partial<AppConfig>;
    configCache = {
      ...getDefaultConfig(),
      ...loaded,
    };
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

  if (repo.lastRuns.length > 100) {
    repo.lastRuns = repo.lastRuns.slice(0, 100);
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

export function getCloneBaseDir(): string {
  const config = loadConfig();
  return config.cloneBaseDir;
}

export function setCloneBaseDir(dir: string): void {
  const config = loadConfig();
  config.cloneBaseDir = dir;
  saveConfig();
}

export function isCacheEnabled(): boolean {
  const config = loadConfig();
  return config.cacheEnabled;
}

export function setCacheEnabled(enabled: boolean): void {
  const config = loadConfig();
  config.cacheEnabled = enabled;
  saveConfig();
}

export function getDefaultBuildOptions(): BuildOptions {
  const config = loadConfig();
  return config.defaultBuildOptions;
}

export function setDefaultBuildOptions(options: BuildOptions): void {
  const config = loadConfig();
  config.defaultBuildOptions = { ...config.defaultBuildOptions, ...options };
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

export function getRunsByBranch(
  repoFullName: string,
  branch: string,
  limit: number = 20
): RunRecord[] {
  const repo = getRepoConfig(repoFullName);
  if (!repo || !repo.lastRuns) {
    return [];
  }

  return repo.lastRuns
    .filter((r) => r.branch === branch)
    .slice(0, limit);
}

export function getPreviousSuccessfulRun(
  repoFullName: string,
  branch: string,
  excludeRunId: string
): RunRecord | undefined {
  const repo = getRepoConfig(repoFullName);
  if (!repo || !repo.lastRuns) {
    return undefined;
  }

  return repo.lastRuns.find(
    (r) => r.branch === branch && r.status === 'success' && r.runId !== excludeRunId && r.screenshotPath
  );
}

export function getEffectiveBuildOptions(repo: RepoConfig): BuildOptions {
  const config = loadConfig();
  return {
    ...config.defaultBuildOptions,
    ...(repo.buildOptions || {}),
  };
}

export function getEffectiveTestingConfig(repo: RepoConfig): TestingConfig {
  const config = loadConfig();
  return {
    ...config.defaultTestingConfig,
    ...(repo.testingConfig || {}),
  };
}

export function getDefaultTestingOptions(): TestingConfig {
  const config = loadConfig();
  return config.defaultTestingConfig;
}

export function setDefaultTestingOptions(options: Partial<TestingConfig>): void {
  const config = loadConfig();
  config.defaultTestingConfig = { ...config.defaultTestingConfig, ...options };
  saveConfig();
}
