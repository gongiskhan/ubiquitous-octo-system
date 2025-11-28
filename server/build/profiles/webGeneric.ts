import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { chromium, type Browser, type Page } from 'playwright';
import { FileLogger } from '../../logging/logger.js';
import { runCommand, spawnProcess } from '../runner.js';
import type { ProfileContext, ProfileResult } from './profileTypes.js';
import type { ChildProcess } from 'child_process';

const DEFAULT_PORTS = [3000, 5173, 4200, 8080, 8000];
const SERVER_STARTUP_DELAY = 5000; // 5 seconds
const PAGE_LOAD_TIMEOUT = 30000; // 30 seconds

interface PackageJson {
  scripts?: Record<string, string>;
}

function detectDevScript(localPath: string): { script: string; port: number } | null {
  const packageJsonPath = join(localPath, 'package.json');

  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const content = readFileSync(packageJsonPath, 'utf-8');
    const packageJson: PackageJson = JSON.parse(content);
    const scripts = packageJson.scripts || {};

    // Priority order for dev scripts
    const devScripts = ['dev', 'start', 'serve'];

    for (const scriptName of devScripts) {
      if (scripts[scriptName]) {
        // Try to detect port from script
        const script = scripts[scriptName];
        const portMatch = script.match(/--port[= ](\d+)|PORT=(\d+)|-p[= ]?(\d+)/);
        const port = portMatch
          ? parseInt(portMatch[1] || portMatch[2] || portMatch[3])
          : DEFAULT_PORTS[0];

        return { script: scriptName, port };
      }
    }
  } catch {
    // Ignore parse errors
  }

  return null;
}

async function waitForServer(url: string, timeout: number = 30000): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (response.ok || response.status === 304) {
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return false;
}

export async function runWebGeneric(ctx: ProfileContext): Promise<ProfileResult> {
  const { localPath, branch, runId, logsDir, screenshotsDir, devPort } = ctx;

  const buildLogPath = join(logsDir, 'build.log');
  const runtimeLogPath = join(logsDir, 'runtime.log');
  const networkLogPath = join(logsDir, 'network.log');
  const screenshotPath = join(screenshotsDir, `${runId}.png`);

  const buildLog = new FileLogger(buildLogPath);
  const runtimeLog = new FileLogger(runtimeLogPath);
  const networkLog = new FileLogger(networkLogPath);

  let devServer: ChildProcess | null = null;
  let browser: Browser | null = null;

  try {
    // Step 1: npm ci
    buildLog.appendWithTimestamp('--- Installing dependencies ---');
    const npmResult = await runCommand('npm ci', localPath, buildLog, 300000);
    if (!npmResult.success) {
      throw new Error('npm ci failed');
    }

    // Step 2: Detect dev script and port
    buildLog.appendWithTimestamp('--- Detecting dev script ---');
    const detected = detectDevScript(localPath);
    const scriptName = detected?.script || 'dev';
    const port = devPort || detected?.port || 3000;

    buildLog.appendWithTimestamp(`Using script: npm run ${scriptName}`);
    buildLog.appendWithTimestamp(`Using port: ${port}`);

    // Step 3: Start dev server
    buildLog.appendWithTimestamp('--- Starting dev server ---');
    runtimeLog.appendWithTimestamp('=== Dev Server Output ===');

    devServer = spawnProcess('npm', ['run', scriptName], localPath, runtimeLog);

    // Wait for server to start
    buildLog.appendWithTimestamp(`Waiting for server on port ${port}...`);
    const serverUrl = `http://localhost:${port}`;
    const serverReady = await waitForServer(serverUrl, 60000);

    if (!serverReady) {
      throw new Error(`Dev server failed to start on port ${port}`);
    }

    buildLog.appendWithTimestamp('Server is ready');

    // Additional delay to ensure full load
    await new Promise((resolve) => setTimeout(resolve, SERVER_STARTUP_DELAY));

    // Step 4: Launch browser and capture
    buildLog.appendWithTimestamp('--- Launching browser ---');
    networkLog.appendWithTimestamp('=== Network Requests ===');

    browser = await chromium.launch({
      headless: true,
    });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });

    const page: Page = await context.newPage();

    // Log console messages
    page.on('console', (msg) => {
      runtimeLog.appendWithTimestamp(`[${msg.type().toUpperCase()}] ${msg.text()}`);
    });

    // Log network requests
    page.on('request', (request) => {
      networkLog.appendLine(`-> ${request.method()} ${request.url()}`);
    });

    page.on('response', (response) => {
      networkLog.appendLine(`<- ${response.status()} ${response.url()}`);
    });

    page.on('requestfailed', (request) => {
      const failure = request.failure();
      networkLog.appendLine(`XX ${request.method()} ${request.url()} - ${failure?.errorText || 'Failed'}`);
    });

    // Navigate to page
    buildLog.appendWithTimestamp(`Navigating to ${serverUrl}`);

    try {
      await page.goto(serverUrl, {
        waitUntil: 'networkidle',
        timeout: PAGE_LOAD_TIMEOUT,
      });
    } catch (error) {
      buildLog.appendWithTimestamp('Warning: Page load timeout, continuing with screenshot');
    }

    // Additional wait for any dynamic content
    await page.waitForTimeout(2000);

    // Step 5: Take screenshot
    buildLog.appendWithTimestamp('--- Taking screenshot ---');
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });

    buildLog.appendWithTimestamp('Screenshot captured successfully');

    // Cleanup
    await browser.close();
    browser = null;

    devServer.kill('SIGTERM');
    devServer = null;

    buildLog.appendWithTimestamp('--- Build completed successfully ---');

    return {
      status: 'success',
      screenshotPath,
      buildLogPath,
      runtimeLogPath,
      networkLogPath,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    buildLog.appendWithTimestamp(`ERROR: ${errMsg}`);

    return {
      status: 'failure',
      buildLogPath,
      runtimeLogPath,
      networkLogPath,
      errorMessage: errMsg,
    };
  } finally {
    // Ensure cleanup
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Ignore cleanup errors
      }
    }

    if (devServer) {
      try {
        devServer.kill('SIGTERM');
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

export async function detectWebProfile(localPath: string): Promise<{
  profile: 'web-generic';
  port: number;
  script: string;
} | null> {
  const detected = detectDevScript(localPath);

  if (detected) {
    return {
      profile: 'web-generic',
      port: detected.port,
      script: detected.script,
    };
  }

  return null;
}
