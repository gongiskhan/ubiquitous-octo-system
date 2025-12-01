/**
 * Test Agent - Autonomous web and mobile application testing
 * Uses Claude Code with Playwright MCP and MobileNext MCP
 */

import { spawn } from 'child_process';
import { join } from 'path';
import { writeFileSync, existsSync, mkdirSync, unlinkSync, readFileSync } from 'fs';
import { BaseAgent, registerAgent } from './base.js';
import type {
  AgentContext,
  AgentResult,
  TestResult,
  TestFailure,
  McpConfigurations,
  PROCESS_TIMEOUT,
} from './types.js';
import {
  getContextFor,
  storeTestResult,
  getCredentials,
} from './rag/index.js';
import { info, warn, error as logError } from '../logging/logger.js';

/**
 * Build system prompt for testing
 */
function buildTestPrompt(context: AgentContext, ragContext: unknown[]): string {
  const { testingConfig, commitMessage, changedFiles, repoFullName, branch } = context;
  const url = testingConfig.testingUrl;

  let prompt = `You are an autonomous application testing agent. Your role is to thoroughly test applications and identify issues.

PROJECT CONTEXT:
- Repository: ${repoFullName}
- Branch: ${branch}
${commitMessage ? `- Recent commit: ${commitMessage}` : ''}
${changedFiles?.length ? `- Changed files: ${changedFiles.join(', ')}` : ''}

`;

  if (testingConfig.testingProfile === 'web') {
    prompt += `TESTING MODE: Web Application
URL to test: ${url || 'http://localhost:3000'}

TESTING INSTRUCTIONS:
1. Navigate to the URL
2. Check if the page loads successfully (verify HTTP status)
3. Monitor the browser console for JavaScript errors
4. Test interactive elements (buttons, forms, links) by clicking/interacting with them
5. Check for broken images or resources (404 errors)
6. Validate that key page elements render correctly
7. Look for HTTP 4xx/5xx errors in network requests
8. Test basic user flows if applicable

`;
  } else if (testingConfig.testingProfile === 'ios-capacitor' || testingConfig.testingProfile === 'both-mobile') {
    prompt += `TESTING MODE: iOS Capacitor App
${testingConfig.mobileConfig?.iosBundleId ? `Bundle ID: ${testingConfig.mobileConfig.iosBundleId}` : ''}
${testingConfig.mobileConfig?.iosSimulator ? `Simulator: ${testingConfig.mobileConfig.iosSimulator}` : ''}

iOS TESTING INSTRUCTIONS:
1. Launch the iOS simulator and app
2. Test app launch and initial load
3. Navigate through main screens
4. Test key user interactions
5. Check for crashes or ANRs
6. Verify UI renders correctly
7. Test offline behavior if applicable
8. Capture screenshots of each screen tested

`;
  }

  if (testingConfig.testingProfile === 'android-capacitor' || testingConfig.testingProfile === 'both-mobile') {
    prompt += `TESTING MODE: Android Capacitor App
${testingConfig.mobileConfig?.androidPackage ? `Package: ${testingConfig.mobileConfig.androidPackage}` : ''}
${testingConfig.mobileConfig?.androidEmulator ? `Emulator: ${testingConfig.mobileConfig.androidEmulator}` : ''}

Android TESTING INSTRUCTIONS:
1. Launch the Android emulator and app
2. Test app launch and initial load
3. Navigate through main screens
4. Test key user interactions
5. Check for crashes or ANRs
6. Verify UI renders correctly
7. Test offline behavior if applicable
8. Capture screenshots of each screen tested

`;
  }

  // Add focus area based on commit changes
  if (commitMessage && changedFiles?.length) {
    prompt += `**FOCUS AREA (HIGH PRIORITY):**
The recent commit "${commitMessage}" modified: ${changedFiles.join(', ')}
Prioritize testing areas affected by these changes.

`;
  }

  // Add credentials if available
  const credential = (ragContext as any[]).find((c: any) => c.type === 'credential');
  if (credential?.metadata?.username) {
    prompt += `**AUTHENTICATION:**
This application requires login. Use these credentials:
- Username: ${credential.metadata.username}
- Password: ${credential.metadata.password}

Login selectors:
- Username field: ${credential.metadata.loginSelectors?.usernameField || "input[type='email'], input[name='email'], input[name='username']"}
- Password field: ${credential.metadata.loginSelectors?.passwordField || "input[type='password'], input[name='password']"}
- Submit button: ${credential.metadata.loginSelectors?.submitButton || "button[type='submit']"}

First log in, then proceed with testing authenticated areas.
`;
  } else if (testingConfig.credentials) {
    prompt += `**AUTHENTICATION:**
This application requires login. Use these credentials:
- Username: ${testingConfig.credentials.username}
- Password: ${testingConfig.credentials.password}

`;
  }

  // Add learned wisdom from RAG
  const feedback = (ragContext as any[]).filter((c: any) => c.type === 'feedback' || c.type === 'instruction');
  if (feedback.length > 0) {
    prompt += `**LEARNED TESTING WISDOM:**
Apply these learnings from previous tests:
${feedback.map((f: any) => `- ${f.content}`).join('\n')}

`;
  }

  prompt += `**SCORING:**
After testing, provide a score from 0-100 based on:
- 100: All tests pass, no errors, no issues
- 90-99: Minor issues (cosmetic, non-blocking)
- 70-89: Moderate issues (functionality affected but app usable)
- 50-69: Significant issues (major features broken)
- 0-49: Critical issues (app crashes, data loss, security issues)

**OUTPUT FORMAT:**
End your response with a structured summary in this exact format:
---TEST_RESULTS---
SCORE: [0-100]
PASSED: [number of tests passed]
FAILED: [number of tests failed]
CONSOLE_ERRORS: [comma-separated list or "none"]
NETWORK_ERRORS: [comma-separated list or "none"]
SUMMARY: [brief summary of findings]
---END_RESULTS---

Be thorough but efficient. Focus on finding real issues.`;

  return prompt;
}

/**
 * Parse test output to extract structured results
 */
function parseTestOutput(output: string): TestResult {
  const failures: TestFailure[] = [];
  const consoleErrors: string[] = [];
  const networkErrors: string[] = [];
  const screenshotPaths: string[] = [];

  let score = 0;
  let testsPassed = 0;
  let testsFailed = 0;
  let summary = '';

  // Try to extract structured results
  const resultsMatch = output.match(/---TEST_RESULTS---([\s\S]*?)---END_RESULTS---/);
  if (resultsMatch) {
    const results = resultsMatch[1];

    const scoreMatch = results.match(/SCORE:\s*(\d+)/);
    if (scoreMatch) score = parseInt(scoreMatch[1], 10);

    const passedMatch = results.match(/PASSED:\s*(\d+)/);
    if (passedMatch) testsPassed = parseInt(passedMatch[1], 10);

    const failedMatch = results.match(/FAILED:\s*(\d+)/);
    if (failedMatch) testsFailed = parseInt(failedMatch[1], 10);

    const consoleMatch = results.match(/CONSOLE_ERRORS:\s*(.+)/);
    if (consoleMatch && consoleMatch[1].trim().toLowerCase() !== 'none') {
      consoleErrors.push(...consoleMatch[1].split(',').map(e => e.trim()));
      consoleErrors.forEach(err => {
        failures.push({ path: 'console', error: err, type: 'console-error' });
      });
    }

    const networkMatch = results.match(/NETWORK_ERRORS:\s*(.+)/);
    if (networkMatch && networkMatch[1].trim().toLowerCase() !== 'none') {
      networkErrors.push(...networkMatch[1].split(',').map(e => e.trim()));
      networkErrors.forEach(err => {
        failures.push({ path: 'network', error: err, type: 'network-error' });
      });
    }

    const summaryMatch = results.match(/SUMMARY:\s*(.+)/);
    if (summaryMatch) summary = summaryMatch[1].trim();
  }

  // Fallback: try to infer from output
  if (score === 0 && !resultsMatch) {
    const hasErrors = output.toLowerCase().includes('error') ||
                      output.toLowerCase().includes('failed') ||
                      output.toLowerCase().includes('broken');
    score = hasErrors ? 50 : 100;
    testsPassed = hasErrors ? 0 : 1;
    testsFailed = hasErrors ? 1 : 0;
    summary = hasErrors ? 'Issues detected during testing' : 'Test completed successfully';
  }

  return {
    success: score >= 95,
    summary,
    failures,
    consoleErrors,
    networkErrors,
    screenshotPaths,
    testsPassed,
    testsFailed,
    score,
  };
}

/**
 * Get MCP configurations based on testing profile
 */
function getMcpConfig(context: AgentContext): McpConfigurations {
  const config: McpConfigurations = {
    playwright: {
      command: 'npx',
      args: ['@playwright/mcp@latest'],
    },
  };

  // Add MobileNext MCP for Capacitor app testing
  if (
    context.testingConfig.testingProfile === 'ios-capacitor' ||
    context.testingConfig.testingProfile === 'android-capacitor' ||
    context.testingConfig.testingProfile === 'both-mobile'
  ) {
    config.mobilenext = {
      command: 'npx',
      args: ['@anthropic-ai/mobilenext-mcp@latest'],
      env: {
        MOBILENEXT_API_URL: 'https://mobilenexthq.com',
      },
    };
  }

  return config;
}

/**
 * Test Agent implementation
 */
class TestAgentImpl extends BaseAgent {
  name = 'test-agent';
  description = 'Autonomous web and mobile application testing agent';

  async execute(
    context: AgentContext,
    options?: { description?: string; instruction?: string }
  ): Promise<AgentResult> {
    const { repoFullName, projectPath, testingConfig, logsDir, screenshotsDir, runId } = context;

    if (!testingConfig.enabled) {
      return this.success('Testing disabled', { skipped: true });
    }

    info(`Starting test agent for ${repoFullName}`, 'TestAgent');

    // Ensure directories exist
    if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
    if (!existsSync(screenshotsDir)) mkdirSync(screenshotsDir, { recursive: true });

    // Get RAG context
    const ragContext = await getContextFor(
      `${repoFullName} testing ${testingConfig.testingProfile}`,
      repoFullName
    );

    // Build the test prompt
    const prompt = buildTestPrompt(context, ragContext);

    // Get MCP configuration
    const mcpConfig = getMcpConfig(context);

    try {
      // Run Claude Code with MCP servers
      const result = await this.runClaudeCode(prompt, projectPath, mcpConfig, logsDir);

      // Parse the results
      const testResult = parseTestOutput(result.output);

      // Store result in RAG for learning
      await storeTestResult(
        repoFullName,
        testingConfig.testingUrl || 'local',
        testResult.summary,
        {
          status: testResult.success ? 'pass' : 'fail',
          score: testResult.score,
          consoleErrors: testResult.consoleErrors,
          networkErrors: testResult.networkErrors,
        }
      );

      info(`Test completed with score: ${testResult.score}%`, 'TestAgent');

      return this.success(testResult.summary, {
        testResult,
        score: testResult.score,
        testsPassed: testResult.testsPassed,
        testsFailed: testResult.testsFailed,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError(`Test execution error: ${message}`, 'TestAgent');
      return this.failure(`Test execution error: ${message}`);
    }
  }

  /**
   * Run Claude Code with MCP servers
   * MCP servers are configured via .mcp.json file in the project directory
   */
  private runClaudeCode(
    prompt: string,
    projectPath: string,
    mcpConfig: McpConfigurations,
    logsDir: string
  ): Promise<{ success: boolean; output: string }> {
    return new Promise((resolve, reject) => {
      const mcpConfigPath = join(projectPath, '.mcp.json');
      let existingMcpConfig: string | null = null;

      // Backup existing .mcp.json if it exists
      if (existsSync(mcpConfigPath)) {
        existingMcpConfig = readFileSync(mcpConfigPath, 'utf-8');
      }

      // Build MCP configuration object
      const mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {
        playwright: {
          command: mcpConfig.playwright.command,
          args: mcpConfig.playwright.args,
        },
      };

      // Add MobileNext MCP if configured
      if (mcpConfig.mobilenext) {
        mcpServers.mobilenext = {
          command: mcpConfig.mobilenext.command,
          args: mcpConfig.mobilenext.args,
          ...(mcpConfig.mobilenext.env && { env: mcpConfig.mobilenext.env }),
        };
      }

      // Write MCP config file
      const mcpConfigContent = JSON.stringify({ mcpServers }, null, 2);
      writeFileSync(mcpConfigPath, mcpConfigContent, 'utf-8');
      info(`Wrote MCP config to ${mcpConfigPath}`, 'TestAgent');

      const args = [
        '-p', // print mode
        '--output-format', 'text',
        prompt,
      ];

      const proc = spawn('claude', args, {
        cwd: projectPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 300000, // 5 minutes
        env: {
          ...process.env,
          ...(mcpConfig.mobilenext?.env || {}),
        },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const cleanup = () => {
        // Restore original .mcp.json or remove the one we created
        try {
          if (existingMcpConfig !== null) {
            writeFileSync(mcpConfigPath, existingMcpConfig, 'utf-8');
          } else {
            unlinkSync(mcpConfigPath);
          }
        } catch (cleanupError) {
          warn(`Failed to cleanup MCP config: ${cleanupError}`, 'TestAgent');
        }
      };

      proc.on('close', (code) => {
        cleanup();

        // Save output to log
        const logPath = join(logsDir, 'test-agent.log');
        writeFileSync(logPath, `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`, 'utf-8');

        if (code !== 0 && code !== null) {
          // Still try to parse output even on non-zero exit
          if (stdout.length > 0) {
            resolve({ success: false, output: stdout });
          } else {
            reject(new Error(`Claude Code exited with code ${code}: ${stderr}`));
          }
          return;
        }

        resolve({ success: true, output: stdout });
      });

      proc.on('error', (error) => {
        cleanup();
        reject(new Error(`Failed to run Claude Code: ${error.message}`));
      });
    });
  }
}

// Create and register the agent
export const testAgent = new TestAgentImpl();
registerAgent(testAgent);

/**
 * Run test and return structured result
 */
export async function runTest(context: AgentContext): Promise<TestResult> {
  const result = await testAgent.execute(context);

  if (result.artifacts?.testResult) {
    return result.artifacts.testResult as TestResult;
  }

  return {
    success: result.success,
    summary: result.summary,
    failures: [],
    consoleErrors: [],
    networkErrors: [],
    screenshotPaths: [],
    testsPassed: result.success ? 1 : 0,
    testsFailed: result.success ? 0 : 1,
    score: result.success ? 100 : 0,
  };
}
