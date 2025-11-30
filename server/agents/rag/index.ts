/**
 * RAG Public API
 * Provides high-level functions for storing and retrieving knowledge
 */

import {
  add as storageAdd,
  query as storageQuery,
  getById,
  deleteItem,
  clearProject,
  getProjectItems,
} from './storage.js';

import type {
  KnowledgeItem,
  QueryOptions,
  QueryResult,
  KnowledgeType,
  CredentialData,
} from './types.js';

// Re-export types
export type {
  KnowledgeItem,
  QueryOptions,
  QueryResult,
  KnowledgeType,
  CredentialData,
};

// Re-export storage functions
export { storageAdd as add, storageQuery as query, getById, deleteItem, clearProject, getProjectItems };

/**
 * Get credentials for a specific project
 */
export async function getCredentials(
  project: string
): Promise<KnowledgeItem | null> {
  const results = await storageQuery({
    text: `credentials login authentication for ${project}`,
    types: ['credential'],
    project,
    topK: 1,
    minScore: 0.3,
  });

  return results.length > 0 ? await getById(results[0].id) : null;
}

/**
 * Store credentials for a project
 */
export async function storeCredentials(
  project: string,
  data: CredentialData
): Promise<string> {
  const content = `Login credentials for ${project}: username ${data.username}`;

  return await storageAdd({
    type: 'credential',
    project,
    content,
    metadata: {
      username: data.username,
      password: data.password,
      loginSelectors: data.loginSelectors,
      baseUrl: data.baseUrl,
      timestamp: new Date().toISOString(),
      usage_count: 0,
      source: 'user',
    },
  });
}

/**
 * Get relevant context for testing
 */
export async function getContextFor(
  queryText: string,
  project: string,
  types?: KnowledgeType[]
): Promise<QueryResult[]> {
  return await storageQuery({
    text: queryText,
    types: types || ['credential', 'feedback', 'test-result', 'instruction', 'selector'],
    project,
    topK: 15,
    minScore: 0.4,
  });
}

/**
 * Store test result
 */
export async function storeTestResult(
  project: string,
  url: string,
  summary: string,
  details: {
    path?: string;
    feature?: string;
    status: 'pass' | 'fail';
    score?: number;
    consoleErrors?: string[];
    networkErrors?: string[];
  }
): Promise<string> {
  const content = `Test result for ${url}: ${summary} (score: ${details.score || 0}%)`;

  return await storageAdd({
    type: 'test-result',
    project,
    content,
    metadata: {
      url,
      path: details.path,
      feature: details.feature,
      status: details.status,
      score: details.score,
      consoleErrors: details.consoleErrors,
      networkErrors: details.networkErrors,
      timestamp: new Date().toISOString(),
      usage_count: 0,
      source: 'test-agent',
    },
  });
}

/**
 * Store user feedback
 */
export async function storeFeedback(
  text: string,
  project?: string,
  category?: string
): Promise<string> {
  return await storageAdd({
    type: 'feedback',
    project: project || '(global)',
    content: text,
    metadata: {
      category,
      timestamp: new Date().toISOString(),
      usage_count: 0,
      source: 'user',
    },
  });
}

/**
 * Store custom instruction
 */
export async function storeInstruction(
  instruction: string,
  project?: string
): Promise<string> {
  return await storageAdd({
    type: 'instruction',
    project: project || '(global)',
    content: instruction,
    metadata: {
      timestamp: new Date().toISOString(),
      usage_count: 0,
      source: 'user',
    },
  });
}

/**
 * Store iteration result for tracking
 */
export async function storeIterationResult(
  project: string,
  iteration: {
    iteration: number;
    phase: 'test' | 'fix';
    score: number;
    testsPassed: number;
    testsFailed: number;
    fixesApplied?: number;
    filesChanged?: string[];
    duration: number;
  }
): Promise<string> {
  const content = `Iteration ${iteration.iteration}: ${iteration.phase} phase - score: ${iteration.score}%, ${iteration.testsPassed} passed, ${iteration.testsFailed} failed`;

  return await storageAdd({
    type: 'config',
    project,
    content,
    metadata: {
      orchestration_iteration: iteration.iteration,
      phase: iteration.phase,
      score: iteration.score,
      tests_passed: iteration.testsPassed,
      tests_failed: iteration.testsFailed,
      fixes_applied: iteration.fixesApplied,
      files_changed: iteration.filesChanged,
      duration: iteration.duration,
      timestamp: new Date().toISOString(),
      usage_count: 0,
      source: 'cli',
    },
  });
}
