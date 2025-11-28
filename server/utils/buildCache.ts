import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { info, warn, error as logError } from '../logging/logger.js';
import { isCacheEnabled } from '../config.js';

const execAsync = promisify(exec);

const CACHE_BASE_DIR = join(process.cwd(), 'data', 'cache');

export interface CacheInfo {
  hash: string;
  createdAt: string;
  size: number;
}

function ensureCacheDir(): void {
  if (!existsSync(CACHE_BASE_DIR)) {
    mkdirSync(CACHE_BASE_DIR, { recursive: true });
  }
}

function getCacheDir(repoFullName: string, cacheType: string): string {
  const safeName = repoFullName.replace(/\//g, '_');
  return join(CACHE_BASE_DIR, safeName, cacheType);
}

function getCacheInfoPath(repoFullName: string, cacheType: string): string {
  return join(getCacheDir(repoFullName, cacheType), 'cache-info.json');
}

export function computePackageLockHash(localPath: string): string | null {
  // Try package-lock.json first, then yarn.lock, then pnpm-lock.yaml
  const lockFiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];

  for (const lockFile of lockFiles) {
    const lockPath = join(localPath, lockFile);
    if (existsSync(lockPath)) {
      const content = readFileSync(lockPath, 'utf-8');
      return createHash('sha256').update(content).digest('hex').slice(0, 16);
    }
  }

  // Fall back to package.json hash
  const packageJsonPath = join(localPath, 'package.json');
  if (existsSync(packageJsonPath)) {
    const content = readFileSync(packageJsonPath, 'utf-8');
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  return null;
}

export function getCacheInfo(repoFullName: string, cacheType: string): CacheInfo | null {
  const infoPath = getCacheInfoPath(repoFullName, cacheType);

  if (!existsSync(infoPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(infoPath, 'utf-8')) as CacheInfo;
  } catch {
    return null;
  }
}

function saveCacheInfo(repoFullName: string, cacheType: string, info: CacheInfo): void {
  const infoPath = getCacheInfoPath(repoFullName, cacheType);
  const cacheDir = dirname(infoPath);

  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }

  writeFileSync(infoPath, JSON.stringify(info, null, 2));
}

export async function cacheNodeModules(
  repoFullName: string,
  localPath: string
): Promise<boolean> {
  if (!isCacheEnabled()) {
    return false;
  }

  ensureCacheDir();

  const nodeModulesPath = join(localPath, 'node_modules');
  if (!existsSync(nodeModulesPath)) {
    return false;
  }

  const currentHash = computePackageLockHash(localPath);
  if (!currentHash) {
    return false;
  }

  const cacheDir = getCacheDir(repoFullName, 'node_modules');
  const cachedModulesPath = join(cacheDir, 'node_modules.tar');

  info(`Caching node_modules for ${repoFullName} (hash: ${currentHash})`, 'BuildCache');

  try {
    // Create cache directory
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }

    // Create tarball of node_modules
    await execAsync(
      `tar -cf "${cachedModulesPath}" -C "${localPath}" node_modules`,
      { timeout: 300000 } // 5 minutes
    );

    // Get size
    const stats = statSync(cachedModulesPath);

    // Save cache info
    saveCacheInfo(repoFullName, 'node_modules', {
      hash: currentHash,
      createdAt: new Date().toISOString(),
      size: stats.size,
    });

    info(`Cached node_modules (${(stats.size / 1024 / 1024).toFixed(1)} MB)`, 'BuildCache');
    return true;
  } catch (error) {
    logError(`Failed to cache node_modules: ${error}`, 'BuildCache');
    return false;
  }
}

export async function restoreNodeModules(
  repoFullName: string,
  localPath: string
): Promise<boolean> {
  if (!isCacheEnabled()) {
    return false;
  }

  const currentHash = computePackageLockHash(localPath);
  if (!currentHash) {
    return false;
  }

  const cachedInfo = getCacheInfo(repoFullName, 'node_modules');
  if (!cachedInfo || cachedInfo.hash !== currentHash) {
    info(`Cache miss for ${repoFullName} (need ${currentHash}, have ${cachedInfo?.hash || 'none'})`, 'BuildCache');
    return false;
  }

  const cacheDir = getCacheDir(repoFullName, 'node_modules');
  const cachedModulesPath = join(cacheDir, 'node_modules.tar');

  if (!existsSync(cachedModulesPath)) {
    return false;
  }

  info(`Restoring node_modules from cache for ${repoFullName}`, 'BuildCache');

  try {
    // Remove existing node_modules
    const nodeModulesPath = join(localPath, 'node_modules');
    if (existsSync(nodeModulesPath)) {
      rmSync(nodeModulesPath, { recursive: true, force: true });
    }

    // Extract cached node_modules
    await execAsync(
      `tar -xf "${cachedModulesPath}" -C "${localPath}"`,
      { timeout: 120000 } // 2 minutes
    );

    info(`Restored node_modules from cache`, 'BuildCache');
    return true;
  } catch (error) {
    logError(`Failed to restore node_modules: ${error}`, 'BuildCache');
    return false;
  }
}

export async function cacheIOSDerivedData(
  repoFullName: string,
  localPath: string
): Promise<boolean> {
  if (!isCacheEnabled()) {
    return false;
  }

  const derivedDataPath = join(localPath, 'ios', 'DerivedData');
  if (!existsSync(derivedDataPath)) {
    return false;
  }

  // Only cache Build/Intermediates and Build/Products
  const buildPath = join(derivedDataPath, 'Build');
  if (!existsSync(buildPath)) {
    return false;
  }

  const cacheDir = getCacheDir(repoFullName, 'ios-derived');
  const cachedPath = join(cacheDir, 'derived-data.tar.gz');

  try {
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }

    // Create compressed tarball
    await execAsync(
      `tar -czf "${cachedPath}" -C "${derivedDataPath}" Build`,
      { timeout: 300000 }
    );

    const stats = statSync(cachedPath);

    saveCacheInfo(repoFullName, 'ios-derived', {
      hash: new Date().toISOString(), // Use timestamp as hash
      createdAt: new Date().toISOString(),
      size: stats.size,
    });

    info(`Cached iOS DerivedData (${(stats.size / 1024 / 1024).toFixed(1)} MB)`, 'BuildCache');
    return true;
  } catch (error) {
    logError(`Failed to cache iOS DerivedData: ${error}`, 'BuildCache');
    return false;
  }
}

export async function restoreIOSDerivedData(
  repoFullName: string,
  localPath: string
): Promise<boolean> {
  if (!isCacheEnabled()) {
    return false;
  }

  const cacheDir = getCacheDir(repoFullName, 'ios-derived');
  const cachedPath = join(cacheDir, 'derived-data.tar.gz');

  if (!existsSync(cachedPath)) {
    return false;
  }

  const derivedDataPath = join(localPath, 'ios', 'DerivedData');

  try {
    if (!existsSync(derivedDataPath)) {
      mkdirSync(derivedDataPath, { recursive: true });
    }

    await execAsync(
      `tar -xzf "${cachedPath}" -C "${derivedDataPath}"`,
      { timeout: 120000 }
    );

    info(`Restored iOS DerivedData from cache`, 'BuildCache');
    return true;
  } catch (error) {
    logError(`Failed to restore iOS DerivedData: ${error}`, 'BuildCache');
    return false;
  }
}

export function clearCache(repoFullName: string): boolean {
  const safeName = repoFullName.replace(/\//g, '_');
  const repoCache = join(CACHE_BASE_DIR, safeName);

  if (existsSync(repoCache)) {
    try {
      rmSync(repoCache, { recursive: true, force: true });
      info(`Cleared cache for ${repoFullName}`, 'BuildCache');
      return true;
    } catch (error) {
      logError(`Failed to clear cache: ${error}`, 'BuildCache');
      return false;
    }
  }

  return false;
}

export function getCacheStats(): {
  totalSize: number;
  repos: Array<{ name: string; size: number; lastUpdated: string }>;
} {
  ensureCacheDir();

  const stats = {
    totalSize: 0,
    repos: [] as Array<{ name: string; size: number; lastUpdated: string }>,
  };

  if (!existsSync(CACHE_BASE_DIR)) {
    return stats;
  }

  try {
    const repoDirs = readdirSync(CACHE_BASE_DIR);

    for (const repoDir of repoDirs) {
      const repoPath = join(CACHE_BASE_DIR, repoDir);
      const repoDirStats = statSync(repoPath);

      if (!repoDirStats.isDirectory()) continue;

      let repoSize = 0;
      let lastUpdated = repoDirStats.mtime.toISOString();

      const cacheTypes = readdirSync(repoPath);
      for (const cacheType of cacheTypes) {
        const cachePath = join(repoPath, cacheType);
        try {
          const files = readdirSync(cachePath);
          for (const file of files) {
            const filePath = join(cachePath, file);
            const fileStats = statSync(filePath);
            repoSize += fileStats.size;
            if (fileStats.mtime > new Date(lastUpdated)) {
              lastUpdated = fileStats.mtime.toISOString();
            }
          }
        } catch {
          // Skip if not a directory
        }
      }

      stats.repos.push({
        name: repoDir.replace(/_/g, '/'),
        size: repoSize,
        lastUpdated,
      });
      stats.totalSize += repoSize;
    }
  } catch (error) {
    logError(`Failed to get cache stats: ${error}`, 'BuildCache');
  }

  return stats;
}

export async function cleanOldCaches(maxAgeDays: number = 30): Promise<number> {
  ensureCacheDir();

  let deletedCount = 0;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

  if (!existsSync(CACHE_BASE_DIR)) {
    return 0;
  }

  try {
    const repoDirs = readdirSync(CACHE_BASE_DIR);

    for (const repoDir of repoDirs) {
      const repoPath = join(CACHE_BASE_DIR, repoDir);
      const cacheTypes = readdirSync(repoPath);

      for (const cacheType of cacheTypes) {
        const infoPath = join(repoPath, cacheType, 'cache-info.json');

        if (existsSync(infoPath)) {
          try {
            const info = JSON.parse(readFileSync(infoPath, 'utf-8')) as CacheInfo;
            const createdDate = new Date(info.createdAt);

            if (createdDate < cutoffDate) {
              const cachePath = join(repoPath, cacheType);
              rmSync(cachePath, { recursive: true, force: true });
              deletedCount++;
            }
          } catch {
            // Skip if can't parse
          }
        }
      }
    }
  } catch (error) {
    logError(`Failed to clean old caches: ${error}`, 'BuildCache');
  }

  return deletedCount;
}
