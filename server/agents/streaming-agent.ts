/**
 * Streaming Coding Agent
 * Real-time agent execution using Claude Code CLI with SSE streaming
 */

import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { EventEmitter } from 'events';
import { writeFileSync, existsSync, mkdirSync, unlinkSync, readFileSync } from 'fs';
import { randomUUID } from 'crypto';

// Use Node.js native UUID generator
const uuidv4 = randomUUID;
import {
  AgentSessionConfig,
  AgentSessionStatus,
  StreamEvent,
  SessionState,
  StartAgentRequest,
  StartAgentResponse,
  AgentCapabilities,
  DEFAULT_CAPABILITIES,
  SAFE_CAPABILITIES,
  MCP_SERVER_TEMPLATES,
  McpServerDefinition,
  AgentHistoryEntry,
} from './streaming-types.js';
import { info, warn, error as logError } from '../logging/logger.js';
import { getCloneBaseDir, getRepoConfig } from '../config.js';

/**
 * Active agent session
 */
interface ActiveSession {
  config: AgentSessionConfig;
  process: ChildProcess | null;
  state: SessionState;
  startedAt: Date;
  lastActivity: Date;
  events: StreamEvent[];
  filesModified: string[];
  subAgentsSpawned: number;
  currentPhase: string;
  error?: string;
  emitter: EventEmitter;
}

/**
 * Streaming Agent Manager
 * Manages agent sessions and streaming
 */
class StreamingAgentManager {
  private sessions = new Map<string, ActiveSession>();
  private history: AgentHistoryEntry[] = [];
  private maxHistory = 100;

  /**
   * Start a new agent session
   */
  async startSession(request: StartAgentRequest): Promise<StartAgentResponse> {
    const sessionId = uuidv4();

    // Resolve working directory
    let workingDir = request.workingDir;
    if (!workingDir && request.repoFullName) {
      const repoConfig = getRepoConfig(request.repoFullName);
      if (repoConfig?.localPath) {
        workingDir = repoConfig.localPath;
      } else {
        const [owner, repo] = request.repoFullName.split('/');
        workingDir = join(getCloneBaseDir(), owner, repo);
      }
    }
    if (!workingDir) {
      workingDir = getCloneBaseDir();
    }

    // Validate working directory
    if (!existsSync(workingDir)) {
      throw new Error(`Working directory does not exist: ${workingDir}`);
    }

    // Resolve capabilities
    let capabilities: AgentCapabilities;
    if (request.permissionPreset === 'safe') {
      capabilities = { ...SAFE_CAPABILITIES };
    } else if (request.permissionPreset === 'custom' && request.capabilities) {
      capabilities = { ...DEFAULT_CAPABILITIES, ...request.capabilities };
    } else {
      capabilities = { ...DEFAULT_CAPABILITIES };
    }

    // Resolve MCP servers
    const mcpServers: McpServerDefinition[] = [];
    if (request.mcpServers) {
      for (const serverName of request.mcpServers) {
        if (MCP_SERVER_TEMPLATES[serverName]) {
          mcpServers.push(MCP_SERVER_TEMPLATES[serverName]);
        }
      }
    }
    if (request.customMcpServers) {
      mcpServers.push(...request.customMcpServers);
    }

    // Create session config
    const config: AgentSessionConfig = {
      sessionId,
      workingDir,
      repoFullName: request.repoFullName,
      branch: request.branch,
      mode: request.mode,
      prompt: request.prompt,
      systemPrompt: request.systemPrompt,
      capabilities,
      mcpServers,
      allowSlashCommands: request.allowSlashCommands ?? true,
      model: request.model,
    };

    // Create session
    const session: ActiveSession = {
      config,
      process: null,
      state: 'pending',
      startedAt: new Date(),
      lastActivity: new Date(),
      events: [],
      filesModified: [],
      subAgentsSpawned: 0,
      currentPhase: 'initializing',
      emitter: new EventEmitter(),
    };

    this.sessions.set(sessionId, session);

    // Start the agent asynchronously
    this.runAgent(sessionId).catch((err) => {
      logError(`Agent session ${sessionId} failed: ${err.message}`, 'StreamingAgent');
      session.state = 'failed';
      session.error = err.message;
      this.emitEvent(sessionId, {
        type: 'error',
        timestamp: new Date().toISOString(),
        sessionId,
        message: err.message,
        recoverable: false,
      });
    });

    info(`Started agent session ${sessionId} in ${workingDir}`, 'StreamingAgent');

    return {
      sessionId,
      message: 'Agent session started',
      streamUrl: `/api/agent/stream/${sessionId}`,
    };
  }

  /**
   * Run the agent process
   */
  private async runAgent(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const { config } = session;
    session.state = 'running';
    session.currentPhase = 'starting';

    // Emit session start event
    this.emitEvent(sessionId, {
      type: 'session_start',
      timestamp: new Date().toISOString(),
      sessionId,
      config: {
        mode: config.mode,
        repoFullName: config.repoFullName,
        branch: config.branch,
        workingDir: config.workingDir,
      },
    });

    // Set up MCP configuration if needed
    let mcpConfigPath: string | null = null;
    let existingMcpConfig: string | null = null;

    if (config.mcpServers.length > 0 && config.capabilities.allowMcp) {
      mcpConfigPath = join(config.workingDir, '.mcp.json');

      // Backup existing config
      if (existsSync(mcpConfigPath)) {
        existingMcpConfig = readFileSync(mcpConfigPath, 'utf-8');
      }

      // Write MCP config
      const mcpConfig: Record<string, object> = {};
      for (const server of config.mcpServers) {
        mcpConfig[server.name] = {
          command: server.command,
          args: server.args,
          ...(server.env && { env: server.env }),
        };
      }
      writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: mcpConfig }, null, 2));

      this.emitEvent(sessionId, {
        type: 'progress',
        timestamp: new Date().toISOString(),
        sessionId,
        phase: 'setup',
        message: `Configured ${config.mcpServers.length} MCP server(s)`,
      });
    }

    // Build Claude Code arguments
    const args = this.buildClaudeArgs(config);

    // Build environment
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...config.env,
    };

    // Add MCP server environments
    for (const server of config.mcpServers) {
      if (server.env) {
        Object.assign(env, server.env);
      }
    }

    this.emitEvent(sessionId, {
      type: 'progress',
      timestamp: new Date().toISOString(),
      sessionId,
      phase: 'execution',
      message: 'Starting Claude Code agent...',
    });

    // Spawn Claude Code process
    const proc = spawn('claude', args, {
      cwd: config.workingDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    session.process = proc;
    session.currentPhase = 'running';

    let outputBuffer = '';
    let currentToolId: string | null = null;

    // Handle stdout
    proc.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      outputBuffer += chunk;
      session.lastActivity = new Date();

      // Parse and emit events from output
      this.parseAndEmitOutput(sessionId, chunk, outputBuffer);
    });

    // Handle stderr
    proc.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      session.lastActivity = new Date();

      // Check if it's an error or just info
      if (chunk.toLowerCase().includes('error')) {
        this.emitEvent(sessionId, {
          type: 'warning',
          timestamp: new Date().toISOString(),
          sessionId,
          message: chunk.trim(),
        });
      }
    });

    // Handle process timeout
    const timeoutId = setTimeout(() => {
      if (session.state === 'running') {
        warn(`Session ${sessionId} timed out after ${config.capabilities.timeout}ms`, 'StreamingAgent');
        this.cancelSession(sessionId, 'Session timed out');
      }
    }, config.capabilities.timeout);

    // Handle process exit
    return new Promise<void>((resolve, reject) => {
      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        this.cleanupMcpConfig(mcpConfigPath, existingMcpConfig);

        const success = code === 0;
        session.state = success ? 'completed' : 'failed';

        // Parse modified files from output
        session.filesModified = this.parseModifiedFiles(outputBuffer);

        // Generate summary
        const summary = this.generateSummary(outputBuffer, session);

        // Emit session end event
        this.emitEvent(sessionId, {
          type: 'session_end',
          timestamp: new Date().toISOString(),
          sessionId,
          success,
          summary,
          filesModified: session.filesModified,
          duration: Date.now() - session.startedAt.getTime(),
        });

        // Add to history
        this.addToHistory(session, summary);

        info(`Session ${sessionId} completed with code ${code}`, 'StreamingAgent');
        resolve();
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        this.cleanupMcpConfig(mcpConfigPath, existingMcpConfig);

        session.state = 'failed';
        session.error = err.message;

        this.emitEvent(sessionId, {
          type: 'error',
          timestamp: new Date().toISOString(),
          sessionId,
          message: err.message,
          recoverable: false,
        });

        this.addToHistory(session, `Error: ${err.message}`);

        logError(`Session ${sessionId} error: ${err.message}`, 'StreamingAgent');
        reject(err);
      });
    });
  }

  /**
   * Build Claude CLI arguments
   */
  private buildClaudeArgs(config: AgentSessionConfig): string[] {
    const args: string[] = [];

    // Use print mode for streaming
    args.push('-p');

    // Output format for parsing
    args.push('--output-format', 'stream-json');

    // Model selection
    if (config.model) {
      args.push('--model', config.model);
    }

    // Capabilities as flags
    if (config.capabilities.allowFileEdits) {
      args.push('--dangerously-skip-permissions');
    }

    // Allow tools based on capabilities
    const allowedTools: string[] = ['Read', 'Glob', 'Grep'];

    if (config.capabilities.allowFileEdits) {
      allowedTools.push('Edit', 'Write', 'MultiEdit');
    }
    if (config.capabilities.allowBash) {
      allowedTools.push('Bash');
    }
    if (config.capabilities.allowSubAgents) {
      allowedTools.push('Task');
    }
    if (config.capabilities.allowWebSearch) {
      allowedTools.push('WebSearch', 'WebFetch');
    }

    // Add the prompt
    args.push(this.buildPrompt(config));

    return args;
  }

  /**
   * Build the full prompt with context
   */
  private buildPrompt(config: AgentSessionConfig): string {
    let prompt = '';

    // Add mode-specific context
    switch (config.mode) {
      case 'branch':
        prompt += `You are working on branch "${config.branch || 'main'}" of the repository "${config.repoFullName || 'local project'}".\n\n`;
        break;
      case 'project':
        prompt += `You are setting up a new project in ${config.workingDir}.\n\n`;
        break;
      case 'task':
        prompt += `You are completing a specific task in the codebase.\n\n`;
        break;
      case 'review':
        prompt += `You are reviewing code for quality, bugs, and improvements.\n\n`;
        break;
      case 'refactor':
        prompt += `You are refactoring code for better structure and maintainability.\n\n`;
        break;
    }

    // Add system prompt if provided
    if (config.systemPrompt) {
      prompt += `${config.systemPrompt}\n\n`;
    }

    // Add capabilities context
    if (config.capabilities.allowSubAgents) {
      prompt += `You can spawn sub-agents using the Task tool for complex parallel work. Maximum depth: ${config.capabilities.maxSubAgentDepth}.\n\n`;
    }

    // Add MCP context
    if (config.mcpServers.length > 0) {
      prompt += `Available MCP servers:\n`;
      for (const server of config.mcpServers) {
        prompt += `- ${server.name}: ${server.description || 'No description'}\n`;
      }
      prompt += '\n';
    }

    // Add the user's prompt
    prompt += config.prompt;

    return prompt;
  }

  /**
   * Parse output and emit appropriate events
   */
  private parseAndEmitOutput(sessionId: string, chunk: string, fullOutput: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Try to parse as JSON stream
    const lines = chunk.split('\n').filter((line) => line.trim());

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        this.handleParsedEvent(sessionId, event);
      } catch {
        // Not JSON, emit as text
        this.emitEvent(sessionId, {
          type: 'text',
          timestamp: new Date().toISOString(),
          sessionId,
          content: line,
          isPartial: true,
        });
      }
    }
  }

  /**
   * Handle parsed JSON event from Claude Code
   */
  private handleParsedEvent(sessionId: string, event: any): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const timestamp = new Date().toISOString();

    switch (event.type) {
      case 'text':
        this.emitEvent(sessionId, {
          type: 'text',
          timestamp,
          sessionId,
          content: event.text || event.content || '',
          isPartial: event.partial ?? false,
        });
        break;

      case 'thinking':
        this.emitEvent(sessionId, {
          type: 'thinking',
          timestamp,
          sessionId,
          content: event.text || event.content || '',
        });
        break;

      case 'tool_use':
        this.handleToolUse(sessionId, event);
        break;

      case 'tool_result':
        this.handleToolResult(sessionId, event);
        break;

      case 'assistant':
      case 'message':
        // Process content blocks
        if (event.content) {
          for (const block of event.content) {
            if (block.type === 'text') {
              this.emitEvent(sessionId, {
                type: 'text',
                timestamp,
                sessionId,
                content: block.text,
                isPartial: false,
              });
            } else if (block.type === 'tool_use') {
              this.handleToolUse(sessionId, block);
            }
          }
        }
        break;

      default:
        // Pass through other events as text
        if (event.text || event.content) {
          this.emitEvent(sessionId, {
            type: 'text',
            timestamp,
            sessionId,
            content: event.text || event.content,
            isPartial: false,
          });
        }
    }
  }

  /**
   * Handle tool use events
   */
  private handleToolUse(sessionId: string, event: any): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const timestamp = new Date().toISOString();
    const toolName = event.name || event.tool_name;
    const toolId = event.id || event.tool_id || uuidv4();
    const input = event.input || event.parameters || {};

    // Emit appropriate event based on tool
    switch (toolName) {
      case 'Edit':
      case 'Write':
      case 'MultiEdit':
        this.emitEvent(sessionId, {
          type: 'file_edit',
          timestamp,
          sessionId,
          filePath: input.file_path || input.path || '',
          action: toolName === 'Write' ? 'create' : 'edit',
          diff: input.old_string
            ? `- ${input.old_string}\n+ ${input.new_string}`
            : undefined,
        });
        break;

      case 'Bash':
        this.emitEvent(sessionId, {
          type: 'bash_command',
          timestamp,
          sessionId,
          command: input.command || '',
          workingDir: session.config.workingDir,
        });
        break;

      case 'Task':
        session.subAgentsSpawned++;
        this.emitEvent(sessionId, {
          type: 'subagent_spawn',
          timestamp,
          sessionId,
          subAgentId: toolId,
          description: input.description || '',
          prompt: input.prompt || '',
        });
        break;

      default:
        this.emitEvent(sessionId, {
          type: 'tool_use',
          timestamp,
          sessionId,
          toolName,
          toolId,
          input,
        });
    }
  }

  /**
   * Handle tool result events
   */
  private handleToolResult(sessionId: string, event: any): void {
    const timestamp = new Date().toISOString();
    const toolId = event.tool_use_id || event.id || '';

    this.emitEvent(sessionId, {
      type: 'tool_result',
      timestamp,
      sessionId,
      toolId,
      result: event.content || event.result,
      success: !event.is_error,
    });
  }

  /**
   * Parse modified files from output
   */
  private parseModifiedFiles(output: string): string[] {
    const files = new Set<string>();

    // Look for common patterns
    const patterns = [
      /(?:edited|modified|updated|created|wrote)\s+(?:file\s+)?["']?([^"'\s\n]+)/gi,
      /file[:\s]+["']?([^"'\s\n]+\.\w+)/gi,
      /Writing to\s+["']?([^"'\s\n]+)/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(output)) !== null) {
        const filePath = match[1];
        if (filePath && !filePath.startsWith('http')) {
          files.add(filePath);
        }
      }
    }

    return Array.from(files);
  }

  /**
   * Generate summary from output
   */
  private generateSummary(output: string, session: ActiveSession): string {
    const parts: string[] = [];

    if (session.filesModified.length > 0) {
      parts.push(`Modified ${session.filesModified.length} file(s)`);
    }

    if (session.subAgentsSpawned > 0) {
      parts.push(`Spawned ${session.subAgentsSpawned} sub-agent(s)`);
    }

    // Look for summary in output
    const summaryMatch = output.match(/(?:summary|completed|finished)[:.]?\s*([^\n]+)/i);
    if (summaryMatch) {
      parts.push(summaryMatch[1].trim());
    }

    return parts.length > 0 ? parts.join('. ') : 'Session completed';
  }

  /**
   * Emit an event to the session's listeners
   */
  private emitEvent(sessionId: string, event: StreamEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.events.push(event);
    session.emitter.emit('event', event);
  }

  /**
   * Cleanup MCP configuration
   */
  private cleanupMcpConfig(mcpConfigPath: string | null, existingConfig: string | null): void {
    if (!mcpConfigPath) return;

    try {
      if (existingConfig !== null) {
        writeFileSync(mcpConfigPath, existingConfig, 'utf-8');
      } else if (existsSync(mcpConfigPath)) {
        unlinkSync(mcpConfigPath);
      }
    } catch (err) {
      warn(`Failed to cleanup MCP config: ${err}`, 'StreamingAgent');
    }
  }

  /**
   * Add session to history
   */
  private addToHistory(session: ActiveSession, summary: string): void {
    const entry: AgentHistoryEntry = {
      sessionId: session.config.sessionId,
      repoFullName: session.config.repoFullName,
      branch: session.config.branch,
      mode: session.config.mode,
      prompt: session.config.prompt.substring(0, 200),
      state: session.state,
      startedAt: session.startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      duration: Date.now() - session.startedAt.getTime(),
      filesModified: session.filesModified,
      summary,
    };

    this.history.unshift(entry);

    // Trim history
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(0, this.maxHistory);
    }
  }

  /**
   * Cancel a running session
   */
  cancelSession(sessionId: string, reason?: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== 'running') {
      return false;
    }

    if (session.process) {
      session.process.kill('SIGTERM');
    }

    session.state = 'cancelled';
    session.error = reason || 'Cancelled by user';

    this.emitEvent(sessionId, {
      type: 'session_end',
      timestamp: new Date().toISOString(),
      sessionId,
      success: false,
      summary: reason || 'Session cancelled',
      filesModified: session.filesModified,
      duration: Date.now() - session.startedAt.getTime(),
    });

    this.addToHistory(session, reason || 'Cancelled');

    return true;
  }

  /**
   * Get session status
   */
  getSessionStatus(sessionId: string): AgentSessionStatus | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      sessionId,
      state: session.state,
      startedAt: session.startedAt.toISOString(),
      lastActivity: session.lastActivity.toISOString(),
      config: session.config,
      eventsCount: session.events.length,
      filesModified: session.filesModified,
      subAgentsSpawned: session.subAgentsSpawned,
      currentPhase: session.currentPhase,
      error: session.error,
    };
  }

  /**
   * Get session events (for replay or catch-up)
   */
  getSessionEvents(sessionId: string, afterIndex?: number): StreamEvent[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    if (afterIndex !== undefined) {
      return session.events.slice(afterIndex);
    }
    return [...session.events];
  }

  /**
   * Subscribe to session events
   */
  subscribeToSession(
    sessionId: string,
    callback: (event: StreamEvent) => void
  ): () => void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    session.emitter.on('event', callback);

    return () => {
      session.emitter.off('event', callback);
    };
  }

  /**
   * List active sessions
   */
  listActiveSessions(): AgentSessionStatus[] {
    const statuses: AgentSessionStatus[] = [];

    for (const [sessionId, session] of this.sessions) {
      if (session.state === 'running' || session.state === 'pending') {
        statuses.push(this.getSessionStatus(sessionId)!);
      }
    }

    return statuses;
  }

  /**
   * Get session history
   */
  getHistory(limit?: number): AgentHistoryEntry[] {
    if (limit) {
      return this.history.slice(0, limit);
    }
    return [...this.history];
  }

  /**
   * Clean up completed sessions older than maxAge
   */
  cleanupSessions(maxAge: number = 3600000): number {
    let cleaned = 0;
    const now = Date.now();

    for (const [sessionId, session] of this.sessions) {
      if (
        session.state !== 'running' &&
        session.state !== 'pending' &&
        now - session.lastActivity.getTime() > maxAge
      ) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    return cleaned;
  }
}

// Export singleton instance
export const streamingAgentManager = new StreamingAgentManager();

// Re-export types
export * from './streaming-types.js';
