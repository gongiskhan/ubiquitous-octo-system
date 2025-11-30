/**
 * Base Agent Interface
 * All agents implement this interface for consistency
 */

import type { AgentContext, AgentResult } from './types.js';

/**
 * Agent interface - all agents must implement this
 */
export interface Agent {
  /** Unique name for the agent */
  name: string;

  /** Human-readable description */
  description: string;

  /** Execute the agent's task */
  execute(context: AgentContext, options?: Record<string, unknown>): Promise<AgentResult>;
}

/**
 * Agent registry - allows dynamic agent lookup
 */
const agentRegistry = new Map<string, Agent>();

/**
 * Register an agent
 */
export function registerAgent(agent: Agent): void {
  agentRegistry.set(agent.name, agent);
}

/**
 * Get an agent by name
 */
export function getAgent(name: string): Agent | undefined {
  return agentRegistry.get(name);
}

/**
 * List all registered agents
 */
export function listAgents(): Agent[] {
  return Array.from(agentRegistry.values());
}

/**
 * Base class for agents with shared functionality
 */
export abstract class BaseAgent implements Agent {
  abstract name: string;
  abstract description: string;

  abstract execute(
    context: AgentContext,
    options?: Record<string, unknown>
  ): Promise<AgentResult>;

  /**
   * Log agent activity
   */
  protected log(message: string): void {
    console.log(`[${this.name}] ${message}`);
  }

  /**
   * Create a successful result
   */
  protected success(summary: string, artifacts?: Record<string, unknown>): AgentResult {
    return { success: true, summary, artifacts };
  }

  /**
   * Create a failed result
   */
  protected failure(summary: string, artifacts?: Record<string, unknown>): AgentResult {
    return { success: false, summary, artifacts };
  }
}
