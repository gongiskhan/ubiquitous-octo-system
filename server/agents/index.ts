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

// RAG - explicitly re-export to avoid CredentialData conflict with ./types.js
export {
  add,
  query,
  getById,
  deleteItem,
  clearProject,
  getProjectItems,
  getCredentials,
  storeCredentials,
  getContextFor,
  storeTestResult,
  storeFeedback,
  storeInstruction,
  storeIterationResult,
} from './rag/index.js';
export type { KnowledgeItem, QueryOptions, QueryResult, KnowledgeType } from './rag/index.js';
