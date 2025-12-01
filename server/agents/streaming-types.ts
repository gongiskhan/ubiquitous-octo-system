/**
 * Types for Streaming Agent System
 * Real-time agent execution with SSE support
 */

/**
 * Agent execution modes
 */
export type AgentMode = 'branch' | 'project' | 'task' | 'review' | 'refactor';

/**
 * Agent capability flags
 */
export interface AgentCapabilities {
  /** Allow spawning sub-agents for parallel work */
  allowSubAgents: boolean;
  /** Allow file system modifications */
  allowFileEdits: boolean;
  /** Allow git operations */
  allowGitOps: boolean;
  /** Allow running shell commands */
  allowBash: boolean;
  /** Allow web searches */
  allowWebSearch: boolean;
  /** Allow MCP servers */
  allowMcp: boolean;
  /** Maximum sub-agent depth */
  maxSubAgentDepth: number;
  /** Timeout in milliseconds */
  timeout: number;
}

/**
 * Default capabilities for different permission levels
 */
export const DEFAULT_CAPABILITIES: AgentCapabilities = {
  allowSubAgents: true,
  allowFileEdits: true,
  allowGitOps: true,
  allowBash: true,
  allowWebSearch: false,
  allowMcp: true,
  maxSubAgentDepth: 2,
  timeout: 600000, // 10 minutes
};

export const SAFE_CAPABILITIES: AgentCapabilities = {
  allowSubAgents: false,
  allowFileEdits: false,
  allowGitOps: false,
  allowBash: false,
  allowWebSearch: false,
  allowMcp: false,
  maxSubAgentDepth: 0,
  timeout: 300000, // 5 minutes
};

/**
 * MCP server configuration for the agent
 */
export interface McpServerDefinition {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  description?: string;
}

/**
 * Pre-defined MCP server templates
 */
export const MCP_SERVER_TEMPLATES: Record<string, McpServerDefinition> = {
  playwright: {
    name: 'playwright',
    command: 'npx',
    args: ['@playwright/mcp@latest'],
    description: 'Browser automation and testing',
  },
  mobilenext: {
    name: 'mobilenext',
    command: 'npx',
    args: ['@anthropic-ai/mobilenext-mcp@latest'],
    description: 'Mobile app testing (iOS/Android)',
  },
  filesystem: {
    name: 'filesystem',
    command: 'npx',
    args: ['@anthropic-ai/mcp-server-filesystem'],
    description: 'Enhanced file system operations',
  },
  github: {
    name: 'github',
    command: 'npx',
    args: ['@anthropic-ai/mcp-server-github'],
    description: 'GitHub API integration',
  },
};

/**
 * Agent session configuration
 */
export interface AgentSessionConfig {
  /** Unique session ID */
  sessionId: string;
  /** Working directory */
  workingDir: string;
  /** Repository full name (owner/repo) */
  repoFullName?: string;
  /** Branch to work on */
  branch?: string;
  /** Agent execution mode */
  mode: AgentMode;
  /** Custom prompt/instructions */
  prompt: string;
  /** System prompt override */
  systemPrompt?: string;
  /** Agent capabilities */
  capabilities: AgentCapabilities;
  /** MCP servers to enable */
  mcpServers: McpServerDefinition[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Allow using Claude Code slash commands */
  allowSlashCommands: boolean;
  /** Claude model to use (default: claude-sonnet-4-20250514) */
  model?: string;
}

/**
 * Event types for streaming
 */
export type StreamEventType =
  | 'session_start'
  | 'thinking'
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'subagent_spawn'
  | 'subagent_result'
  | 'file_edit'
  | 'bash_command'
  | 'bash_output'
  | 'error'
  | 'warning'
  | 'progress'
  | 'session_end';

/**
 * Base streaming event
 */
export interface BaseStreamEvent {
  type: StreamEventType;
  timestamp: string;
  sessionId: string;
}

/**
 * Session start event
 */
export interface SessionStartEvent extends BaseStreamEvent {
  type: 'session_start';
  config: Partial<AgentSessionConfig>;
}

/**
 * Text output event
 */
export interface TextEvent extends BaseStreamEvent {
  type: 'text';
  content: string;
  isPartial: boolean;
}

/**
 * Thinking/reasoning event
 */
export interface ThinkingEvent extends BaseStreamEvent {
  type: 'thinking';
  content: string;
}

/**
 * Tool use event
 */
export interface ToolUseEvent extends BaseStreamEvent {
  type: 'tool_use';
  toolName: string;
  toolId: string;
  input: Record<string, unknown>;
}

/**
 * Tool result event
 */
export interface ToolResultEvent extends BaseStreamEvent {
  type: 'tool_result';
  toolId: string;
  result: unknown;
  success: boolean;
}

/**
 * Sub-agent spawn event
 */
export interface SubAgentSpawnEvent extends BaseStreamEvent {
  type: 'subagent_spawn';
  subAgentId: string;
  description: string;
  prompt: string;
}

/**
 * Sub-agent result event
 */
export interface SubAgentResultEvent extends BaseStreamEvent {
  type: 'subagent_result';
  subAgentId: string;
  result: string;
  success: boolean;
}

/**
 * File edit event
 */
export interface FileEditEvent extends BaseStreamEvent {
  type: 'file_edit';
  filePath: string;
  action: 'create' | 'edit' | 'delete';
  diff?: string;
}

/**
 * Bash command event
 */
export interface BashCommandEvent extends BaseStreamEvent {
  type: 'bash_command';
  command: string;
  workingDir: string;
}

/**
 * Bash output event
 */
export interface BashOutputEvent extends BaseStreamEvent {
  type: 'bash_output';
  output: string;
  isStderr: boolean;
  exitCode?: number;
}

/**
 * Error event
 */
export interface ErrorEvent extends BaseStreamEvent {
  type: 'error';
  message: string;
  code?: string;
  recoverable: boolean;
}

/**
 * Warning event
 */
export interface WarningEvent extends BaseStreamEvent {
  type: 'warning';
  message: string;
}

/**
 * Progress event
 */
export interface ProgressEvent extends BaseStreamEvent {
  type: 'progress';
  phase: string;
  message: string;
  percentage?: number;
}

/**
 * Session end event
 */
export interface SessionEndEvent extends BaseStreamEvent {
  type: 'session_end';
  success: boolean;
  summary: string;
  filesModified: string[];
  duration: number;
}

/**
 * Union type of all stream events
 */
export type StreamEvent =
  | SessionStartEvent
  | TextEvent
  | ThinkingEvent
  | ToolUseEvent
  | ToolResultEvent
  | SubAgentSpawnEvent
  | SubAgentResultEvent
  | FileEditEvent
  | BashCommandEvent
  | BashOutputEvent
  | ErrorEvent
  | WarningEvent
  | ProgressEvent
  | SessionEndEvent;

/**
 * Agent session state
 */
export type SessionState = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

/**
 * Agent session status
 */
export interface AgentSessionStatus {
  sessionId: string;
  state: SessionState;
  startedAt: string;
  lastActivity: string;
  config: AgentSessionConfig;
  eventsCount: number;
  filesModified: string[];
  subAgentsSpawned: number;
  currentPhase?: string;
  error?: string;
}

/**
 * Request to start an agent session
 */
export interface StartAgentRequest {
  /** Working directory or repo path */
  workingDir?: string;
  /** Repository full name */
  repoFullName?: string;
  /** Branch to work on */
  branch?: string;
  /** Agent mode */
  mode: AgentMode;
  /** Task prompt/instructions */
  prompt: string;
  /** System prompt override */
  systemPrompt?: string;
  /** Permission preset */
  permissionPreset?: 'full' | 'safe' | 'custom';
  /** Custom capabilities (when preset is 'custom') */
  capabilities?: Partial<AgentCapabilities>;
  /** MCP servers to enable */
  mcpServers?: string[];
  /** Custom MCP server configs */
  customMcpServers?: McpServerDefinition[];
  /** Allow slash commands */
  allowSlashCommands?: boolean;
  /** Model override */
  model?: string;
}

/**
 * Response from starting an agent session
 */
export interface StartAgentResponse {
  sessionId: string;
  message: string;
  streamUrl: string;
}

/**
 * Agent session history entry
 */
export interface AgentHistoryEntry {
  sessionId: string;
  repoFullName?: string;
  branch?: string;
  mode: AgentMode;
  prompt: string;
  state: SessionState;
  startedAt: string;
  endedAt?: string;
  duration?: number;
  filesModified: string[];
  summary?: string;
}

/**
 * Saved agent template
 */
export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  mode: AgentMode;
  promptTemplate: string;
  systemPrompt?: string;
  capabilities: AgentCapabilities;
  mcpServers: string[];
  createdAt: string;
  updatedAt: string;
}
