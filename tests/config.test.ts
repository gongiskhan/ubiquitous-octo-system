import { describe, it, expect } from 'vitest';
import type { ProfileType, RepoConfig, RunRecord, AppConfig } from '../server/config.js';

describe('Config Types', () => {
  describe('ProfileType', () => {
    it('should accept valid profile types', () => {
      const validProfiles: ProfileType[] = [
        'ios-capacitor',
        'web-generic',
        'node-service',
        'android-capacitor',
        'tauri-app',
        'custom',
      ];

      expect(validProfiles).toHaveLength(6);
    });
  });

  describe('RepoConfig', () => {
    it('should have required fields', () => {
      const minimalConfig: RepoConfig = {
        repoFullName: 'owner/repo',
        localPath: '/path/to/repo',
        enabled: true,
        profile: 'web-generic',
      };

      expect(minimalConfig.repoFullName).toBe('owner/repo');
      expect(minimalConfig.localPath).toBe('/path/to/repo');
      expect(minimalConfig.enabled).toBe(true);
      expect(minimalConfig.profile).toBe('web-generic');
    });

    it('should support optional fields', () => {
      const fullConfig: RepoConfig = {
        repoFullName: 'owner/repo',
        localPath: '/path/to/repo',
        enabled: true,
        profile: 'ios-capacitor',
        webhookId: 12345,
        devPort: 3000,
        lastRuns: [],
      };

      expect(fullConfig.webhookId).toBe(12345);
      expect(fullConfig.devPort).toBe(3000);
      expect(fullConfig.lastRuns).toHaveLength(0);
    });
  });

  describe('RunRecord', () => {
    it('should have required fields', () => {
      const run: RunRecord = {
        branch: 'main',
        timestamp: '2024-01-15T10:30:00Z',
        runId: 'run-abc123',
        status: 'success',
      };

      expect(run.branch).toBe('main');
      expect(run.status).toBe('success');
    });

    it('should support all status values', () => {
      const statuses: RunRecord['status'][] = ['success', 'failure', 'running'];

      for (const status of statuses) {
        const run: RunRecord = {
          branch: 'test',
          timestamp: new Date().toISOString(),
          runId: `run-${status}`,
          status,
        };
        expect(run.status).toBe(status);
      }
    });

    it('should support optional log paths', () => {
      const run: RunRecord = {
        branch: 'feature',
        timestamp: new Date().toISOString(),
        runId: 'run-logs',
        status: 'success',
        screenshotPath: '/data/screenshots/owner_repo/feature/run-logs.png',
        buildLogPath: '/data/logs/owner_repo/feature/run-logs/build.log',
        runtimeLogPath: '/data/logs/owner_repo/feature/run-logs/runtime.log',
        networkLogPath: '/data/logs/owner_repo/feature/run-logs/network.log',
      };

      expect(run.screenshotPath).toContain('.png');
      expect(run.buildLogPath).toContain('build.log');
    });

    it('should support error message on failure', () => {
      const run: RunRecord = {
        branch: 'broken',
        timestamp: new Date().toISOString(),
        runId: 'run-failed',
        status: 'failure',
        errorMessage: 'npm ci failed: ENOENT',
      };

      expect(run.errorMessage).toBe('npm ci failed: ENOENT');
    });
  });

  describe('AppConfig', () => {
    it('should have required structure', () => {
      const config: AppConfig = {
        repos: [],
        webhookBaseUrl: 'https://my-machine.ts.net',
        defaultPort: 3000,
      };

      expect(config.repos).toEqual([]);
      expect(config.webhookBaseUrl).toContain('https://');
      expect(config.defaultPort).toBe(3000);
    });

    it('should hold multiple repos', () => {
      const config: AppConfig = {
        repos: [
          {
            repoFullName: 'org/web-app',
            localPath: '/code/web-app',
            enabled: true,
            profile: 'web-generic',
            devPort: 5173,
          },
          {
            repoFullName: 'org/mobile-app',
            localPath: '/code/mobile-app',
            enabled: false,
            profile: 'ios-capacitor',
          },
        ],
        webhookBaseUrl: 'https://dev.ts.net',
        defaultPort: 3000,
      };

      expect(config.repos).toHaveLength(2);
      expect(config.repos[0].profile).toBe('web-generic');
      expect(config.repos[1].enabled).toBe(false);
    });
  });
});

describe('Config Helpers', () => {
  describe('repo name parsing', () => {
    it('should handle standard owner/repo format', () => {
      const fullName = 'myorg/myrepo';
      const [owner, repo] = fullName.split('/');

      expect(owner).toBe('myorg');
      expect(repo).toBe('myrepo');
    });

    it('should handle repos with special characters', () => {
      const names = [
        'owner/my-repo',
        'owner/my_repo',
        'owner/repo.js',
        'owner/REPO123',
      ];

      for (const name of names) {
        const parts = name.split('/');
        expect(parts).toHaveLength(2);
        expect(parts[0]).toBeTruthy();
        expect(parts[1]).toBeTruthy();
      }
    });
  });

  describe('path sanitization for storage', () => {
    function sanitizeForPath(repoFullName: string): string {
      return repoFullName.replace('/', '_');
    }

    it('should convert slash to underscore', () => {
      expect(sanitizeForPath('owner/repo')).toBe('owner_repo');
      expect(sanitizeForPath('org/project')).toBe('org_project');
    });

    it('should be reversible', () => {
      const original = 'myorg/myrepo';
      const sanitized = sanitizeForPath(original);
      const restored = sanitized.replace('_', '/');

      expect(restored).toBe(original);
    });
  });

  describe('run ID generation', () => {
    function generateRunId(): string {
      return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateRunId());
      }
      expect(ids.size).toBe(100);
    });

    it('should start with "run-"', () => {
      const id = generateRunId();
      expect(id).toMatch(/^run-\d+-[a-z0-9]+$/);
    });
  });
});
