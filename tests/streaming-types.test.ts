import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CAPABILITIES,
  SAFE_CAPABILITIES,
  MCP_SERVER_TEMPLATES,
  getDefaultTestingConfig,
  AgentCapabilities,
  AgentMode,
  SessionState,
  StreamEventType,
  AgentSessionConfig,
  StartAgentRequest,
  McpServerDefinition,
  StreamEvent,
  TextEvent,
  ToolUseEvent,
  FileEditEvent,
  SessionEndEvent,
} from '../server/agents/streaming-types';

describe('Streaming Types', () => {
  describe('Agent Capabilities', () => {
    describe('DEFAULT_CAPABILITIES', () => {
      it('should have all capability flags defined', () => {
        expect(DEFAULT_CAPABILITIES).toHaveProperty('allowSubAgents');
        expect(DEFAULT_CAPABILITIES).toHaveProperty('allowFileEdits');
        expect(DEFAULT_CAPABILITIES).toHaveProperty('allowGitOps');
        expect(DEFAULT_CAPABILITIES).toHaveProperty('allowBash');
        expect(DEFAULT_CAPABILITIES).toHaveProperty('allowWebSearch');
        expect(DEFAULT_CAPABILITIES).toHaveProperty('allowMcp');
        expect(DEFAULT_CAPABILITIES).toHaveProperty('maxSubAgentDepth');
        expect(DEFAULT_CAPABILITIES).toHaveProperty('timeout');
      });

      it('should enable full capabilities by default', () => {
        expect(DEFAULT_CAPABILITIES.allowSubAgents).toBe(true);
        expect(DEFAULT_CAPABILITIES.allowFileEdits).toBe(true);
        expect(DEFAULT_CAPABILITIES.allowGitOps).toBe(true);
        expect(DEFAULT_CAPABILITIES.allowBash).toBe(true);
        expect(DEFAULT_CAPABILITIES.allowMcp).toBe(true);
      });

      it('should disable web search by default', () => {
        expect(DEFAULT_CAPABILITIES.allowWebSearch).toBe(false);
      });

      it('should have reasonable timeout', () => {
        expect(DEFAULT_CAPABILITIES.timeout).toBeGreaterThanOrEqual(300000); // At least 5 minutes
        expect(DEFAULT_CAPABILITIES.timeout).toBeLessThanOrEqual(1800000); // At most 30 minutes
      });

      it('should limit sub-agent depth', () => {
        expect(DEFAULT_CAPABILITIES.maxSubAgentDepth).toBeGreaterThanOrEqual(1);
        expect(DEFAULT_CAPABILITIES.maxSubAgentDepth).toBeLessThanOrEqual(5);
      });
    });

    describe('SAFE_CAPABILITIES', () => {
      it('should disable all modification capabilities', () => {
        expect(SAFE_CAPABILITIES.allowSubAgents).toBe(false);
        expect(SAFE_CAPABILITIES.allowFileEdits).toBe(false);
        expect(SAFE_CAPABILITIES.allowGitOps).toBe(false);
        expect(SAFE_CAPABILITIES.allowBash).toBe(false);
        expect(SAFE_CAPABILITIES.allowWebSearch).toBe(false);
        expect(SAFE_CAPABILITIES.allowMcp).toBe(false);
      });

      it('should have zero sub-agent depth', () => {
        expect(SAFE_CAPABILITIES.maxSubAgentDepth).toBe(0);
      });

      it('should have shorter timeout than default', () => {
        expect(SAFE_CAPABILITIES.timeout).toBeLessThanOrEqual(DEFAULT_CAPABILITIES.timeout);
      });
    });

    describe('Capability merging', () => {
      it('should allow custom capabilities to override defaults', () => {
        const custom: AgentCapabilities = {
          ...DEFAULT_CAPABILITIES,
          allowBash: false,
          timeout: 120000,
        };

        expect(custom.allowSubAgents).toBe(true); // From default
        expect(custom.allowBash).toBe(false); // Overridden
        expect(custom.timeout).toBe(120000); // Overridden
      });
    });
  });

  describe('MCP Server Templates', () => {
    it('should have playwright template', () => {
      expect(MCP_SERVER_TEMPLATES).toHaveProperty('playwright');
      expect(MCP_SERVER_TEMPLATES.playwright.name).toBe('playwright');
      expect(MCP_SERVER_TEMPLATES.playwright.command).toBeTruthy();
      expect(MCP_SERVER_TEMPLATES.playwright.args).toBeInstanceOf(Array);
    });

    it('should have mobilenext template', () => {
      expect(MCP_SERVER_TEMPLATES).toHaveProperty('mobilenext');
      expect(MCP_SERVER_TEMPLATES.mobilenext.name).toBe('mobilenext');
    });

    it('should have valid server definitions', () => {
      for (const [key, template] of Object.entries(MCP_SERVER_TEMPLATES)) {
        expect(template.name).toBeTruthy();
        expect(template.command).toBeTruthy();
        expect(template.args).toBeInstanceOf(Array);
        expect(typeof template.description).toBe('string');
      }
    });

    it('should use npx for npm-based MCP servers', () => {
      expect(MCP_SERVER_TEMPLATES.playwright.command).toBe('npx');
      expect(MCP_SERVER_TEMPLATES.mobilenext.command).toBe('npx');
    });
  });

  describe('Agent Modes', () => {
    it('should support all expected modes', () => {
      const modes: AgentMode[] = ['branch', 'project', 'task', 'review', 'refactor'];

      modes.forEach(mode => {
        const config: Partial<AgentSessionConfig> = { mode };
        expect(config.mode).toBe(mode);
      });
    });
  });

  describe('Session States', () => {
    it('should support all expected states', () => {
      const states: SessionState[] = ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'];

      states.forEach(state => {
        expect(typeof state).toBe('string');
      });
    });

    it('should have terminal and non-terminal states', () => {
      const terminalStates: SessionState[] = ['completed', 'failed', 'cancelled'];
      const activeStates: SessionState[] = ['pending', 'running', 'paused'];

      expect(terminalStates.length).toBe(3);
      expect(activeStates.length).toBe(3);
    });
  });

  describe('Stream Event Types', () => {
    it('should support all expected event types', () => {
      const eventTypes: StreamEventType[] = [
        'session_start',
        'thinking',
        'text',
        'tool_use',
        'tool_result',
        'subagent_spawn',
        'subagent_result',
        'file_edit',
        'bash_command',
        'bash_output',
        'error',
        'warning',
        'progress',
        'session_end',
      ];

      expect(eventTypes.length).toBe(14);
    });
  });

  describe('Stream Event Structures', () => {
    describe('TextEvent', () => {
      it('should have required fields', () => {
        const event: TextEvent = {
          type: 'text',
          timestamp: new Date().toISOString(),
          sessionId: 'test-session',
          content: 'Hello, world!',
          isPartial: false,
        };

        expect(event.type).toBe('text');
        expect(event.content).toBe('Hello, world!');
        expect(event.isPartial).toBe(false);
      });

      it('should support partial content', () => {
        const event: TextEvent = {
          type: 'text',
          timestamp: new Date().toISOString(),
          sessionId: 'test-session',
          content: 'Partial...',
          isPartial: true,
        };

        expect(event.isPartial).toBe(true);
      });
    });

    describe('ToolUseEvent', () => {
      it('should have required fields', () => {
        const event: ToolUseEvent = {
          type: 'tool_use',
          timestamp: new Date().toISOString(),
          sessionId: 'test-session',
          toolName: 'Edit',
          toolId: 'tool-123',
          input: { file_path: '/path/to/file.ts', old_string: 'foo', new_string: 'bar' },
        };

        expect(event.type).toBe('tool_use');
        expect(event.toolName).toBe('Edit');
        expect(event.input).toHaveProperty('file_path');
      });
    });

    describe('FileEditEvent', () => {
      it('should have required fields for edit action', () => {
        const event: FileEditEvent = {
          type: 'file_edit',
          timestamp: new Date().toISOString(),
          sessionId: 'test-session',
          filePath: '/path/to/file.ts',
          action: 'edit',
          diff: '- old\n+ new',
        };

        expect(event.action).toBe('edit');
        expect(event.diff).toContain('old');
        expect(event.diff).toContain('new');
      });

      it('should support create action without diff', () => {
        const event: FileEditEvent = {
          type: 'file_edit',
          timestamp: new Date().toISOString(),
          sessionId: 'test-session',
          filePath: '/path/to/new-file.ts',
          action: 'create',
        };

        expect(event.action).toBe('create');
        expect(event.diff).toBeUndefined();
      });
    });

    describe('SessionEndEvent', () => {
      it('should have required fields for success', () => {
        const event: SessionEndEvent = {
          type: 'session_end',
          timestamp: new Date().toISOString(),
          sessionId: 'test-session',
          success: true,
          summary: 'Completed successfully',
          filesModified: ['file1.ts', 'file2.ts'],
          duration: 5000,
        };

        expect(event.success).toBe(true);
        expect(event.filesModified).toHaveLength(2);
        expect(event.duration).toBeGreaterThan(0);
      });

      it('should have required fields for failure', () => {
        const event: SessionEndEvent = {
          type: 'session_end',
          timestamp: new Date().toISOString(),
          sessionId: 'test-session',
          success: false,
          summary: 'Failed due to timeout',
          filesModified: [],
          duration: 600000,
        };

        expect(event.success).toBe(false);
        expect(event.filesModified).toHaveLength(0);
      });
    });
  });

  describe('StartAgentRequest', () => {
    it('should have minimal required fields', () => {
      const request: StartAgentRequest = {
        mode: 'task',
        prompt: 'Fix the bug in auth.ts',
      };

      expect(request.mode).toBe('task');
      expect(request.prompt).toBeTruthy();
    });

    it('should support full configuration', () => {
      const request: StartAgentRequest = {
        workingDir: '/path/to/project',
        repoFullName: 'owner/repo',
        branch: 'feature-branch',
        mode: 'branch',
        prompt: 'Implement new feature',
        systemPrompt: 'You are an expert developer',
        permissionPreset: 'custom',
        capabilities: {
          allowSubAgents: true,
          allowFileEdits: true,
          allowBash: false,
        },
        mcpServers: ['playwright'],
        customMcpServers: [{
          name: 'custom',
          command: 'node',
          args: ['server.js'],
        }],
        allowSlashCommands: true,
        model: 'claude-sonnet-4-20250514',
      };

      expect(request.repoFullName).toBe('owner/repo');
      expect(request.mcpServers).toContain('playwright');
      expect(request.customMcpServers).toHaveLength(1);
    });

    it('should support permission presets', () => {
      const fullRequest: StartAgentRequest = {
        mode: 'task',
        prompt: 'Task',
        permissionPreset: 'full',
      };

      const safeRequest: StartAgentRequest = {
        mode: 'task',
        prompt: 'Task',
        permissionPreset: 'safe',
      };

      const customRequest: StartAgentRequest = {
        mode: 'task',
        prompt: 'Task',
        permissionPreset: 'custom',
        capabilities: { allowBash: false },
      };

      expect(fullRequest.permissionPreset).toBe('full');
      expect(safeRequest.permissionPreset).toBe('safe');
      expect(customRequest.permissionPreset).toBe('custom');
    });
  });

  describe('AgentSessionConfig', () => {
    it('should have all required fields', () => {
      const config: AgentSessionConfig = {
        sessionId: 'session-123',
        workingDir: '/path/to/project',
        repoFullName: 'owner/repo',
        branch: 'main',
        mode: 'branch',
        prompt: 'Implement feature',
        capabilities: DEFAULT_CAPABILITIES,
        mcpServers: [],
        allowSlashCommands: true,
      };

      expect(config.sessionId).toBeTruthy();
      expect(config.workingDir).toBeTruthy();
      expect(config.mode).toBe('branch');
      expect(config.capabilities).toBeDefined();
    });

    it('should support optional fields', () => {
      const config: AgentSessionConfig = {
        sessionId: 'session-123',
        workingDir: '/path/to/project',
        mode: 'task',
        prompt: 'Task',
        systemPrompt: 'Custom system prompt',
        capabilities: DEFAULT_CAPABILITIES,
        mcpServers: [MCP_SERVER_TEMPLATES.playwright],
        env: { NODE_ENV: 'test' },
        allowSlashCommands: false,
        model: 'claude-sonnet-4-20250514',
      };

      expect(config.systemPrompt).toBeTruthy();
      expect(config.env).toHaveProperty('NODE_ENV');
      expect(config.model).toBeTruthy();
    });
  });

  describe('McpServerDefinition', () => {
    it('should have required fields', () => {
      const server: McpServerDefinition = {
        name: 'test-server',
        command: 'npx',
        args: ['@test/mcp-server'],
      };

      expect(server.name).toBeTruthy();
      expect(server.command).toBeTruthy();
      expect(server.args).toBeInstanceOf(Array);
    });

    it('should support environment variables', () => {
      const server: McpServerDefinition = {
        name: 'test-server',
        command: 'node',
        args: ['server.js'],
        env: {
          API_KEY: 'secret',
          DEBUG: 'true',
        },
        description: 'A test MCP server',
      };

      expect(server.env).toHaveProperty('API_KEY');
      expect(server.description).toBeTruthy();
    });
  });
});

describe('Type Safety', () => {
  it('should enforce correct types for capabilities', () => {
    const capabilities: AgentCapabilities = {
      allowSubAgents: true,
      allowFileEdits: true,
      allowGitOps: true,
      allowBash: true,
      allowWebSearch: false,
      allowMcp: true,
      maxSubAgentDepth: 2,
      timeout: 300000,
    };

    // All boolean flags should be boolean
    expect(typeof capabilities.allowSubAgents).toBe('boolean');
    expect(typeof capabilities.allowFileEdits).toBe('boolean');
    expect(typeof capabilities.allowGitOps).toBe('boolean');
    expect(typeof capabilities.allowBash).toBe('boolean');
    expect(typeof capabilities.allowWebSearch).toBe('boolean');
    expect(typeof capabilities.allowMcp).toBe('boolean');

    // Numeric fields should be numbers
    expect(typeof capabilities.maxSubAgentDepth).toBe('number');
    expect(typeof capabilities.timeout).toBe('number');
  });

  it('should enforce ISO timestamp format in events', () => {
    const timestamp = new Date().toISOString();
    const event: StreamEvent = {
      type: 'progress',
      timestamp,
      sessionId: 'test',
      phase: 'test',
      message: 'Testing',
    };

    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
