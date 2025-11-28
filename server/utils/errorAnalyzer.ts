import { readFileSync, existsSync } from 'fs';

export interface ErrorAnalysisResult {
  errorLines: string[];
  warningCount: number;
  summary: string;
  category: 'build' | 'runtime' | 'network' | 'unknown';
}

// Common error patterns
const ERROR_PATTERNS = [
  // npm/node errors
  /npm ERR!.*/i,
  /error:.*/i,
  /Error:.*/i,
  /ENOENT:.*/i,
  /EACCES:.*/i,
  /EPERM:.*/i,
  /MODULE_NOT_FOUND.*/i,
  /Cannot find module.*/i,
  /SyntaxError:.*/i,
  /TypeError:.*/i,
  /ReferenceError:.*/i,

  // TypeScript errors
  /TS\d+:.*/,
  /error TS\d+:.*/,

  // ESLint errors
  /\d+:\d+\s+error\s+.*/,

  // Build errors
  /Build failed.*/i,
  /Compilation failed.*/i,
  /Failed to compile.*/i,

  // iOS build errors
  /xcodebuild:.*/i,
  /error: .*/,
  /clang:.*/i,
  /ld:.*/i,

  // Android build errors
  /FAILURE:.*/,
  /BUILD FAILED.*/i,
  /Execution failed.*/i,

  // Git errors
  /fatal:.*/i,
  /error: pathspec.*/i,

  // Network errors
  /ETIMEDOUT.*/i,
  /ECONNREFUSED.*/i,
  /ENOTFOUND.*/i,
];

const WARNING_PATTERNS = [
  /warning:.*/i,
  /warn:.*/i,
  /deprecated.*/i,
  /\d+:\d+\s+warning\s+.*/,
];

const STACK_TRACE_PATTERNS = [
  /^\s+at\s+.*/,
  /^\s+\^+$/,
];

export function analyzeLogContent(content: string): ErrorAnalysisResult {
  const lines = content.split('\n');
  const errorLines: string[] = [];
  const warnings: string[] = [];
  let inStackTrace = false;
  let stackTraceLines = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) continue;

    // Check for stack trace (limit to 3 lines)
    if (STACK_TRACE_PATTERNS.some((p) => p.test(line))) {
      if (inStackTrace && stackTraceLines < 3) {
        errorLines[errorLines.length - 1] += '\n  ' + line;
        stackTraceLines++;
      }
      continue;
    }

    inStackTrace = false;
    stackTraceLines = 0;

    // Check for errors
    if (ERROR_PATTERNS.some((p) => p.test(line))) {
      // Avoid duplicates
      if (!errorLines.includes(line) && errorLines.length < 10) {
        errorLines.push(line);
        inStackTrace = true;
      }
      continue;
    }

    // Check for warnings
    if (WARNING_PATTERNS.some((p) => p.test(line))) {
      if (!warnings.includes(line)) {
        warnings.push(line);
      }
    }
  }

  // Generate summary
  const summary = generateSummary(errorLines, warnings.length);
  const category = categorizeError(errorLines);

  return {
    errorLines: errorLines.slice(0, 5), // Top 5 errors
    warningCount: warnings.length,
    summary,
    category,
  };
}

function generateSummary(errorLines: string[], warningCount: number): string {
  if (errorLines.length === 0) {
    if (warningCount > 0) {
      return `Build completed with ${warningCount} warning${warningCount > 1 ? 's' : ''}`;
    }
    return 'Build completed successfully';
  }

  // Try to identify the main error type
  const firstError = errorLines[0].toLowerCase();

  if (firstError.includes('module_not_found') || firstError.includes('cannot find module')) {
    const moduleMatch = firstError.match(/['"]([^'"]+)['"]/);
    if (moduleMatch) {
      return `Missing module: ${moduleMatch[1]}`;
    }
    return 'Missing dependency';
  }

  if (firstError.includes('ts') && firstError.match(/ts\d+/i)) {
    return `TypeScript error${errorLines.length > 1 ? 's' : ''} (${errorLines.length} found)`;
  }

  if (firstError.includes('syntaxerror')) {
    return 'Syntax error in code';
  }

  if (firstError.includes('enoent')) {
    return 'File or directory not found';
  }

  if (firstError.includes('eacces') || firstError.includes('eperm')) {
    return 'Permission denied';
  }

  if (firstError.includes('npm err')) {
    return 'npm installation failed';
  }

  if (firstError.includes('xcodebuild')) {
    return 'iOS build failed';
  }

  if (firstError.includes('gradle') || firstError.includes('android')) {
    return 'Android build failed';
  }

  if (firstError.includes('fatal')) {
    return 'Git operation failed';
  }

  if (errorLines.length === 1) {
    // Truncate long errors
    const error = errorLines[0];
    if (error.length > 80) {
      return error.slice(0, 77) + '...';
    }
    return error;
  }

  return `${errorLines.length} error${errorLines.length > 1 ? 's' : ''} found`;
}

function categorizeError(errorLines: string[]): ErrorAnalysisResult['category'] {
  if (errorLines.length === 0) {
    return 'unknown';
  }

  const allErrors = errorLines.join('\n').toLowerCase();

  if (
    allErrors.includes('npm') ||
    allErrors.includes('build') ||
    allErrors.includes('compile') ||
    allErrors.includes('typescript') ||
    allErrors.includes('ts') ||
    allErrors.includes('xcodebuild') ||
    allErrors.includes('gradle')
  ) {
    return 'build';
  }

  if (
    allErrors.includes('runtime') ||
    allErrors.includes('typeerror') ||
    allErrors.includes('referenceerror') ||
    allErrors.includes('uncaught')
  ) {
    return 'runtime';
  }

  if (
    allErrors.includes('etimedout') ||
    allErrors.includes('econnrefused') ||
    allErrors.includes('enotfound') ||
    allErrors.includes('network')
  ) {
    return 'network';
  }

  return 'build';
}

export function analyzeLogFile(logPath: string): ErrorAnalysisResult | null {
  if (!existsSync(logPath)) {
    return null;
  }

  try {
    const content = readFileSync(logPath, 'utf-8');
    return analyzeLogContent(content);
  } catch {
    return null;
  }
}

export function formatErrorsForSlack(result: ErrorAnalysisResult): string {
  let output = '';

  if (result.summary) {
    output += `*Summary:* ${result.summary}\n`;
  }

  if (result.warningCount > 0) {
    output += `*Warnings:* ${result.warningCount}\n`;
  }

  if (result.errorLines.length > 0) {
    output += `\n*Top errors:*\n`;
    for (const error of result.errorLines) {
      // Truncate long lines
      const truncated = error.length > 200 ? error.slice(0, 197) + '...' : error;
      output += `• \`${truncated}\`\n`;
    }
  }

  return output;
}

export function extractRelevantLogTail(
  logPath: string,
  maxLines: number = 30,
  aroundErrors: boolean = true
): string {
  if (!existsSync(logPath)) {
    return '';
  }

  try {
    const content = readFileSync(logPath, 'utf-8');
    const lines = content.split('\n');

    if (!aroundErrors) {
      return lines.slice(-maxLines).join('\n');
    }

    // Find lines around errors
    const errorIndices: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (ERROR_PATTERNS.some((p) => p.test(lines[i]))) {
        errorIndices.push(i);
      }
    }

    if (errorIndices.length === 0) {
      // No errors found, return last lines
      return lines.slice(-maxLines).join('\n');
    }

    // Get context around first few errors
    const relevantLines: Set<number> = new Set();
    const contextLines = 3;

    for (const idx of errorIndices.slice(0, 5)) {
      for (let i = Math.max(0, idx - contextLines); i <= Math.min(lines.length - 1, idx + contextLines); i++) {
        relevantLines.add(i);
      }
    }

    // Add last few lines
    for (let i = Math.max(0, lines.length - 10); i < lines.length; i++) {
      relevantLines.add(i);
    }

    // Sort and join
    const sortedIndices = Array.from(relevantLines).sort((a, b) => a - b);
    const result: string[] = [];
    let lastIdx = -2;

    for (const idx of sortedIndices) {
      if (idx - lastIdx > 1 && result.length > 0) {
        result.push('...');
      }
      result.push(lines[idx]);
      lastIdx = idx;
    }

    return result.slice(-maxLines).join('\n');
  } catch {
    return '';
  }
}
