/**
 * Code Agent - Wrapper for Claude Code CLI
 * Handles code fixes for issues found by the test agent
 */

import { spawn } from 'child_process';
import { join } from 'path';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { BaseAgent, registerAgent } from './base.js';
import type {
  AgentContext,
  AgentResult,
  TestResult,
  CodeAgentResult,
} from './types.js';
import { PROCESS_TIMEOUT } from './types.js';
import { getContextFor } from './rag/index.js';
import { info, warn, error as logError } from '../logging/logger.js';

/**
 * Build prompt for fixing issues
 */
function buildFixPrompt(context: AgentContext, testResult: TestResult): string {
  const { repoFullName, branch, commitMessage, changedFiles } = context;

  let prompt = `You are an expert software engineer. Fix the following test failures for the "${repoFullName}" project.

PROJECT CONTEXT:
- Repository: ${repoFullName}
- Branch: ${branch}
${commitMessage ? `- Recent commit: ${commitMessage}` : ''}
${changedFiles?.length ? `- Recently changed files: ${changedFiles.join(', ')}` : ''}

**TEST RESULTS:**
- Score: ${testResult.score}%
- Tests Passed: ${testResult.testsPassed}
- Tests Failed: ${testResult.testsFailed}
- Summary: ${testResult.summary}

`;

  // Add failure details
  if (testResult.failures.length > 0) {
    prompt += `**FAILURES (${testResult.failures.length} total):**\n`;

    const consoleErrors = testResult.failures.filter(f => f.type === 'console-error');
    const networkErrors = testResult.failures.filter(f => f.type === 'network-error');
    const functionalErrors = testResult.failures.filter(f => f.type === 'functional-error');
    const visualErrors = testResult.failures.filter(f => f.type === 'visual-error');

    if (consoleErrors.length > 0) {
      prompt += `\nConsole Errors:\n`;
      consoleErrors.forEach((f, i) => {
        prompt += `${i + 1}. ${f.error}\n`;
      });
    }

    if (networkErrors.length > 0) {
      prompt += `\nNetwork Errors:\n`;
      networkErrors.forEach((f, i) => {
        prompt += `${i + 1}. ${f.error}\n`;
      });
    }

    if (functionalErrors.length > 0) {
      prompt += `\nFunctional Errors:\n`;
      functionalErrors.forEach((f, i) => {
        prompt += `${i + 1}. ${f.error}\n`;
      });
    }

    if (visualErrors.length > 0) {
      prompt += `\nVisual Errors:\n`;
      visualErrors.forEach((f, i) => {
        prompt += `${i + 1}. ${f.error}\n`;
      });
    }
  }

  // Add console errors
  if (testResult.consoleErrors.length > 0) {
    prompt += `\n**CONSOLE ERRORS:**\n`;
    testResult.consoleErrors.forEach((err, i) => {
      prompt += `${i + 1}. ${err}\n`;
    });
  }

  // Add network errors
  if (testResult.networkErrors.length > 0) {
    prompt += `\n**NETWORK ERRORS:**\n`;
    testResult.networkErrors.forEach((err, i) => {
      prompt += `${i + 1}. ${err}\n`;
    });
  }

  prompt += `
**REQUIREMENTS:**
1. Fix all test failures listed above
2. Maintain existing functionality
3. Follow project coding standards
4. Do not introduce new bugs
5. Focus on the most critical issues first
6. Make minimal changes necessary to fix the issues

**OUTPUT FORMAT:**
After making fixes, provide a summary in this exact format:
---FIX_RESULTS---
CHANGES_APPLIED: [number]
FILES_MODIFIED: [comma-separated list of file paths]
SUMMARY: [brief description of what was fixed]
---END_RESULTS---

Please fix these issues and provide a summary of changes made.`;

  return prompt;
}

/**
 * Parse fix output to extract structured results
 */
function parseFixOutput(output: string): CodeAgentResult {
  let changesApplied = 0;
  let files: string[] = [];
  let summary = '';

  // Try to extract structured results
  const resultsMatch = output.match(/---FIX_RESULTS---([\s\S]*?)---END_RESULTS---/);
  if (resultsMatch) {
    const results = resultsMatch[1];

    const changesMatch = results.match(/CHANGES_APPLIED:\s*(\d+)/);
    if (changesMatch) changesApplied = parseInt(changesMatch[1], 10);

    const filesMatch = results.match(/FILES_MODIFIED:\s*(.+)/);
    if (filesMatch && filesMatch[1].trim().toLowerCase() !== 'none') {
      files = filesMatch[1].split(',').map(f => f.trim()).filter(f => f.length > 0);
    }

    const summaryMatch = results.match(/SUMMARY:\s*(.+)/);
    if (summaryMatch) summary = summaryMatch[1].trim();
  }

  // Fallback: infer from output
  if (changesApplied === 0 && !resultsMatch) {
    // Look for common edit patterns in Claude Code output
    const editMatches = output.match(/(?:edited|modified|updated|created|fixed)\s+(?:file\s+)?([^\s]+)/gi);
    if (editMatches) {
      changesApplied = editMatches.length;
      // Extract file paths
      editMatches.forEach(match => {
        const fileMatch = match.match(/([^\s]+\.\w+)/);
        if (fileMatch) files.push(fileMatch[1]);
      });
    }
    summary = changesApplied > 0 ? `Applied ${changesApplied} fixes` : 'No changes needed';
  }

  return {
    success: changesApplied > 0 || output.toLowerCase().includes('no changes needed'),
    changesApplied,
    files: [...new Set(files)], // Remove duplicates
    summary,
    rawOutput: output,
  };
}

/**
 * Code Agent implementation
 */
class CodeAgentImpl extends BaseAgent {
  name = 'code-agent';
  description = 'Code implementation and fixing agent using Claude Code CLI';

  async execute(
    context: AgentContext,
    options?: {
      mode: 'fix';
      testResult: TestResult;
    }
  ): Promise<AgentResult> {
    const { repoFullName, projectPath, logsDir } = context;
    const testResult = options?.testResult;

    if (!testResult) {
      return this.failure('No test results provided');
    }

    info(`Starting code agent to fix ${testResult.failures.length} issues`, 'CodeAgent');

    // Ensure log directory exists
    if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });

    // Get RAG context for project patterns
    const ragContext = await getContextFor(
      `${repoFullName} coding patterns style`,
      repoFullName,
      ['instruction', 'feedback', 'config']
    );

    // Build the fix prompt
    const prompt = buildFixPrompt(context, testResult);

    try {
      // Run Claude Code
      const result = await this.runClaudeCode(prompt, projectPath, logsDir);

      // Parse the results
      const fixResult = parseFixOutput(result.output);

      info(`Fix completed: ${fixResult.changesApplied} changes applied`, 'CodeAgent');

      return this.success(fixResult.summary, {
        fixResult,
        changesApplied: fixResult.changesApplied,
        files: fixResult.files,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError(`Code agent error: ${message}`, 'CodeAgent');
      return this.failure(`Code fix error: ${message}`);
    }
  }

  /**
   * Run Claude Code CLI
   */
  private runClaudeCode(
    prompt: string,
    projectPath: string,
    logsDir: string
  ): Promise<{ success: boolean; output: string }> {
    return new Promise((resolve, reject) => {
      const args = [
        '-p', // print mode (non-interactive)
        '--output-format', 'text',
        '--dangerously-skip-permissions', // Allow file edits without prompts
        prompt,
      ];

      const proc = spawn('claude', args, {
        cwd: projectPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: PROCESS_TIMEOUT,
        env: process.env,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        // Save output to log
        const logPath = join(logsDir, 'code-agent.log');
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
        reject(new Error(`Failed to run Claude Code: ${error.message}`));
      });
    });
  }
}

// Create and register the agent
export const codeAgent = new CodeAgentImpl();
registerAgent(codeAgent);

/**
 * Fix issues using Claude Code
 */
export async function fixIssues(
  context: AgentContext,
  testResult: TestResult
): Promise<CodeAgentResult> {
  const result = await codeAgent.execute(context, { mode: 'fix', testResult });

  if (result.artifacts?.fixResult) {
    return result.artifacts.fixResult as CodeAgentResult;
  }

  return {
    success: result.success,
    changesApplied: 0,
    files: [],
    summary: result.summary,
  };
}
