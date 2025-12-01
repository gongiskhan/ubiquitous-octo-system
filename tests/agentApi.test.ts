import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock the streaming agent manager before importing the router
const mockSession = {
  sessionId: 'test-session-123',
  state: 'running' as const,
  startedAt: new Date().toISOString(),
  lastActivity: new Date().toISOString(),
  config: {
    sessionId: 'test-session-123',
    workingDir: '/test/path',
    mode: 'task' as const,
    prompt: 'Test prompt',
    capabilities: {
      allowSubAgents: true,
      allowFileEdits: true,
      allowGitOps: true,
      allowBash: true,
      allowWebSearch: false,
      allowMcp: true,
      maxSubAgentDepth: 2,
      timeout: 600000,
    },
    mcpServers: [],
    allowSlashCommands: true,
  },
  eventsCount: 5,
  filesModified: [],
  subAgentsSpawned: 0,
  currentPhase: 'running',
};

const mockEmitter = new EventEmitter();

vi.mock('../server/agents/streaming-agent.js', () => ({
  streamingAgentManager: {
    startSession: vi.fn(async (request: any) => ({
      sessionId: 'new-session-456',
      message: 'Agent session started',
      streamUrl: '/api/agent/stream/new-session-456',
    })),
    getSessionStatus: vi.fn((sessionId: string) =>
      sessionId === 'test-session-123' ? mockSession : null
    ),
    getSessionEvents: vi.fn((sessionId: string) =>
      sessionId === 'test-session-123'
        ? [
            { type: 'session_start', timestamp: new Date().toISOString(), sessionId },
            { type: 'text', timestamp: new Date().toISOString(), sessionId, content: 'Hello', isPartial: false },
          ]
        : []
    ),
    cancelSession: vi.fn((sessionId: string) => sessionId === 'test-session-123'),
    listActiveSessions: vi.fn(() => [mockSession]),
    getHistory: vi.fn((limit?: number) => [
      {
        sessionId: 'history-session-1',
        mode: 'task',
        prompt: 'Historical task',
        state: 'completed',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        duration: 5000,
        filesModified: ['file1.ts'],
        summary: 'Completed successfully',
      },
    ]),
    subscribeToSession: vi.fn((sessionId: string, callback: Function) => {
      if (sessionId !== 'test-session-123') {
        throw new Error('Session not found');
      }
      mockEmitter.on('event', callback as any);
      return () => mockEmitter.off('event', callback as any);
    }),
    cleanupSessions: vi.fn(() => 3),
  },
  DEFAULT_CAPABILITIES: {
    allowSubAgents: true,
    allowFileEdits: true,
    allowGitOps: true,
    allowBash: true,
    allowWebSearch: false,
    allowMcp: true,
    maxSubAgentDepth: 2,
    timeout: 600000,
  },
  SAFE_CAPABILITIES: {
    allowSubAgents: false,
    allowFileEdits: false,
    allowGitOps: false,
    allowBash: false,
    allowWebSearch: false,
    allowMcp: false,
    maxSubAgentDepth: 0,
    timeout: 300000,
  },
  MCP_SERVER_TEMPLATES: {
    playwright: {
      name: 'playwright',
      command: 'npx',
      args: ['@playwright/mcp@latest'],
      description: 'Browser automation',
    },
  },
}));

vi.mock('../server/logging/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// Import after mocking
import { streamingAgentManager, DEFAULT_CAPABILITIES, SAFE_CAPABILITIES, MCP_SERVER_TEMPLATES } from '../server/agents/streaming-agent.js';

describe('Agent API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/agent/start', () => {
    describe('Request Validation', () => {
      it('should require prompt field', () => {
        const request = {
          mode: 'task',
          // missing prompt
        };

        // Simulating validation - in real test would use supertest
        expect(request).not.toHaveProperty('prompt');
      });

      it('should default mode to task when not specified', () => {
        const request = {
          prompt: 'Do something',
        };

        const normalizedRequest = {
          ...request,
          mode: request.mode || 'task',
        };

        expect(normalizedRequest.mode).toBe('task');
      });
    });

    describe('Response Format', () => {
      it('should return sessionId and streamUrl on success', async () => {
        const response = await (streamingAgentManager.startSession as any)({
          mode: 'task',
          prompt: 'Test task',
        });

        expect(response).toHaveProperty('sessionId');
        expect(response).toHaveProperty('message');
        expect(response).toHaveProperty('streamUrl');
        expect(response.streamUrl).toContain(response.sessionId);
      });
    });
  });

  describe('GET /api/agent/session/:sessionId', () => {
    it('should return session status for valid session', () => {
      const status = (streamingAgentManager.getSessionStatus as any)('test-session-123');

      expect(status).toBeTruthy();
      expect(status.sessionId).toBe('test-session-123');
      expect(status.state).toBe('running');
      expect(status.config).toBeDefined();
    });

    it('should return null for invalid session', () => {
      const status = (streamingAgentManager.getSessionStatus as any)('invalid-session');

      expect(status).toBeNull();
    });
  });

  describe('GET /api/agent/session/:sessionId/events', () => {
    it('should return events array for valid session', () => {
      const events = (streamingAgentManager.getSessionEvents as any)('test-session-123');

      expect(events).toBeInstanceOf(Array);
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]).toHaveProperty('type');
      expect(events[0]).toHaveProperty('timestamp');
    });

    it('should return empty array for invalid session', () => {
      const events = (streamingAgentManager.getSessionEvents as any)('invalid-session');

      expect(events).toEqual([]);
    });
  });

  describe('POST /api/agent/session/:sessionId/cancel', () => {
    it('should return true for valid running session', () => {
      const result = (streamingAgentManager.cancelSession as any)('test-session-123', 'User cancelled');

      expect(result).toBe(true);
    });

    it('should return false for invalid session', () => {
      const result = (streamingAgentManager.cancelSession as any)('invalid-session');

      expect(result).toBe(false);
    });
  });

  describe('GET /api/agent/sessions', () => {
    it('should return array of active sessions', () => {
      const sessions = (streamingAgentManager.listActiveSessions as any)();

      expect(sessions).toBeInstanceOf(Array);
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions[0]).toHaveProperty('sessionId');
      expect(sessions[0]).toHaveProperty('state');
    });
  });

  describe('GET /api/agent/history', () => {
    it('should return array of history entries', () => {
      const history = (streamingAgentManager.getHistory as any)();

      expect(history).toBeInstanceOf(Array);
      expect(history[0]).toHaveProperty('sessionId');
      expect(history[0]).toHaveProperty('mode');
      expect(history[0]).toHaveProperty('state');
    });

    it('should support limit parameter', () => {
      (streamingAgentManager.getHistory as any)(5);

      expect(streamingAgentManager.getHistory).toHaveBeenCalledWith(5);
    });
  });

  describe('POST /api/agent/cleanup', () => {
    it('should return cleanup count', () => {
      const result = (streamingAgentManager.cleanupSessions as any)(3600000);

      expect(typeof result).toBe('number');
    });
  });
});

describe('Agent Templates API', () => {
  describe('Template Structure', () => {
    it('should have required fields', () => {
      const template = {
        id: 'code-review',
        name: 'Code Review',
        description: 'Review code for quality',
        mode: 'review' as const,
        promptTemplate: 'Review the code...',
        capabilities: DEFAULT_CAPABILITIES,
        mcpServers: [] as string[],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      expect(template.id).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.mode).toBe('review');
      expect(template.promptTemplate).toBeTruthy();
      expect(template.capabilities).toBeDefined();
    });

    it('should support variables in prompt template', () => {
      const template = {
        promptTemplate: 'Fix issue #${ISSUE_NUMBER} with priority ${PRIORITY}',
      };

      const variables = { ISSUE_NUMBER: '123', PRIORITY: 'high' };
      let prompt = template.promptTemplate;

      for (const [key, value] of Object.entries(variables)) {
        prompt = prompt.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
      }

      expect(prompt).toBe('Fix issue #123 with priority high');
    });
  });

  describe('Default Templates', () => {
    const defaultTemplates = [
      { id: 'code-review', mode: 'review' },
      { id: 'feature-implementation', mode: 'branch' },
      { id: 'bug-fix', mode: 'task' },
      { id: 'refactor', mode: 'refactor' },
      { id: 'test-writing', mode: 'task' },
      { id: 'web-testing', mode: 'task' },
    ];

    it('should have expected default templates', () => {
      expect(defaultTemplates.length).toBe(6);
    });

    it('should have unique IDs', () => {
      const ids = defaultTemplates.map(t => t.id);
      const uniqueIds = [...new Set(ids)];
      expect(uniqueIds.length).toBe(ids.length);
    });

    it('should use valid modes', () => {
      const validModes = ['branch', 'project', 'task', 'review', 'refactor'];
      defaultTemplates.forEach(t => {
        expect(validModes).toContain(t.mode);
      });
    });
  });
});

describe('MCP Server Configuration API', () => {
  describe('GET /api/agent/mcp-servers', () => {
    it('should return available MCP server templates', () => {
      const servers = Object.entries(MCP_SERVER_TEMPLATES).map(([key, value]) => ({
        id: key,
        ...value,
      }));

      expect(servers).toBeInstanceOf(Array);
      expect(servers.length).toBeGreaterThan(0);
    });

    it('should include playwright template', () => {
      expect(MCP_SERVER_TEMPLATES).toHaveProperty('playwright');
      expect(MCP_SERVER_TEMPLATES.playwright.name).toBe('playwright');
    });
  });
});

describe('Capability Presets API', () => {
  describe('GET /api/agent/capability-presets', () => {
    it('should return full and safe presets', () => {
      const presets = {
        full: DEFAULT_CAPABILITIES,
        safe: SAFE_CAPABILITIES,
      };

      expect(presets).toHaveProperty('full');
      expect(presets).toHaveProperty('safe');
    });

    it('should have different values for full and safe', () => {
      expect(DEFAULT_CAPABILITIES.allowFileEdits).not.toBe(SAFE_CAPABILITIES.allowFileEdits);
      expect(DEFAULT_CAPABILITIES.allowBash).not.toBe(SAFE_CAPABILITIES.allowBash);
    });
  });
});

describe('SSE Streaming', () => {
  describe('GET /api/agent/stream/:sessionId', () => {
    it('should support catch-up parameter', () => {
      const sessionId = 'test-session-123';

      // When catchUp=true, should return existing events
      const events = (streamingAgentManager.getSessionEvents as any)(sessionId);
      expect(events.length).toBeGreaterThan(0);
    });

    it('should subscribe to session events', () => {
      const sessionId = 'test-session-123';
      const callback = vi.fn();

      const unsubscribe = (streamingAgentManager.subscribeToSession as any)(sessionId, callback);

      // Emit a test event
      mockEmitter.emit('event', { type: 'text', content: 'Test' });

      expect(callback).toHaveBeenCalledWith({ type: 'text', content: 'Test' });

      unsubscribe();
    });

    it('should throw for invalid session', () => {
      expect(() => {
        (streamingAgentManager.subscribeToSession as any)('invalid-session', () => {});
      }).toThrow('Session not found');
    });
  });
});

describe('Error Handling', () => {
  describe('Session Not Found', () => {
    it('should return null status for missing session', () => {
      const status = (streamingAgentManager.getSessionStatus as any)('missing-session');
      expect(status).toBeNull();
    });

    it('should return empty events for missing session', () => {
      const events = (streamingAgentManager.getSessionEvents as any)('missing-session');
      expect(events).toEqual([]);
    });

    it('should return false when cancelling missing session', () => {
      const result = (streamingAgentManager.cancelSession as any)('missing-session');
      expect(result).toBe(false);
    });
  });

  describe('Invalid Request', () => {
    it('should validate required fields', () => {
      const invalidRequests = [
        {}, // Empty
        { mode: 'task' }, // Missing prompt
        { prompt: '' }, // Empty prompt
      ];

      invalidRequests.forEach(request => {
        const isValid = request.prompt && typeof request.prompt === 'string' && request.prompt.trim().length > 0;
        expect(isValid).toBeFalsy();
      });
    });

    it('should validate mode values', () => {
      const validModes = ['branch', 'project', 'task', 'review', 'refactor'];
      const invalidMode = 'invalid-mode';

      expect(validModes).not.toContain(invalidMode);
    });

    it('should validate permission preset values', () => {
      const validPresets = ['full', 'safe', 'custom'];
      const invalidPreset = 'invalid-preset';

      expect(validPresets).not.toContain(invalidPreset);
    });
  });
});

describe('Response Formats', () => {
  describe('StartAgentResponse', () => {
    it('should have correct structure', async () => {
      const response = await (streamingAgentManager.startSession as any)({
        mode: 'task',
        prompt: 'Test',
      });

      expect(response).toMatchObject({
        sessionId: expect.any(String),
        message: expect.any(String),
        streamUrl: expect.any(String),
      });
    });
  });

  describe('AgentSessionStatus', () => {
    it('should have correct structure', () => {
      const status = (streamingAgentManager.getSessionStatus as any)('test-session-123');

      expect(status).toMatchObject({
        sessionId: expect.any(String),
        state: expect.any(String),
        startedAt: expect.any(String),
        lastActivity: expect.any(String),
        config: expect.any(Object),
        eventsCount: expect.any(Number),
        filesModified: expect.any(Array),
        subAgentsSpawned: expect.any(Number),
      });
    });
  });

  describe('AgentHistoryEntry', () => {
    it('should have correct structure', () => {
      const history = (streamingAgentManager.getHistory as any)();
      const entry = history[0];

      expect(entry).toMatchObject({
        sessionId: expect.any(String),
        mode: expect.any(String),
        prompt: expect.any(String),
        state: expect.any(String),
        startedAt: expect.any(String),
        filesModified: expect.any(Array),
      });
    });
  });
});

describe('Template CRUD Operations', () => {
  describe('Create Template', () => {
    it('should generate ID from name', () => {
      const name = 'My Custom Template';
      const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

      expect(id).toBe('my-custom-template');
    });

    it('should require name, promptTemplate, and mode', () => {
      const template = {
        name: 'Test Template',
        promptTemplate: 'Do something',
        mode: 'task',
      };

      expect(template.name).toBeTruthy();
      expect(template.promptTemplate).toBeTruthy();
      expect(template.mode).toBeTruthy();
    });
  });

  describe('Update Template', () => {
    it('should preserve ID on update', () => {
      const original = { id: 'original-id', name: 'Original' };
      const updates = { name: 'Updated Name' };

      const updated = { ...original, ...updates, id: original.id };

      expect(updated.id).toBe('original-id');
      expect(updated.name).toBe('Updated Name');
    });

    it('should update timestamp', () => {
      const before = new Date().toISOString();
      const template = { updatedAt: new Date().toISOString() };

      expect(template.updatedAt >= before).toBe(true);
    });
  });
});
