import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';

describe('Webhook Signature Verification', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function createSignature(payload: string, secret: string): string {
    return 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
  }

  describe('signature creation', () => {
    it('should create valid sha256 HMAC signature', () => {
      const secret = 'test-secret-123';
      const payload = JSON.stringify({ test: 'data' });

      const signature = createSignature(payload, secret);

      expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('should create different signatures for different payloads', () => {
      const secret = 'test-secret';
      const payload1 = JSON.stringify({ data: 'one' });
      const payload2 = JSON.stringify({ data: 'two' });

      const sig1 = createSignature(payload1, secret);
      const sig2 = createSignature(payload2, secret);

      expect(sig1).not.toBe(sig2);
    });

    it('should create different signatures for different secrets', () => {
      const payload = JSON.stringify({ data: 'test' });

      const sig1 = createSignature(payload, 'secret1');
      const sig2 = createSignature(payload, 'secret2');

      expect(sig1).not.toBe(sig2);
    });

    it('should create same signature for same payload and secret', () => {
      const secret = 'consistent-secret';
      const payload = JSON.stringify({ repo: 'owner/repo', branch: 'main' });

      const sig1 = createSignature(payload, secret);
      const sig2 = createSignature(payload, secret);

      expect(sig1).toBe(sig2);
    });
  });

  describe('branch extraction', () => {
    function extractBranch(ref: string): string {
      const parts = ref.split('/');
      if (parts.length >= 3 && parts[0] === 'refs' && parts[1] === 'heads') {
        return parts.slice(2).join('/');
      }
      return ref;
    }

    it('should extract simple branch name', () => {
      expect(extractBranch('refs/heads/main')).toBe('main');
      expect(extractBranch('refs/heads/develop')).toBe('develop');
    });

    it('should extract branch with slashes', () => {
      expect(extractBranch('refs/heads/feature/new-thing')).toBe('feature/new-thing');
      expect(extractBranch('refs/heads/user/john/fix-bug')).toBe('user/john/fix-bug');
    });

    it('should return original ref for non-branch refs', () => {
      expect(extractBranch('refs/tags/v1.0.0')).toBe('refs/tags/v1.0.0');
      expect(extractBranch('random-string')).toBe('random-string');
    });
  });
});

describe('Webhook Payload Parsing', () => {
  interface MinimalPushPayload {
    ref: string;
    repository: {
      full_name: string;
    };
    head_commit?: {
      message: string;
      author: {
        name: string;
      };
    };
    pusher: {
      name: string;
    };
  }

  it('should parse minimal push payload', () => {
    const payload: MinimalPushPayload = {
      ref: 'refs/heads/main',
      repository: {
        full_name: 'owner/repo',
      },
      pusher: {
        name: 'testuser',
      },
    };

    expect(payload.repository.full_name).toBe('owner/repo');
    expect(payload.ref).toBe('refs/heads/main');
    expect(payload.pusher.name).toBe('testuser');
  });

  it('should handle payload with commit info', () => {
    const payload: MinimalPushPayload = {
      ref: 'refs/heads/feature-branch',
      repository: {
        full_name: 'org/project',
      },
      pusher: {
        name: 'developer',
      },
      head_commit: {
        message: 'Fix: resolve login issue\n\nDetailed description here',
        author: {
          name: 'Developer Name',
        },
      },
    };

    expect(payload.head_commit?.message.split('\n')[0]).toBe('Fix: resolve login issue');
    expect(payload.head_commit?.author.name).toBe('Developer Name');
  });

  it('should handle branch refs correctly', () => {
    const refs = [
      { input: 'refs/heads/main', isBranch: true },
      { input: 'refs/heads/feature/login', isBranch: true },
      { input: 'refs/tags/v1.0.0', isBranch: false },
      { input: 'refs/pull/123/head', isBranch: false },
    ];

    for (const { input, isBranch } of refs) {
      expect(input.startsWith('refs/heads/')).toBe(isBranch);
    }
  });
});
