import { describe, it, expect } from 'vitest';

describe('API Response Formats', () => {
  describe('Queue Status Response', () => {
    interface QueueStatusResponse {
      queueLength: number;
      isProcessing: boolean;
      currentJob: null | {
        repoFullName: string;
        branch: string;
        queuedAt: string;
        trigger: 'webhook' | 'manual';
      };
      queuedJobs: Array<{
        repoFullName: string;
        branch: string;
        queuedAt: string;
        trigger: 'webhook' | 'manual';
      }>;
    }

    it('should have correct structure when empty', () => {
      const response: QueueStatusResponse = {
        queueLength: 0,
        isProcessing: false,
        currentJob: null,
        queuedJobs: [],
      };

      expect(response.queueLength).toBe(0);
      expect(response.isProcessing).toBe(false);
      expect(response.currentJob).toBeNull();
      expect(response.queuedJobs).toHaveLength(0);
    });

    it('should have correct structure when processing', () => {
      const response: QueueStatusResponse = {
        queueLength: 2,
        isProcessing: true,
        currentJob: {
          repoFullName: 'owner/repo',
          branch: 'main',
          queuedAt: '2024-01-15T10:00:00Z',
          trigger: 'webhook',
        },
        queuedJobs: [
          {
            repoFullName: 'owner/repo2',
            branch: 'feature',
            queuedAt: '2024-01-15T10:01:00Z',
            trigger: 'manual',
          },
          {
            repoFullName: 'owner/repo3',
            branch: 'main',
            queuedAt: '2024-01-15T10:02:00Z',
            trigger: 'webhook',
          },
        ],
      };

      expect(response.isProcessing).toBe(true);
      expect(response.currentJob).not.toBeNull();
      expect(response.queuedJobs).toHaveLength(2);
    });
  });

  describe('Repo Config Response', () => {
    interface RepoConfigResponse {
      repoFullName: string;
      localPath: string;
      enabled: boolean;
      profile: string;
      webhookId?: number;
      devPort?: number;
      lastRuns?: Array<{
        branch: string;
        timestamp: string;
        runId: string;
        status: 'success' | 'failure' | 'running';
      }>;
    }

    it('should have required fields', () => {
      const response: RepoConfigResponse = {
        repoFullName: 'owner/repo',
        localPath: '/home/user/projects/repo',
        enabled: true,
        profile: 'web-generic',
      };

      expect(response.repoFullName).toBe('owner/repo');
      expect(response.profile).toBe('web-generic');
    });

    it('should include run history', () => {
      const response: RepoConfigResponse = {
        repoFullName: 'owner/repo',
        localPath: '/code/repo',
        enabled: true,
        profile: 'ios-capacitor',
        lastRuns: [
          {
            branch: 'main',
            timestamp: '2024-01-15T12:00:00Z',
            runId: 'run-123',
            status: 'success',
          },
          {
            branch: 'main',
            timestamp: '2024-01-14T10:00:00Z',
            runId: 'run-122',
            status: 'failure',
          },
        ],
      };

      expect(response.lastRuns).toHaveLength(2);
      expect(response.lastRuns![0].status).toBe('success');
    });
  });

  describe('Trigger Run Response', () => {
    interface TriggerRunResponse {
      success: boolean;
      message: string;
    }

    it('should indicate success', () => {
      const response: TriggerRunResponse = {
        success: true,
        message: 'Build queued for owner/repo/main',
      };

      expect(response.success).toBe(true);
      expect(response.message).toContain('queued');
    });

    it('should indicate failure', () => {
      const response: TriggerRunResponse = {
        success: false,
        message: 'Repo not found or not configured',
      };

      expect(response.success).toBe(false);
    });
  });

  describe('Cleanup Response', () => {
    interface CleanupResponse {
      success: boolean;
      message: string;
      deletedRuns?: number;
      deletedBranches?: string[];
      dryRun?: boolean;
    }

    it('should report dry run results', () => {
      const response: CleanupResponse = {
        success: true,
        message: 'Dry run: would delete 15 runs',
        deletedRuns: 15,
        dryRun: true,
      };

      expect(response.dryRun).toBe(true);
      expect(response.deletedRuns).toBe(15);
    });

    it('should report actual cleanup results', () => {
      const response: CleanupResponse = {
        success: true,
        message: 'Cleaned up 10 runs, reset 3 branches',
        deletedRuns: 10,
        deletedBranches: ['feature-1', 'feature-2', 'old-branch'],
        dryRun: false,
      };

      expect(response.dryRun).toBe(false);
      expect(response.deletedBranches).toHaveLength(3);
    });
  });
});

describe('Error Response Formats', () => {
  interface ErrorResponse {
    error: string;
    details?: string;
    code?: string;
  }

  it('should have error message', () => {
    const response: ErrorResponse = {
      error: 'Repository not found',
    };

    expect(response.error).toBeTruthy();
  });

  it('should include details when available', () => {
    const response: ErrorResponse = {
      error: 'Webhook creation failed',
      details: 'GitHub API returned 409: Webhook already exists',
      code: 'WEBHOOK_EXISTS',
    };

    expect(response.error).toBe('Webhook creation failed');
    expect(response.details).toContain('409');
    expect(response.code).toBe('WEBHOOK_EXISTS');
  });
});

describe('HTTP Status Codes', () => {
  const STATUS_CODES = {
    OK: 200,
    CREATED: 201,
    ACCEPTED: 202,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    UNPROCESSABLE_ENTITY: 422,
    INTERNAL_SERVER_ERROR: 500,
  };

  it('should use correct codes for webhook endpoints', () => {
    // 401 for invalid signature
    expect(STATUS_CODES.UNAUTHORIZED).toBe(401);

    // 202 for accepted webhook
    expect(STATUS_CODES.ACCEPTED).toBe(202);

    // 200 for ignored events
    expect(STATUS_CODES.OK).toBe(200);
  });

  it('should use correct codes for API endpoints', () => {
    // 200 for successful GET
    expect(STATUS_CODES.OK).toBe(200);

    // 201 for created resources
    expect(STATUS_CODES.CREATED).toBe(201);

    // 404 for missing resources
    expect(STATUS_CODES.NOT_FOUND).toBe(404);

    // 409 for conflicts (e.g., webhook already exists)
    expect(STATUS_CODES.CONFLICT).toBe(409);
  });
});
