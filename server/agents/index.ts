/**
 * Agents Module
 * Exports all agent-related functionality
 */

// Types
export * from './types.js';

// Base
export { BaseAgent, registerAgent, getAgent, listAgents } from './base.js';

// Agents
export { testAgent, runTest } from './test-agent.js';
export { codeAgent, fixIssues } from './code-agent.js';

// Workflows
export { executeTestAndFix, executeJustTest } from './workflows/test-and-fix.js';
export type { SlackNotifyCallback, TestAndFixOptions } from './workflows/test-and-fix.js';

// RAG
export * from './rag/index.js';
