import { exec, ChildProcess, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class TimeoutError extends Error {
  constructor(message: string, public readonly timeoutMs: number) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export interface TimeoutOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  onTimeout?: () => void;
}

export function withTimeout<T>(
  promise: Promise<T>,
  options: TimeoutOptions
): Promise<T> {
  const { timeoutMs, signal, onTimeout } = options;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new TimeoutError(`Operation timed out after ${timeoutMs}ms`, timeoutMs));
    }, timeoutMs);

    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Operation aborted'));
      });
    }

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export async function execWithTimeout(
  command: string,
  cwd: string,
  timeoutMs: number,
  env?: Record<string, string>
): Promise<ExecResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024, // 50MB
      signal: controller.signal,
      env: { ...process.env, ...env },
    });

    clearTimeout(timer);
    return { success: true, stdout, stderr, exitCode: 0, timedOut: false };
  } catch (error: unknown) {
    clearTimeout(timer);

    const err = error as {
      message?: string;
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
      signal?: string;
    };

    const timedOut = err.killed || err.signal === 'SIGTERM' || err.code === 'ABORT_ERR';

    return {
      success: false,
      stdout: err.stdout || '',
      stderr: err.stderr || err.message || '',
      exitCode: typeof err.code === 'number' ? err.code : null,
      timedOut,
    };
  }
}

export function spawnWithTimeout(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  env?: Record<string, string>
): { proc: ChildProcess; kill: () => void; waitForExit: () => Promise<number> } {
  const proc = spawn(command, args, {
    cwd,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: { ...process.env, ...env },
  });

  let killed = false;
  const timer = setTimeout(() => {
    if (!killed) {
      killed = true;
      killProcessTree(proc);
    }
  }, timeoutMs);

  const kill = () => {
    clearTimeout(timer);
    if (!killed) {
      killed = true;
      killProcessTree(proc);
    }
  };

  const waitForExit = (): Promise<number> => {
    return new Promise((resolve) => {
      proc.on('exit', (code) => {
        clearTimeout(timer);
        resolve(code ?? 1);
      });
      proc.on('error', () => {
        clearTimeout(timer);
        resolve(1);
      });
    });
  };

  return { proc, kill, waitForExit };
}

export function killProcessTree(proc: ChildProcess): void {
  if (!proc.pid) return;

  try {
    // Try to kill the entire process group
    process.kill(-proc.pid, 'SIGTERM');
  } catch {
    // Fall back to killing just the process
    try {
      proc.kill('SIGTERM');
    } catch {
      // Ignore errors
    }
  }

  // Force kill after 2 seconds
  setTimeout(() => {
    try {
      if (proc.pid) {
        process.kill(-proc.pid, 'SIGKILL');
      }
    } catch {
      try {
        proc.kill('SIGKILL');
      } catch {
        // Ignore errors
      }
    }
  }, 2000);
}

export async function killProcessOnPort(port: number): Promise<void> {
  try {
    const { stdout } = await execAsync(`lsof -ti:${port} 2>/dev/null || true`);
    const pids = stdout.trim().split('\n').filter(Boolean);

    for (const pid of pids) {
      try {
        await execAsync(`kill -9 ${pid} 2>/dev/null || true`);
      } catch {
        // Ignore errors
      }
    }
  } catch {
    // Ignore errors
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForPort(
  port: number,
  timeoutMs: number,
  checkIntervalMs: number = 500
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const { stdout } = await execAsync(`lsof -ti:${port} 2>/dev/null || echo ""`);
      if (stdout.trim()) {
        return true;
      }
    } catch {
      // Ignore errors
    }

    await sleep(checkIntervalMs);
  }

  return false;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier?: number;
  }
): Promise<T> {
  const { maxRetries, initialDelayMs, maxDelayMs, backoffMultiplier = 2 } = options;
  let lastError: Error | undefined;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        await sleep(delay);
        delay = Math.min(delay * backoffMultiplier, maxDelayMs);
      }
    }
  }

  throw lastError;
}
