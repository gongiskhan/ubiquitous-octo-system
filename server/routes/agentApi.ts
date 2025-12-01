/**
 * Agent API Routes
 * REST and SSE endpoints for streaming agent management
 */

import { Router, Request, Response, NextFunction } from 'express';
import {
  streamingAgentManager,
  StartAgentRequest,
  StreamEvent,
  AgentTemplate,
  MCP_SERVER_TEMPLATES,
  DEFAULT_CAPABILITIES,
  SAFE_CAPABILITIES,
} from '../agents/streaming-agent.js';
import { info, error as logError } from '../logging/logger.js';

const router = Router();

// Async handler wrapper
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// ============ Agent Templates ============

// In-memory template storage (could be persisted later)
const agentTemplates: Map<string, AgentTemplate> = new Map();

// Initialize default templates
function initDefaultTemplates() {
  const defaultTemplates: AgentTemplate[] = [
    {
      id: 'code-review',
      name: 'Code Review',
      description: 'Review code for quality, bugs, security issues, and best practices',
      mode: 'review',
      promptTemplate: 'Please review the code in this repository. Focus on:\n1. Code quality and readability\n2. Potential bugs and edge cases\n3. Security vulnerabilities\n4. Performance issues\n5. Best practices and conventions\n\nProvide a detailed report with specific recommendations.',
      capabilities: { ...SAFE_CAPABILITIES, allowSubAgents: true, maxSubAgentDepth: 1 },
      mcpServers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'feature-implementation',
      name: 'Feature Implementation',
      description: 'Implement a new feature with tests and documentation',
      mode: 'branch',
      promptTemplate: 'Implement the following feature:\n\n${FEATURE_DESCRIPTION}\n\nRequirements:\n1. Write clean, well-documented code\n2. Add appropriate tests\n3. Follow existing code patterns\n4. Update relevant documentation',
      capabilities: { ...DEFAULT_CAPABILITIES },
      mcpServers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'bug-fix',
      name: 'Bug Fix',
      description: 'Investigate and fix a bug with regression tests',
      mode: 'task',
      promptTemplate: 'Fix the following bug:\n\n${BUG_DESCRIPTION}\n\nSteps:\n1. Reproduce and understand the bug\n2. Identify the root cause\n3. Implement the fix\n4. Add regression tests\n5. Verify the fix works',
      capabilities: { ...DEFAULT_CAPABILITIES },
      mcpServers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'refactor',
      name: 'Code Refactor',
      description: 'Refactor code for better structure and maintainability',
      mode: 'refactor',
      promptTemplate: 'Refactor the following code/module:\n\n${REFACTOR_TARGET}\n\nGoals:\n1. Improve code organization\n2. Reduce complexity\n3. Enhance readability\n4. Maintain all existing functionality\n5. Ensure tests still pass',
      capabilities: { ...DEFAULT_CAPABILITIES },
      mcpServers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'test-writing',
      name: 'Test Coverage',
      description: 'Add tests to improve code coverage',
      mode: 'task',
      promptTemplate: 'Add comprehensive tests for:\n\n${TEST_TARGET}\n\nRequirements:\n1. Unit tests for individual functions\n2. Integration tests where appropriate\n3. Edge case coverage\n4. Clear test descriptions\n5. Use existing test patterns',
      capabilities: { ...DEFAULT_CAPABILITIES, allowBash: true },
      mcpServers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'web-testing',
      name: 'Web App Testing',
      description: 'Test web application with browser automation',
      mode: 'task',
      promptTemplate: 'Test the web application at ${URL}:\n\n1. Navigate through main user flows\n2. Check for JavaScript errors\n3. Verify responsive design\n4. Test form submissions\n5. Check accessibility basics\n\nProvide a detailed test report.',
      capabilities: { ...SAFE_CAPABILITIES, allowMcp: true },
      mcpServers: ['playwright'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  for (const template of defaultTemplates) {
    agentTemplates.set(template.id, template);
  }
}

initDefaultTemplates();

// ============ Agent Session Endpoints ============

/**
 * Start a new agent session
 */
router.post('/start', asyncHandler(async (req: Request, res: Response) => {
  const request = req.body as StartAgentRequest;

  if (!request.prompt) {
    res.status(400).json({ error: 'Prompt is required' });
    return;
  }

  if (!request.mode) {
    request.mode = 'task';
  }

  try {
    const response = await streamingAgentManager.startSession(request);
    info(`Started agent session: ${response.sessionId}`, 'AgentAPI');
    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`Failed to start agent: ${message}`, 'AgentAPI');
    res.status(500).json({ error: message });
  }
}));

/**
 * Start agent from template
 */
router.post('/start-from-template/:templateId', asyncHandler(async (req: Request, res: Response) => {
  const { templateId } = req.params;
  const { variables, ...overrides } = req.body;

  const template = agentTemplates.get(templateId);
  if (!template) {
    res.status(404).json({ error: 'Template not found' });
    return;
  }

  // Substitute variables in prompt template
  let prompt = template.promptTemplate;
  if (variables) {
    for (const [key, value] of Object.entries(variables)) {
      prompt = prompt.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), String(value));
    }
  }

  const request: StartAgentRequest = {
    mode: template.mode,
    prompt,
    systemPrompt: template.systemPrompt,
    capabilities: template.capabilities,
    mcpServers: template.mcpServers,
    ...overrides,
  };

  try {
    const response = await streamingAgentManager.startSession(request);
    info(`Started agent session from template ${templateId}: ${response.sessionId}`, 'AgentAPI');
    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`Failed to start agent from template: ${message}`, 'AgentAPI');
    res.status(500).json({ error: message });
  }
}));

/**
 * Stream agent events via SSE
 */
router.get('/stream/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { catchUp } = req.query;

  const status = streamingAgentManager.getSessionStatus(sessionId);
  if (!status) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Send initial connection event
  res.write(`event: connected\ndata: ${JSON.stringify({ sessionId, state: status.state })}\n\n`);

  // Send catch-up events if requested
  if (catchUp === 'true') {
    const existingEvents = streamingAgentManager.getSessionEvents(sessionId);
    for (const event of existingEvents) {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
  }

  // Subscribe to new events
  let isConnected = true;
  const unsubscribe = streamingAgentManager.subscribeToSession(sessionId, (event: StreamEvent) => {
    if (isConnected) {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);

      // End stream on session end
      if (event.type === 'session_end') {
        res.write('event: close\ndata: {}\n\n');
        res.end();
        isConnected = false;
      }
    }
  });

  // Handle client disconnect
  req.on('close', () => {
    isConnected = false;
    unsubscribe();
    info(`SSE client disconnected from session ${sessionId}`, 'AgentAPI');
  });

  // Keep connection alive with heartbeats
  const heartbeat = setInterval(() => {
    if (isConnected) {
      res.write(': heartbeat\n\n');
    } else {
      clearInterval(heartbeat);
    }
  }, 30000);

  info(`SSE client connected to session ${sessionId}`, 'AgentAPI');
});

/**
 * Get session status
 */
router.get('/session/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params;

  const status = streamingAgentManager.getSessionStatus(sessionId);
  if (!status) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  res.json(status);
});

/**
 * Get session events
 */
router.get('/session/:sessionId/events', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { after } = req.query;

  const events = streamingAgentManager.getSessionEvents(
    sessionId,
    after ? parseInt(String(after), 10) : undefined
  );

  res.json(events);
});

/**
 * Cancel a session
 */
router.post('/session/:sessionId/cancel', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { reason } = req.body;

  const cancelled = streamingAgentManager.cancelSession(sessionId, reason);

  if (!cancelled) {
    res.status(400).json({ error: 'Session not found or not running' });
    return;
  }

  info(`Cancelled agent session ${sessionId}`, 'AgentAPI');
  res.json({ success: true, message: 'Session cancelled' });
});

/**
 * List active sessions
 */
router.get('/sessions', (_req: Request, res: Response) => {
  const sessions = streamingAgentManager.listActiveSessions();
  res.json(sessions);
});

/**
 * Get session history
 */
router.get('/history', (req: Request, res: Response) => {
  const { limit } = req.query;
  const history = streamingAgentManager.getHistory(
    limit ? parseInt(String(limit), 10) : undefined
  );
  res.json(history);
});

// ============ Template Endpoints ============

/**
 * List all templates
 */
router.get('/templates', (_req: Request, res: Response) => {
  const templates = Array.from(agentTemplates.values());
  res.json(templates);
});

/**
 * Get a template by ID
 */
router.get('/templates/:templateId', (req: Request, res: Response) => {
  const { templateId } = req.params;
  const template = agentTemplates.get(templateId);

  if (!template) {
    res.status(404).json({ error: 'Template not found' });
    return;
  }

  res.json(template);
});

/**
 * Create a new template
 */
router.post('/templates', (req: Request, res: Response) => {
  const template = req.body as Omit<AgentTemplate, 'id' | 'createdAt' | 'updatedAt'>;

  if (!template.name || !template.promptTemplate || !template.mode) {
    res.status(400).json({ error: 'Missing required fields: name, promptTemplate, mode' });
    return;
  }

  const id = template.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const now = new Date().toISOString();

  const newTemplate: AgentTemplate = {
    ...template,
    id,
    capabilities: template.capabilities || DEFAULT_CAPABILITIES,
    mcpServers: template.mcpServers || [],
    createdAt: now,
    updatedAt: now,
  };

  agentTemplates.set(id, newTemplate);

  res.json(newTemplate);
});

/**
 * Update a template
 */
router.patch('/templates/:templateId', (req: Request, res: Response) => {
  const { templateId } = req.params;
  const updates = req.body;

  const template = agentTemplates.get(templateId);
  if (!template) {
    res.status(404).json({ error: 'Template not found' });
    return;
  }

  const updatedTemplate: AgentTemplate = {
    ...template,
    ...updates,
    id: templateId, // Prevent ID change
    updatedAt: new Date().toISOString(),
  };

  agentTemplates.set(templateId, updatedTemplate);

  res.json(updatedTemplate);
});

/**
 * Delete a template
 */
router.delete('/templates/:templateId', (req: Request, res: Response) => {
  const { templateId } = req.params;

  if (!agentTemplates.has(templateId)) {
    res.status(404).json({ error: 'Template not found' });
    return;
  }

  agentTemplates.delete(templateId);

  res.json({ success: true });
});

// ============ Configuration Endpoints ============

/**
 * Get available MCP servers
 */
router.get('/mcp-servers', (_req: Request, res: Response) => {
  const servers = Object.entries(MCP_SERVER_TEMPLATES).map(([key, value]) => ({
    id: key,
    ...value,
  }));
  res.json(servers);
});

/**
 * Get capability presets
 */
router.get('/capability-presets', (_req: Request, res: Response) => {
  res.json({
    full: DEFAULT_CAPABILITIES,
    safe: SAFE_CAPABILITIES,
  });
});

/**
 * Cleanup old sessions
 */
router.post('/cleanup', (req: Request, res: Response) => {
  const { maxAge } = req.body;
  const cleaned = streamingAgentManager.cleanupSessions(maxAge);

  res.json({ success: true, cleanedSessions: cleaned });
});

export default router;
