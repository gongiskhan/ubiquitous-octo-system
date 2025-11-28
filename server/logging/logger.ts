import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, '..', '..', 'data', 'logs');

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLogLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLogLevel];
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatMessage(level: LogLevel, message: string, context?: string): string {
  const timestamp = formatTimestamp();
  const ctx = context ? `[${context}]` : '';
  return `${timestamp} [${level.toUpperCase()}]${ctx} ${message}`;
}

export function log(level: LogLevel, message: string, context?: string): void {
  if (!shouldLog(level)) return;

  const formatted = formatMessage(level, message, context);

  switch (level) {
    case 'error':
      console.error(formatted);
      break;
    case 'warn':
      console.warn(formatted);
      break;
    default:
      console.log(formatted);
  }
}

export function debug(message: string, context?: string): void {
  log('debug', message, context);
}

export function info(message: string, context?: string): void {
  log('info', message, context);
}

export function warn(message: string, context?: string): void {
  log('warn', message, context);
}

export function error(message: string, context?: string): void {
  log('error', message, context);
}

export class FileLogger {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.ensureDir();
  }

  private ensureDir(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  append(content: string): void {
    try {
      appendFileSync(this.filePath, content);
    } catch (err) {
      error(`Failed to write to log file ${this.filePath}: ${err}`, 'FileLogger');
    }
  }

  appendLine(content: string): void {
    this.append(content + '\n');
  }

  appendWithTimestamp(content: string): void {
    this.appendLine(`[${formatTimestamp()}] ${content}`);
  }
}

export function createBuildLogger(
  repoFullName: string,
  branch: string,
  runId: string
): FileLogger {
  const safeName = repoFullName.replace(/\//g, '_');
  const safeBranch = branch.replace(/\//g, '_');
  const logPath = join(LOG_DIR, safeName, safeBranch, runId, 'build.log');
  return new FileLogger(logPath);
}

export function createRuntimeLogger(
  repoFullName: string,
  branch: string,
  runId: string
): FileLogger {
  const safeName = repoFullName.replace(/\//g, '_');
  const safeBranch = branch.replace(/\//g, '_');
  const logPath = join(LOG_DIR, safeName, safeBranch, runId, 'runtime.log');
  return new FileLogger(logPath);
}

export function createNetworkLogger(
  repoFullName: string,
  branch: string,
  runId: string
): FileLogger {
  const safeName = repoFullName.replace(/\//g, '_');
  const safeBranch = branch.replace(/\//g, '_');
  const logPath = join(LOG_DIR, safeName, safeBranch, runId, 'network.log');
  return new FileLogger(logPath);
}

export function getLogDir(): string {
  return LOG_DIR;
}
