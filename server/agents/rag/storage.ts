/**
 * RAG Storage System
 * Persists knowledge items in JSONL format with in-memory caching
 */

import { randomUUID } from 'crypto';
import { join } from 'path';
import { mkdirSync, existsSync, appendFileSync, readFileSync, writeFileSync } from 'fs';
import os from 'os';
import type { KnowledgeItem, QueryOptions, QueryResult } from './types.js';
import { generateEmbedding, cosineSimilarity } from './embeddings.js';

// Storage paths
const RAG_HOME = join(os.homedir(), '.branchrunner', 'rag');
const STORAGE_PATH = join(RAG_HOME, 'knowledge.jsonl');

// In-memory cache
let itemsCache: KnowledgeItem[] | null = null;

/**
 * Ensure storage directory exists
 */
function ensureStorageExists(): void {
  if (!existsSync(RAG_HOME)) {
    mkdirSync(RAG_HOME, { recursive: true });
  }
}

/**
 * Load all items from JSONL storage
 */
function loadItems(): KnowledgeItem[] {
  if (itemsCache !== null) {
    return itemsCache;
  }

  ensureStorageExists();

  if (!existsSync(STORAGE_PATH)) {
    itemsCache = [];
    return itemsCache;
  }

  const content = readFileSync(STORAGE_PATH, 'utf-8');
  const lines = content.trim().split('\n').filter(line => line.length > 0);

  itemsCache = lines.map(line => {
    try {
      return JSON.parse(line);
    } catch {
      console.warn(`[RAG] Failed to parse line: ${line.slice(0, 50)}...`);
      return null;
    }
  }).filter((item): item is KnowledgeItem => item !== null);

  return itemsCache;
}

/**
 * Save all items to JSONL storage
 */
function saveItems(items: KnowledgeItem[]): void {
  ensureStorageExists();
  const content = items.map(item => JSON.stringify(item)).join('\n') + (items.length > 0 ? '\n' : '');
  writeFileSync(STORAGE_PATH, content, 'utf-8');
  itemsCache = items;
}

/**
 * Append single item to JSONL storage
 */
function appendItem(item: KnowledgeItem): void {
  ensureStorageExists();
  const line = JSON.stringify(item) + '\n';
  appendFileSync(STORAGE_PATH, line, 'utf-8');

  if (itemsCache !== null) {
    itemsCache.push(item);
  } else {
    itemsCache = [item];
  }
}

/**
 * Add a new knowledge item to the RAG
 */
export async function add(
  item: Omit<KnowledgeItem, 'id' | 'embedding'>
): Promise<string> {
  const id = randomUUID();
  const embedding = await generateEmbedding(item.content);

  const fullItem: KnowledgeItem = {
    ...item,
    id,
    embedding,
    metadata: {
      ...item.metadata,
      timestamp: item.metadata.timestamp || new Date().toISOString(),
      usage_count: item.metadata.usage_count || 0,
    },
  };

  appendItem(fullItem);
  return id;
}

/**
 * Query the RAG for relevant knowledge
 */
export async function query(options: QueryOptions): Promise<QueryResult[]> {
  const {
    text,
    types,
    project,
    topK = 10,
    minScore = 0.5,
  } = options;

  const queryEmbedding = await generateEmbedding(text);
  const items = loadItems();

  let results: QueryResult[] = items.map(item => ({
    id: item.id,
    type: item.type,
    project: item.project,
    content: item.content,
    score: cosineSimilarity(queryEmbedding, item.embedding),
    metadata: item.metadata,
  }));

  // Filter by type
  if (types && types.length > 0) {
    results = results.filter(r => types.includes(r.type));
  }

  // Filter by project (include global items)
  if (project) {
    results = results.filter(r => r.project === project || r.project === '(global)');
  }

  // Filter by minimum score
  results = results.filter(r => r.score >= minScore);

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  // Limit to topK
  results = results.slice(0, topK);

  return results;
}

/**
 * Get a single item by ID
 */
export async function getById(id: string): Promise<KnowledgeItem | null> {
  const items = loadItems();
  let item = items.find(item => item.id === id);

  // Allow partial ID match (for convenience)
  if (!item && id.length >= 4) {
    item = items.find(item => item.id.startsWith(id));
  }

  return item || null;
}

/**
 * Delete a knowledge item
 */
export async function deleteItem(id: string): Promise<void> {
  const items = loadItems();
  const filtered = items.filter(item => !item.id.startsWith(id));

  if (filtered.length === items.length) {
    throw new Error(`Item with ID ${id} not found`);
  }

  saveItems(filtered);
}

/**
 * Clear all items for a project
 */
export async function clearProject(project: string): Promise<number> {
  const items = loadItems();
  const filtered = items.filter(item => item.project !== project);
  const deleted = items.length - filtered.length;
  saveItems(filtered);
  return deleted;
}

/**
 * Get all items for a project
 */
export function getProjectItems(project: string): KnowledgeItem[] {
  const items = loadItems();
  return items.filter(item => item.project === project);
}

/**
 * Invalidate the in-memory cache
 */
export function invalidateCache(): void {
  itemsCache = null;
}
