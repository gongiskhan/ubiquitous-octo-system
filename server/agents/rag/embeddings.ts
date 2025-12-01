/**
 * Embeddings Generator using @xenova/transformers
 * Provides local vector embeddings for similarity search
 */

import { pipeline, env } from '@xenova/transformers';
import os from 'os';
import { join } from 'path';

// Configure transformers to cache models locally
env.cacheDir = join(os.homedir(), '.branchrunner', 'rag', 'models');

// Lazy-loaded embedding model
let embedder: ReturnType<typeof pipeline> extends Promise<infer T> ? T : never;
let modelLoading = false;
let modelLoadPromise: Promise<void> | null = null;

// Model configuration
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIMENSION = 384;

/**
 * Initialize the embedding model (lazy loading)
 */
async function initializeModel(): Promise<typeof embedder> {
  if (embedder) {
    return embedder;
  }

  if (modelLoading && modelLoadPromise) {
    await modelLoadPromise;
    return embedder;
  }

  modelLoading = true;
  modelLoadPromise = (async () => {
    console.log('[RAG] Loading embedding model (first time may take a moment)...');
    embedder = await pipeline('feature-extraction', MODEL_NAME);
    console.log('[RAG] Embedding model loaded');
  })();

  await modelLoadPromise;
  modelLoading = false;
  return embedder;
}

/**
 * Generate embedding vector for given text
 * @param text - Text to embed
 * @returns 384-dimensional embedding vector
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error('Cannot generate embedding for empty text');
  }

  const model = await initializeModel();

  // Generate embedding with mean pooling and normalization
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const output = await (model as any)(text, {
    pooling: 'mean',
    normalize: true,
  });

  // Convert to plain number array - output is a Tensor with .data property
  const embedding = Array.from(output.data as Float32Array) as number[];

  if (embedding.length !== EMBEDDING_DIMENSION) {
    throw new Error(
      `Expected ${EMBEDDING_DIMENSION} dimensions, got ${embedding.length}`
    );
  }

  return embedding;
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(vec1: number[], vec2: number[]): number {
  if (vec1.length !== vec2.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }

  const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);

  if (magnitude === 0) {
    return 0;
  }

  return dotProduct / magnitude;
}

/**
 * Get the embedding dimension
 */
export function getEmbeddingDimension(): number {
  return EMBEDDING_DIMENSION;
}
