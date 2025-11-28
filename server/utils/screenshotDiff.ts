import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { createHash } from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { info, warn, error as logError } from '../logging/logger.js';
import { getPreviousSuccessfulRun, type DiffResult } from '../config.js';

const execAsync = promisify(exec);

export interface DiffOptions {
  threshold?: number; // 0-1, default 0.1
  outputDiffImage?: boolean;
}

export interface ScreenshotDiffResult {
  hasDiff: boolean;
  diffPercentage: number;
  diffPixelCount: number;
  diffImagePath?: string;
  previousScreenshotPath?: string;
  error?: string;
}

// Simple PNG comparison using image dimensions and pixel data hash
// For a more accurate comparison, we use ImageMagick's compare if available
async function comparePNGsWithImageMagick(
  img1Path: string,
  img2Path: string,
  diffOutputPath: string
): Promise<ScreenshotDiffResult | null> {
  try {
    // Check if ImageMagick is available
    await execAsync('which compare');

    // Use ImageMagick compare to generate diff
    const result = await execAsync(
      `compare -metric AE "${img1Path}" "${img2Path}" "${diffOutputPath}" 2>&1 || true`
    );

    // The output is the number of different pixels
    const diffPixels = parseInt(result.stdout.trim() || result.stderr.trim(), 10);

    if (isNaN(diffPixels)) {
      return null;
    }

    // Get image dimensions to calculate percentage
    const identifyResult = await execAsync(
      `identify -format "%w %h" "${img1Path}"`
    );
    const [width, height] = identifyResult.stdout.trim().split(' ').map(Number);
    const totalPixels = width * height;

    const diffPercentage = (diffPixels / totalPixels) * 100;

    return {
      hasDiff: diffPixels > 0,
      diffPercentage,
      diffPixelCount: diffPixels,
      diffImagePath: existsSync(diffOutputPath) ? diffOutputPath : undefined,
      previousScreenshotPath: img1Path,
    };
  } catch {
    return null;
  }
}

// Fallback: Simple hash-based comparison
function comparePNGsByHash(
  img1Path: string,
  img2Path: string
): ScreenshotDiffResult {
  try {
    const img1Data = readFileSync(img1Path);
    const img2Data = readFileSync(img2Path);

    const hash1 = createHash('sha256').update(img1Data).digest('hex');
    const hash2 = createHash('sha256').update(img2Data).digest('hex');

    const hasDiff = hash1 !== hash2;

    // Rough estimate based on file size difference
    const sizeDiff = Math.abs(img1Data.length - img2Data.length);
    const avgSize = (img1Data.length + img2Data.length) / 2;
    const diffPercentage = hasDiff ? Math.min((sizeDiff / avgSize) * 100 + 1, 100) : 0;

    return {
      hasDiff,
      diffPercentage,
      diffPixelCount: hasDiff ? -1 : 0, // -1 indicates unknown
      previousScreenshotPath: img1Path,
    };
  } catch (error) {
    return {
      hasDiff: false,
      diffPercentage: 0,
      diffPixelCount: 0,
      error: `Comparison failed: ${error}`,
    };
  }
}

export async function compareScreenshots(
  currentPath: string,
  previousPath: string,
  diffOutputPath: string,
  options: DiffOptions = {}
): Promise<ScreenshotDiffResult> {
  if (!existsSync(currentPath)) {
    return {
      hasDiff: false,
      diffPercentage: 0,
      diffPixelCount: 0,
      error: 'Current screenshot not found',
    };
  }

  if (!existsSync(previousPath)) {
    return {
      hasDiff: false,
      diffPercentage: 0,
      diffPixelCount: 0,
      error: 'Previous screenshot not found',
    };
  }

  // Ensure output directory exists
  const diffDir = dirname(diffOutputPath);
  if (!existsSync(diffDir)) {
    mkdirSync(diffDir, { recursive: true });
  }

  // Try ImageMagick first
  const imageMagickResult = await comparePNGsWithImageMagick(
    previousPath,
    currentPath,
    diffOutputPath
  );

  if (imageMagickResult) {
    return imageMagickResult;
  }

  // Fall back to hash comparison
  info('ImageMagick not available, using hash comparison', 'ScreenshotDiff');
  return comparePNGsByHash(currentPath, previousPath);
}

export async function performScreenshotDiff(
  repoFullName: string,
  branch: string,
  currentRunId: string,
  currentScreenshotPath: string,
  screenshotsDir: string
): Promise<DiffResult | null> {
  // Find the previous successful run
  const previousRun = getPreviousSuccessfulRun(repoFullName, branch, currentRunId);

  if (!previousRun || !previousRun.screenshotPath) {
    info(`No previous screenshot found for ${repoFullName}/${branch}`, 'ScreenshotDiff');
    return null;
  }

  if (!existsSync(previousRun.screenshotPath)) {
    warn(`Previous screenshot file missing: ${previousRun.screenshotPath}`, 'ScreenshotDiff');
    return null;
  }

  const diffImagePath = join(screenshotsDir, `${currentRunId}-diff.png`);

  try {
    const result = await compareScreenshots(
      currentScreenshotPath,
      previousRun.screenshotPath,
      diffImagePath
    );

    if (result.error) {
      warn(`Screenshot diff error: ${result.error}`, 'ScreenshotDiff');
      return null;
    }

    info(
      `Screenshot diff: ${result.diffPercentage.toFixed(2)}% different (${result.diffPixelCount} pixels)`,
      'ScreenshotDiff'
    );

    return {
      diffPercentage: result.diffPercentage,
      diffPixelCount: result.diffPixelCount,
      diffImagePath: result.diffImagePath,
      previousScreenshotPath: previousRun.screenshotPath,
    };
  } catch (error) {
    logError(`Screenshot diff failed: ${error}`, 'ScreenshotDiff');
    return null;
  }
}

// Generate a thumbnail for the visual history
export async function generateThumbnail(
  sourcePath: string,
  thumbnailPath: string,
  width: number = 200
): Promise<boolean> {
  try {
    // Try using ImageMagick
    await execAsync(
      `convert "${sourcePath}" -resize ${width}x -quality 80 "${thumbnailPath}"`
    );
    return true;
  } catch {
    // ImageMagick not available, skip thumbnail
    return false;
  }
}
