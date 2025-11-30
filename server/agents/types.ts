/**
 * Type definitions for Testing and Coding Agents
 */

import type { RepoConfig } from '../config.js';

/**
 * Test result from running the test agent
 */
export interface TestResult {
  success: boolean;
  summary: string;
  failures: TestFailure[];
  consoleErrors: string[];
  networkErrors: string[];
  screenshotPaths: string[];
  testsPassed: number;
  testsFailed: number;
  score: number; // 0-100 percentage
}

/**
 * Individual test failure details
 */
export interface TestFailure {
  path: string;
  feature?: string;
  error: string;
  type: 'console-error' | 'network-error' | 'functional-error' | 'visual-error';
  screenshot?: string;
}

/**
 * Result from Claude Code execution
 */
export interface CodeAgentResult {
  success: boolean;
  changesApplied: number;
  files: string[];
  summary: string;
  rawOutput?: unknown;
}

/**
 * Result from a single test-fix iteration
 */
export interface IterationResult {
  iteration: number;
  phase: 'test' | 'fix';
  testResult?: TestResult;
  fixResult?: CodeAgentResult;
  score: number;
  timestamp: string;
  duration: number;
}

/**
 * Complete workflow result
 */
export interface WorkflowResult {
  success: boolean;
  summary: string;
  iterations: IterationResult[];
  finalScore: number;
  duration: number;
  screenshotPaths: string[];
}

/**
 * Testing configuration for a repository
 */
export interface TestingConfig {
  enabled: boolean;
  testingUrl?: string;
  maxIterations: number;
  passThreshold: number; // Score threshold to consider passing (default 95)
  testingProfile: TestingProfile;
  credentials?: CredentialData;
  mobileConfig?: MobileTestingConfig;
}

/**
 * Testing profile types
 */
export type TestingProfile = 'web' | 'ios-capacitor' | 'android-capacitor' | 'both-mobile';

/**
 * Mobile testing configuration for Capacitor apps
 */
export interface MobileTestingConfig {
  iosEnabled: boolean;
  androidEnabled: boolean;
  iosBundleId?: string;
  androidPackage?: string;
  iosSimulator?: string;
  androidEmulator?: string;
}

/**
 * Credential data for authentication
 */
export interface CredentialData {
  username: string;
  password: string;
  loginSelectors?: LoginSelectors;
  baseUrl?: string;
}

/**
 * Login form selectors
 */
export interface LoginSelectors {
  usernameField: string;
  passwordField: string;
  submitButton: string;
}

/**
 * Agent context passed to agent execute methods
 */
export interface AgentContext {
  repoFullName: string;
  projectPath: string;
  branch: string;
  commitMessage?: string;
  changedFiles?: string[];
  testingConfig: TestingConfig;
  runId: string;
  logsDir: string;
  screenshotsDir: string;
}

/**
 * Agent execution result
 */
export interface AgentResult {
  success: boolean;
  summary: string;
  artifacts?: Record<string, unknown>;
}

/**
 * MCP Server configuration
 */
export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * MCP configurations for different testing profiles
 */
export interface McpConfigurations {
  playwright: McpServerConfig;
  mobilenext?: McpServerConfig;
}

/**
 * Constants
 */
export const DEFAULT_MAX_ITERATIONS = 5;
export const DEFAULT_PASS_THRESHOLD = 95;
export const PROCESS_TIMEOUT = 300000; // 5 minutes

/**
 * Default testing configuration
 */
export function getDefaultTestingConfig(): TestingConfig {
  return {
    enabled: true,
    maxIterations: DEFAULT_MAX_ITERATIONS,
    passThreshold: DEFAULT_PASS_THRESHOLD,
    testingProfile: 'web',
  };
}
