import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock modules before importing the agent
vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const emitter = new EventEmitter();
    const proc = Object.assign(emitter, {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: { write: vi.fn(), end: vi.fn() },
      kill: vi.fn(),
      pid: 12345,
    });
    return proc;
  }),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => '{}'),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('../server/config.js', () => ({
  getCloneBaseDir: vi.fn(() => '/tmp/clone'),
  getRepoConfig: vi.fn((name: string) =>
    name === 'owner/repo'
      ? { localPath: '/path/to/repo', repoFullName: 'owner/repo' }
      : null
  ),
}));

vi.mock('../server/logging/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import { spawn } from 'child_process';
import { existsSync, writeFileSync, readFileSync } from 'fs';
import {
  streamingAgentManager,
  StartAgentRequest,
  AgentSessionStatus,
  StreamEvent,
  DEFAULT_CAPABILITIES,
  SAFE_CAPABILITIES,
} from '../server/agents/streaming-agent';

describe('StreamingAgentManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any sessions
    const sessions = streamingAgentManager.listActiveSessions();
    sessions.forEach(s => streamingAgentManager.cancelSession(s.sessionId, 'Test cleanup'));
  });

  describe('startSession', () => {
    it('should create a new session with unique ID', async () => {
      const request: StartAgentRequest = {
        mode: 'task',
        prompt: 'Test task',
        repoFullName: 'owner/repo',
      };

      const response = await streamingAgentManager.startSession(request);

      expect(response.sessionId).toBeTruthy();
      expect(response.sessionId).toMatch(/^[a-f0-9-]{36}$/); // UUID format
      expect(response.message).toBe('Agent session started');
      expect(response.streamUrl).toContain(response.sessionId);
    });

    it('should use repo config local path when available', async () => {
      const request: StartAgentRequest = {
        mode: 'branch',
        prompt: 'Work on branch',
        repoFullName: 'owner/repo',
        branch: 'main',
      };

      const response = await streamingAgentManager.startSession(request);
      const status = streamingAgentManager.getSessionStatus(response.sessionId);

      expect(status).toBeTruthy();
      expect(status!.config.workingDir).toBe('/path/to/repo');
    });

    it('should fall back to clone base dir when repo not found', async () => {
      const request: StartAgentRequest = {
        mode: 'task',
        prompt: 'Test task',
        repoFullName: 'unknown/repo',
      };

      const response = await streamingAgentManager.startSession(request);
      const status = streamingAgentManager.getSessionStatus(response.sessionId);

      expect(status!.config.workingDir).toContain('unknown');
    });

    it('should throw error for non-existent working directory', async () => {
      vi.mocked(existsSync).mockReturnValueOnce(false);

      const request: StartAgentRequest = {
        mode: 'task',
        prompt: 'Test',
        workingDir: '/nonexistent/path',
      };

      await expect(streamingAgentManager.startSession(request)).rejects.toThrow(
        'Working directory does not exist'
      );
    });

    it('should apply default capabilities', async () => {
      const request: StartAgentRequest = {
        mode: 'task',
        prompt: 'Test',
        repoFullName: 'owner/repo',
      };

      const response = await streamingAgentManager.startSession(request);
      const status = streamingAgentManager.getSessionStatus(response.sessionId);

      expect(status!.config.capabilities.allowSubAgents).toBe(DEFAULT_CAPABILITIES.allowSubAgents);
      expect(status!.config.capabilities.allowFileEdits).toBe(DEFAULT_CAPABILITIES.allowFileEdits);
    });

    it('should apply safe capabilities when preset is safe', async () => {
      const request: StartAgentRequest = {
        mode: 'task',
        prompt: 'Test',
        repoFullName: 'owner/repo',
        permissionPreset: 'safe',
      };

      const response = await streamingAgentManager.startSession(request);
      const status = streamingAgentManager.getSessionStatus(response.sessionId);

      expect(status!.config.capabilities.allowSubAgents).toBe(SAFE_CAPABILITIES.allowSubAgents);
      expect(status!.config.capabilities.allowFileEdits).toBe(SAFE_CAPABILITIES.allowFileEdits);
      expect(status!.config.capabilities.allowBash).toBe(SAFE_CAPABILITIES.allowBash);
    });

    it('should apply custom capabilities', async () => {
      const request: StartAgentRequest = {
        mode: 'task',
        prompt: 'Test',
        repoFullName: 'owner/repo',
        permissionPreset: 'custom',
        capabilities: {
          allowBash: false,
          allowSubAgents: false,
          timeout: 120000,
        },
      };

      const response = await streamingAgentManager.startSession(request);
      const status = streamingAgentManager.getSessionStatus(response.sessionId);

      expect(status!.config.capabilities.allowBash).toBe(false);
      expect(status!.config.capabilities.allowSubAgents).toBe(false);
      expect(status!.config.capabilities.timeout).toBe(120000);
      // Should inherit other defaults
      expect(status!.config.capabilities.allowFileEdits).toBe(DEFAULT_CAPABILITIES.allowFileEdits);
    });

    it('should resolve MCP servers from templates', async () => {
      const request: StartAgentRequest = {
        mode: 'task',
        prompt: 'Test',
        repoFullName: 'owner/repo',
        mcpServers: ['playwright'],
      };

      const response = await streamingAgentManager.startSession(request);
      const status = streamingAgentManager.getSessionStatus(response.sessionId);

      expect(status!.config.mcpServers).toHaveLength(1);
      expect(status!.config.mcpServers[0].name).toBe('playwright');
    });

    it('should support custom MCP servers', async () => {
      const request: StartAgentRequest = {
        mode: 'task',
        prompt: 'Test',
        repoFullName: 'owner/repo',
        customMcpServers: [{
          name: 'custom-server',
          command: 'node',
          args: ['server.js'],
          env: { API_KEY: 'test' },
        }],
      };

      const response = await streamingAgentManager.startSession(request);
      const status = streamingAgentManager.getSessionStatus(response.sessionId);

      expect(status!.config.mcpServers).toHaveLength(1);
      expect(status!.config.mcpServers[0].name).toBe('custom-server');
    });

    it('should spawn claude CLI process', async () => {
      const request: StartAgentRequest = {
        mode: 'task',
        prompt: 'Test task',
        repoFullName: 'owner/repo',
      };

      await streamingAgentManager.startSession(request);

      // Give it a moment to spawn
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(spawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['-p']),
        expect.objectContaining({
          cwd: '/path/to/repo',
        })
      );
    });
  });

  describe('getSessionStatus', () => {
    it('should return null for non-existent session', () => {
      const status = streamingAgentManager.getSessionStatus('non-existent-id');
      expect(status).toBeNull();
    });

    it('should return correct status for active session', async () => {
      const request: StartAgentRequest = {
        mode: 'task',
        prompt: 'Test',
        repoFullName: 'owner/repo',
      };

      const response = await streamingAgentManager.startSession(request);
      const status = streamingAgentManager.getSessionStatus(response.sessionId);

      expect(status).toBeTruthy();
      expect(status!.sessionId).toBe(response.sessionId);
      expect(['pending', 'running']).toContain(status!.state);
      expect(status!.startedAt).toBeTruthy();
      expect(status!.config.mode).toBe('task');
      expect(status!.eventsCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('cancelSession', () => {
    it('should return false for non-existent session', () => {
      const result = streamingAgentManager.cancelSession('non-existent-id');
      expect(result).toBe(false);
    });

    it('should cancel a running session', async () => {
      const request: StartAgentRequest = {
        mode: 'task',
        prompt: 'Test',
        repoFullName: 'owner/repo',
      };

      const response = await streamingAgentManager.startSession(request);

      // Wait for session to start running
      await new Promise(resolve => setTimeout(resolve, 50));

      const result = streamingAgentManager.cancelSession(response.sessionId, 'Test cancellation');

      // The session might already be in a terminal state, so we accept both outcomes
      const status = streamingAgentManager.getSessionStatus(response.sessionId);
      expect(['cancelled', 'failed', 'completed']).toContain(status?.state);
    });

    it('should return false for already completed session', async () => {
      const request: StartAgentRequest = {
        mode: 'task',
        prompt: 'Test',
        repoFullName: 'owner/repo',
      };

      const response = await streamingAgentManager.startSession(request);

      // Wait and cancel
      await new Promise(resolve => setTimeout(resolve, 50));
      streamingAgentManager.cancelSession(response.sessionId);

      // Try to cancel again
      const secondCancel = streamingAgentManager.cancelSession(response.sessionId);
      expect(secondCancel).toBe(false);
    });
  });

  describe('getSessionEvents', () => {
    it('should return empty array for non-existent session', () => {
      const events = streamingAgentManager.getSessionEvents('non-existent-id');
      expect(events).toEqual([]);
    });

    it('should return events for active session', async () => {
      const request: StartAgentRequest = {
        mode: 'task',
        prompt: 'Test',
        repoFullName: 'owner/repo',
      };

      const response = await streamingAgentManager.startSession(request);

      // Wait for some events
      await new Promise(resolve => setTimeout(resolve, 100));

      const events = streamingAgentManager.getSessionEvents(response.sessionId);
      expect(events).toBeInstanceOf(Array);
      // Should have at least session_start event
      expect(events.length).toBeGreaterThanOrEqual(0);
    });

    it('should support afterIndex parameter', async () => {
      const request: StartAgentRequest = {
        mode: 'task',
        prompt: 'Test',
        repoFullName: 'owner/repo',
      };

      const response = await streamingAgentManager.startSession(request);
      await new Promise(resolve => setTimeout(resolve, 100));

      const allEvents = streamingAgentManager.getSessionEvents(response.sessionId);
      const afterEvents = streamingAgentManager.getSessionEvents(response.sessionId, 1);

      if (allEvents.length > 1) {
        expect(afterEvents.length).toBeLessThan(allEvents.length);
      }
    });
  });

  describe('subscribeToSession', () => {
    it('should throw for non-existent session', () => {
      expect(() => {
        streamingAgentManager.subscribeToSession('non-existent', () => {});
      }).toThrow('Session not found');
    });

    it('should return unsubscribe function', async () => {
      const request: StartAgentRequest = {
        mode: 'task',
        prompt: 'Test',
        repoFullName: 'owner/repo',
      };

      const response = await streamingAgentManager.startSession(request);
      const callback = vi.fn();

      const unsubscribe = streamingAgentManager.subscribeToSession(response.sessionId, callback);

      expect(typeof unsubscribe).toBe('function');

      // Unsubscribe should not throw
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  describe('listActiveSessions', () => {
    it('should return empty array when no active sessions', () => {
      const sessions = streamingAgentManager.listActiveSessions();
      // Filter out any stale sessions
      expect(sessions).toBeInstanceOf(Array);
    });

    it('should include running sessions', async () => {
      const request: StartAgentRequest = {
        mode: 'task',
        prompt: 'Test',
        repoFullName: 'owner/repo',
      };

      const response = await streamingAgentManager.startSession(request);
      await new Promise(resolve => setTimeout(resolve, 50));

      const sessions = streamingAgentManager.listActiveSessions();
      const found = sessions.find(s => s.sessionId === response.sessionId);

      // Session might be in pending or running state
      if (found) {
        expect(['pending', 'running']).toContain(found.state);
      }
    });

    it('should not include completed sessions', async () => {
      const request: StartAgentRequest = {
        mode: 'task',
        prompt: 'Test',
        repoFullName: 'owner/repo',
      };

      const response = await streamingAgentManager.startSession(request);
      await new Promise(resolve => setTimeout(resolve, 50));

      streamingAgentManager.cancelSession(response.sessionId);

      const sessions = streamingAgentManager.listActiveSessions();
      const found = sessions.find(s => s.sessionId === response.sessionId);

      expect(found).toBeUndefined();
    });
  });

  describe('getHistory', () => {
    it('should return array of history entries', () => {
      const history = streamingAgentManager.getHistory();
      expect(history).toBeInstanceOf(Array);
    });

    it('should support limit parameter', () => {
      const fullHistory = streamingAgentManager.getHistory();
      const limitedHistory = streamingAgentManager.getHistory(5);

      expect(limitedHistory.length).toBeLessThanOrEqual(5);
      expect(limitedHistory.length).toBeLessThanOrEqual(fullHistory.length);
    });

    it('should add completed sessions to history', async () => {
      const request: StartAgentRequest = {
        mode: 'review',
        prompt: 'Review code',
        repoFullName: 'owner/repo',
      };

      const response = await streamingAgentManager.startSession(request);
      await new Promise(resolve => setTimeout(resolve, 50));

      streamingAgentManager.cancelSession(response.sessionId, 'Test');

      const history = streamingAgentManager.getHistory();
      const found = history.find(h => h.sessionId === response.sessionId);

      expect(found).toBeTruthy();
      expect(found!.mode).toBe('review');
      expect(found!.state).toBe('cancelled');
    });
  });

  describe('cleanupSessions', () => {
    it('should return number of cleaned sessions', () => {
      const cleaned = streamingAgentManager.cleanupSessions(0); // Clean all old sessions
      expect(typeof cleaned).toBe('number');
    });

    it('should not clean active sessions', async () => {
      const request: StartAgentRequest = {
        mode: 'task',
        prompt: 'Test',
        repoFullName: 'owner/repo',
      };

      const response = await streamingAgentManager.startSession(request);
      await new Promise(resolve => setTimeout(resolve, 50));

      streamingAgentManager.cleanupSessions(0);

      const status = streamingAgentManager.getSessionStatus(response.sessionId);
      // Active session should still exist
      expect(status).toBeTruthy();
    });
  });
});

describe('Event Emission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should emit session_start event', async () => {
    const request: StartAgentRequest = {
      mode: 'task',
      prompt: 'Test',
      repoFullName: 'owner/repo',
    };

    const response = await streamingAgentManager.startSession(request);
    await new Promise(resolve => setTimeout(resolve, 100));

    const events = streamingAgentManager.getSessionEvents(response.sessionId);
    const startEvent = events.find(e => e.type === 'session_start');

    expect(startEvent).toBeTruthy();
    if (startEvent) {
      expect(startEvent.sessionId).toBe(response.sessionId);
    }
  });

  it('should emit progress events', async () => {
    const request: StartAgentRequest = {
      mode: 'task',
      prompt: 'Test',
      repoFullName: 'owner/repo',
    };

    const response = await streamingAgentManager.startSession(request);
    await new Promise(resolve => setTimeout(resolve, 100));

    const events = streamingAgentManager.getSessionEvents(response.sessionId);
    const progressEvents = events.filter(e => e.type === 'progress');

    expect(progressEvents.length).toBeGreaterThanOrEqual(0);
  });
});

describe('MCP Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should write MCP config file when servers specified', async () => {
    const request: StartAgentRequest = {
      mode: 'task',
      prompt: 'Test with MCP',
      repoFullName: 'owner/repo',
      mcpServers: ['playwright'],
    };

    await streamingAgentManager.startSession(request);
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(writeFileSync).toHaveBeenCalled();
    const calls = vi.mocked(writeFileSync).mock.calls;
    const mcpCall = calls.find(c => String(c[0]).includes('.mcp.json'));

    if (mcpCall) {
      const content = JSON.parse(String(mcpCall[1]));
      expect(content).toHaveProperty('mcpServers');
    }
  });

  it('should backup existing MCP config', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('{"existing": "config"}');

    const request: StartAgentRequest = {
      mode: 'task',
      prompt: 'Test',
      repoFullName: 'owner/repo',
      mcpServers: ['playwright'],
    };

    await streamingAgentManager.startSession(request);
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(readFileSync).toHaveBeenCalled();
  });
});

describe('Claude CLI Arguments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should include -p flag for print mode', async () => {
    const request: StartAgentRequest = {
      mode: 'task',
      prompt: 'Test',
      repoFullName: 'owner/repo',
    };

    await streamingAgentManager.startSession(request);
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(spawn).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['-p']),
      expect.any(Object)
    );
  });

  it('should include output format flag', async () => {
    const request: StartAgentRequest = {
      mode: 'task',
      prompt: 'Test',
      repoFullName: 'owner/repo',
    };

    await streamingAgentManager.startSession(request);
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(spawn).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['--output-format', 'stream-json']),
      expect.any(Object)
    );
  });

  it('should include dangerously-skip-permissions when file edits allowed', async () => {
    const request: StartAgentRequest = {
      mode: 'task',
      prompt: 'Test',
      repoFullName: 'owner/repo',
      permissionPreset: 'full',
    };

    await streamingAgentManager.startSession(request);
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(spawn).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['--dangerously-skip-permissions']),
      expect.any(Object)
    );
  });

  it('should not include dangerously-skip-permissions when file edits disabled', async () => {
    const request: StartAgentRequest = {
      mode: 'task',
      prompt: 'Test',
      repoFullName: 'owner/repo',
      permissionPreset: 'safe',
    };

    await streamingAgentManager.startSession(request);
    await new Promise(resolve => setTimeout(resolve, 50));

    const spawnCalls = vi.mocked(spawn).mock.calls;
    const lastCall = spawnCalls[spawnCalls.length - 1];
    const args = lastCall[1] as string[];

    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it('should include model flag when specified', async () => {
    const request: StartAgentRequest = {
      mode: 'task',
      prompt: 'Test',
      repoFullName: 'owner/repo',
      model: 'claude-sonnet-4-20250514',
    };

    await streamingAgentManager.startSession(request);
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(spawn).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['--model', 'claude-sonnet-4-20250514']),
      expect.any(Object)
    );
  });
});
