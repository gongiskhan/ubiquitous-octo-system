/**
 * RAG (Retrieval-Augmented Generation) Type Definitions
 * For storing and retrieving context for testing agents
 */

/**
 * Knowledge type categories stored in the RAG system
 */
export type KnowledgeType =
  | 'credential'    // Login credentials and authentication data
  | 'selector'      // UI element selectors
  | 'feedback'      // User-provided testing wisdom
  | 'test-result'   // Automated test outcomes
  | 'instruction'   // Custom testing directives
  | 'config';       // Project-level configuration

/**
 * Login form selectors for automated authentication
 */
export interface LoginSelectors {
  usernameField: string;
  passwordField: string;
  submitButton: string;
}

/**
 * Credential data for storing authentication information
 */
export interface CredentialData {
  username: string;
  password: string;
  loginSelectors?: LoginSelectors;
  baseUrl?: string;
}

/**
 * Core knowledge item stored in the RAG system
 */
export interface KnowledgeItem {
  id: string;
  type: KnowledgeType;
  project: string;
  content: string;
  metadata: {
    timestamp: string;
    usage_count: number;
    last_used?: string;
    username?: string;
    password?: string;
    loginSelectors?: LoginSelectors;
    baseUrl?: string;
    url?: string;
    path?: string;
    feature?: string;
    status?: 'pass' | 'fail';
    consoleErrors?: string[];
    networkErrors?: string[];
    category?: string;
    source?: 'user' | 'test-agent' | 'cli';
    [key: string]: unknown;
  };
  embedding: number[];
}

/**
 * Options for querying the RAG system
 */
export interface QueryOptions {
  text: string;
  types?: KnowledgeType[];
  project?: string;
  topK?: number;
  minScore?: number;
}

/**
 * Result from a RAG query
 */
export interface QueryResult {
  id: string;
  type: KnowledgeType;
  project: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}
