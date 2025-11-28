import { info, warn, error as logError } from '../logging/logger.js';
import { executeJob } from './runner.js';

export interface BuildJob {
  repoFullName: string;
  branch: string;
  queuedAt: string;
  trigger: 'webhook' | 'manual';
  commitMessage?: string;
  commitAuthor?: string;
}

interface QueueState {
  jobs: BuildJob[];
  isProcessing: boolean;
  currentJob: BuildJob | null;
}

const state: QueueState = {
  jobs: [],
  isProcessing: false,
  currentJob: null,
};

export function enqueue(job: BuildJob): void {
  // Check if same repo/branch is already in queue
  const existingIndex = state.jobs.findIndex(
    (j) => j.repoFullName === job.repoFullName && j.branch === job.branch
  );

  if (existingIndex >= 0) {
    // Replace existing job with newer one
    info(
      `Replacing existing queued job for ${job.repoFullName}/${job.branch}`,
      'Queue'
    );
    state.jobs[existingIndex] = job;
  } else {
    state.jobs.push(job);
    info(
      `Enqueued job for ${job.repoFullName}/${job.branch}, queue length: ${state.jobs.length}`,
      'Queue'
    );
  }

  // Start processing if not already running
  processQueue();
}

async function processQueue(): Promise<void> {
  if (state.isProcessing) {
    return;
  }

  if (state.jobs.length === 0) {
    return;
  }

  state.isProcessing = true;

  while (state.jobs.length > 0) {
    const job = state.jobs.shift()!;
    state.currentJob = job;

    info(
      `Processing job for ${job.repoFullName}/${job.branch}, remaining: ${state.jobs.length}`,
      'Queue'
    );

    try {
      await executeJob(job);
      info(`Completed job for ${job.repoFullName}/${job.branch}`, 'Queue');
    } catch (error) {
      logError(
        `Job failed for ${job.repoFullName}/${job.branch}: ${error}`,
        'Queue'
      );
    }

    state.currentJob = null;
  }

  state.isProcessing = false;
  info('Queue empty, stopping processor', 'Queue');
}

export function getQueueLength(): number {
  return state.jobs.length;
}

export function getCurrentJob(): BuildJob | null {
  return state.currentJob;
}

export function isProcessing(): boolean {
  return state.isProcessing;
}

export function getQueuedJobs(): BuildJob[] {
  return [...state.jobs];
}

export function clearQueue(): void {
  const count = state.jobs.length;
  state.jobs = [];
  warn(`Cleared ${count} jobs from queue`, 'Queue');
}

export function removeFromQueue(repoFullName: string, branch: string): boolean {
  const index = state.jobs.findIndex(
    (j) => j.repoFullName === repoFullName && j.branch === branch
  );

  if (index >= 0) {
    state.jobs.splice(index, 1);
    info(`Removed ${repoFullName}/${branch} from queue`, 'Queue');
    return true;
  }

  return false;
}

export function getQueueStatus(): {
  queueLength: number;
  isProcessing: boolean;
  currentJob: BuildJob | null;
  queuedJobs: BuildJob[];
} {
  return {
    queueLength: state.jobs.length,
    isProcessing: state.isProcessing,
    currentJob: state.currentJob,
    queuedJobs: getQueuedJobs(),
  };
}
