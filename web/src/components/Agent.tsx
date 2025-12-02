import { useState, useEffect, useRef, useCallback } from 'react';
import {
  api,
  subscribeToAgentStream,
  RepoConfig,
  AgentTemplate,
  AgentMode,
  AgentSessionStatus,
  AgentHistoryEntry,
  StreamEvent,
  StartAgentRequest,
} from '../apiClient';
import { useTheme } from '../context/ThemeContext';

const getStyles = (darkMode: boolean) => ({
  container: {
    maxWidth: '1600px',
    margin: '0 auto',
  },
  title: {
    fontSize: '1.5rem',
    marginBottom: '1.5rem',
    color: darkMode ? '#e0e0e0' : '#1a1a2e',
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '350px 1fr',
    gap: '1.5rem',
    minHeight: 'calc(100vh - 250px)',
  },
  sidebar: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '1rem',
  },
  section: {
    background: darkMode ? '#1a1a2e' : '#fff',
    borderRadius: '8px',
    padding: '1.25rem',
    boxShadow: darkMode ? '0 4px 12px rgba(0,0,0,0.4)' : '0 2px 4px rgba(0,0,0,0.1)',
  },
  sectionTitle: {
    fontSize: '0.95rem',
    fontWeight: 600,
    marginBottom: '0.75rem',
    color: darkMode ? '#e0e0e0' : '#1a1a2e',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  label: {
    display: 'block',
    fontSize: '0.85rem',
    fontWeight: 500,
    marginBottom: '0.3rem',
    color: darkMode ? '#9ca3af' : '#666',
  },
  select: {
    width: '100%',
    padding: '0.5rem',
    borderRadius: '4px',
    border: `1px solid ${darkMode ? '#374151' : '#ddd'}`,
    background: darkMode ? '#1f2937' : '#fff',
    color: darkMode ? '#e0e0e0' : '#333',
    fontSize: '0.9rem',
    marginBottom: '0.75rem',
  },
  textarea: {
    width: '100%',
    padding: '0.75rem',
    borderRadius: '4px',
    border: `1px solid ${darkMode ? '#374151' : '#ddd'}`,
    background: darkMode ? '#0f0f1a' : '#fff',
    color: darkMode ? '#e0e0e0' : '#333',
    fontFamily: 'inherit',
    fontSize: '0.9rem',
    resize: 'vertical' as const,
    minHeight: '120px',
  },
  button: {
    padding: '0.75rem 1.5rem',
    borderRadius: '4px',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 500,
    fontSize: '0.9rem',
    transition: 'all 0.2s',
  },
  primaryButton: {
    background: darkMode ? '#3b82f6' : '#2563eb',
    color: '#fff',
  },
  secondaryButton: {
    background: darkMode ? '#4b5563' : '#6b7280',
    color: '#fff',
  },
  dangerButton: {
    background: darkMode ? '#dc2626' : '#ef4444',
    color: '#fff',
  },
  templateCard: {
    padding: '0.75rem',
    borderRadius: '6px',
    border: `1px solid ${darkMode ? '#374151' : '#ddd'}`,
    cursor: 'pointer',
    transition: 'all 0.2s',
    marginBottom: '0.5rem',
  },
  templateCardActive: {
    borderColor: darkMode ? '#3b82f6' : '#2563eb',
    background: darkMode ? 'rgba(59,130,246,0.1)' : 'rgba(37,99,235,0.1)',
  },
  templateName: {
    fontWeight: 500,
    fontSize: '0.9rem',
    color: darkMode ? '#e0e0e0' : '#1a1a2e',
  },
  templateDesc: {
    fontSize: '0.8rem',
    color: darkMode ? '#9ca3af' : '#666',
    marginTop: '0.25rem',
  },
  checkbox: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.5rem',
    fontSize: '0.85rem',
    color: darkMode ? '#e0e0e0' : '#333',
    cursor: 'pointer',
  },
  streamContainer: {
    background: darkMode ? '#0f0f1a' : '#1a1a2e',
    borderRadius: '8px',
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  streamHeader: {
    padding: '0.75rem 1rem',
    borderBottom: `1px solid ${darkMode ? '#374151' : '#333'}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  streamStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.85rem',
  },
  statusDot: (state: string) => ({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background:
      state === 'running' ? '#facc15' :
      state === 'completed' ? '#4ade80' :
      state === 'failed' ? '#f87171' :
      state === 'cancelled' ? '#f97316' : '#6b7280',
    animation: state === 'running' ? 'pulse 1.5s infinite' : 'none',
  }),
  streamOutput: {
    flex: 1,
    padding: '1rem',
    overflow: 'auto',
    fontFamily: 'monospace',
    fontSize: '0.85rem',
    color: '#4ade80',
    whiteSpace: 'pre-wrap' as const,
    lineHeight: 1.6,
  },
  eventBlock: {
    marginBottom: '0.75rem',
    borderLeft: '2px solid',
    paddingLeft: '0.75rem',
  },
  eventHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.75rem',
    opacity: 0.7,
    marginBottom: '0.25rem',
  },
  historyItem: {
    padding: '0.5rem',
    borderRadius: '4px',
    border: `1px solid ${darkMode ? '#374151' : '#ddd'}`,
    marginBottom: '0.5rem',
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontSize: '0.85rem',
  },
  badge: (type: string) => ({
    display: 'inline-block',
    padding: '0.15rem 0.5rem',
    borderRadius: '999px',
    fontSize: '0.7rem',
    fontWeight: 500,
    background:
      type === 'branch' ? (darkMode ? '#1e40af' : '#dbeafe') :
      type === 'task' ? (darkMode ? '#166534' : '#dcfce7') :
      type === 'review' ? (darkMode ? '#9333ea' : '#f3e8ff') :
      type === 'refactor' ? (darkMode ? '#c2410c' : '#ffedd5') :
      type === 'project' ? (darkMode ? '#0e7490' : '#cffafe') :
      (darkMode ? '#374151' : '#e5e7eb'),
    color:
      type === 'branch' ? (darkMode ? '#93c5fd' : '#1d4ed8') :
      type === 'task' ? (darkMode ? '#86efac' : '#166534') :
      type === 'review' ? (darkMode ? '#d8b4fe' : '#7c3aed') :
      type === 'refactor' ? (darkMode ? '#fed7aa' : '#9a3412') :
      type === 'project' ? (darkMode ? '#67e8f9' : '#0e7490') :
      (darkMode ? '#9ca3af' : '#374151'),
  }),
  emptyState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: darkMode ? '#6b7280' : '#9ca3af',
    textAlign: 'center' as const,
    padding: '2rem',
  },
  emptyIcon: {
    fontSize: '3rem',
    marginBottom: '1rem',
    opacity: 0.5,
  },
});

const MODE_LABELS: Record<AgentMode, string> = {
  branch: 'Branch Work',
  project: 'New Project',
  task: 'Task',
  review: 'Code Review',
  refactor: 'Refactor',
};

const EVENT_COLORS: Record<string, string> = {
  text: '#4ade80',
  thinking: '#a78bfa',
  tool_use: '#fbbf24',
  tool_result: '#60a5fa',
  file_edit: '#f472b6',
  bash_command: '#22d3ee',
  bash_output: '#6ee7b7',
  subagent_spawn: '#fb923c',
  subagent_result: '#fdba74',
  error: '#f87171',
  warning: '#fde047',
  progress: '#94a3b8',
};

function Agent() {
  const { darkMode, toast } = useTheme();
  const styles = getStyles(darkMode);

  // State
  const [repos, setRepos] = useState<RepoConfig[]>([]);
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [history, setHistory] = useState<AgentHistoryEntry[]>([]);
  const [activeSessions, setActiveSessions] = useState<AgentSessionStatus[]>([]);

  const [selectedRepo, setSelectedRepo] = useState<string>('');
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [mode, setMode] = useState<AgentMode>('task');
  const [prompt, setPrompt] = useState<string>('');

  // Capabilities
  const [allowSubAgents, setAllowSubAgents] = useState(true);
  const [allowFileEdits, setAllowFileEdits] = useState(true);
  const [allowBash, setAllowBash] = useState(true);
  const [allowMcp, setAllowMcp] = useState(true);

  // Current session
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<string>('idle');
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const outputRef = useRef<HTMLDivElement>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Load initial data
  useEffect(() => {
    loadRepos();
    loadTemplates();
    loadHistory();
    loadActiveSessions();

    const interval = setInterval(() => {
      loadActiveSessions();
    }, 10000);

    return () => {
      clearInterval(interval);
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [events]);

  // Load branches when repo changes
  useEffect(() => {
    if (selectedRepo) {
      loadBranches(selectedRepo);
    } else {
      setBranches([]);
      setSelectedBranch('');
    }
  }, [selectedRepo]);

  // Update prompt when template changes
  useEffect(() => {
    if (selectedTemplate) {
      const template = templates.find((t) => t.id === selectedTemplate);
      if (template) {
        setPrompt(template.promptTemplate);
        setMode(template.mode);
        setAllowSubAgents(template.capabilities.allowSubAgents);
        setAllowFileEdits(template.capabilities.allowFileEdits);
        setAllowBash(template.capabilities.allowBash);
        setAllowMcp(template.capabilities.allowMcp);
      }
    }
  }, [selectedTemplate, templates]);

  async function loadRepos() {
    try {
      const data = await api.getRepos();
      setRepos(data);
    } catch (err) {
      toast.error('Failed to load repos');
    }
  }

  async function loadTemplates() {
    try {
      const data = await api.getAgentTemplates();
      setTemplates(data);
    } catch (err) {
      toast.error('Failed to load templates');
    }
  }

  async function loadHistory() {
    try {
      const data = await api.getAgentHistory(20);
      setHistory(data);
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  }

  async function loadActiveSessions() {
    try {
      const data = await api.listAgentSessions();
      setActiveSessions(data);
    } catch (err) {
      console.error('Failed to load active sessions:', err);
    }
  }

  async function loadBranches(repoFullName: string) {
    try {
      const data = await api.getGitHubBranches(repoFullName);
      setBranches(data.map((b) => b.name));
    } catch (err) {
      // Fallback - just use main
      setBranches(['main']);
    }
  }

  const handleStartAgent = useCallback(async () => {
    if (!prompt.trim()) {
      toast.warning('Please enter a prompt');
      return;
    }

    // Build request
    const request: StartAgentRequest = {
      mode,
      prompt,
      permissionPreset: 'custom',
      capabilities: {
        allowSubAgents,
        allowFileEdits,
        allowBash,
        allowMcp,
        allowGitOps: allowFileEdits,
        allowWebSearch: false,
        maxSubAgentDepth: 2,
        timeout: 600000,
      },
      allowSlashCommands: true,
    };

    if (selectedRepo) {
      request.repoFullName = selectedRepo;
    }
    if (selectedBranch) {
      request.branch = selectedBranch;
    }

    try {
      const response = await api.startAgent(request);
      setCurrentSessionId(response.sessionId);
      setSessionState('pending');
      setEvents([]);

      // Subscribe to stream
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }

      unsubscribeRef.current = subscribeToAgentStream(
        response.sessionId,
        {
          onConnected: () => {
            setIsConnected(true);
            setSessionState('running');
          },
          onEvent: (event) => {
            setEvents((prev) => [...prev, event]);
          },
          onProgress: (phase) => {
            setSessionState(`running: ${phase}`);
          },
          onSessionEnd: (success, summary, _filesModified, duration) => {
            setSessionState(success ? 'completed' : 'failed');
            setIsConnected(false);
            loadHistory();
            loadActiveSessions();
            toast.info(
              `Agent ${success ? 'completed' : 'failed'}: ${summary} (${Math.round(duration / 1000)}s)`
            );
          },
          onError: (message) => {
            toast.error(message);
          },
          onDisconnected: () => {
            setIsConnected(false);
          },
        },
        { catchUp: true }
      );

      toast.success('Agent started');
    } catch (err) {
      toast.error(`Failed to start agent: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [mode, prompt, selectedRepo, selectedBranch, allowSubAgents, allowFileEdits, allowBash, allowMcp, toast]);

  const handleCancelAgent = useCallback(async () => {
    if (!currentSessionId) return;

    try {
      await api.cancelAgentSession(currentSessionId, 'Cancelled by user');
      setSessionState('cancelled');
      toast.info('Agent cancelled');
    } catch (err) {
      toast.error('Failed to cancel agent');
    }
  }, [currentSessionId, toast]);

  const handleReconnect = useCallback(async (sessionId: string) => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
    }

    setCurrentSessionId(sessionId);
    setEvents([]);

    try {
      const status = await api.getAgentSession(sessionId);
      setSessionState(status.state);

      if (status.state === 'running' || status.state === 'pending') {
        unsubscribeRef.current = subscribeToAgentStream(
          sessionId,
          {
            onConnected: () => setIsConnected(true),
            onEvent: (event) => setEvents((prev) => [...prev, event]),
            onSessionEnd: () => {
              setIsConnected(false);
              loadHistory();
            },
            onDisconnected: () => setIsConnected(false),
          },
          { catchUp: true }
        );
      } else {
        // Load historical events
        const events = await api.getAgentEvents(sessionId);
        setEvents(events);
      }
    } catch (err) {
      toast.error('Failed to reconnect to session');
    }
  }, [toast]);

  const renderEvent = (event: StreamEvent, index: number) => {
    const color = EVENT_COLORS[event.type] || '#6b7280';
    const timestamp = new Date(event.timestamp).toLocaleTimeString();

    switch (event.type) {
      case 'text':
        return (
          <div key={index} style={{ ...styles.eventBlock, borderColor: color }}>
            <span style={{ color }}>{(event as any).content}</span>
          </div>
        );

      case 'thinking':
        return (
          <div key={index} style={{ ...styles.eventBlock, borderColor: color, opacity: 0.7 }}>
            <div style={styles.eventHeader}>
              <span style={{ color }}>Thinking...</span>
              <span>{timestamp}</span>
            </div>
            <span style={{ color, fontStyle: 'italic' }}>{(event as any).content}</span>
          </div>
        );

      case 'tool_use':
        return (
          <div key={index} style={{ ...styles.eventBlock, borderColor: color }}>
            <div style={styles.eventHeader}>
              <span style={{ color }}>Tool: {(event as any).toolName}</span>
              <span>{timestamp}</span>
            </div>
            <pre style={{ margin: 0, fontSize: '0.8rem', opacity: 0.8 }}>
              {JSON.stringify((event as any).input, null, 2)}
            </pre>
          </div>
        );

      case 'tool_result':
        return (
          <div key={index} style={{ ...styles.eventBlock, borderColor: color }}>
            <div style={styles.eventHeader}>
              <span style={{ color }}>
                Result: {(event as any).success ? 'Success' : 'Failed'}
              </span>
              <span>{timestamp}</span>
            </div>
          </div>
        );

      case 'file_edit':
        return (
          <div key={index} style={{ ...styles.eventBlock, borderColor: color }}>
            <div style={styles.eventHeader}>
              <span style={{ color }}>
                File {(event as any).action}: {(event as any).filePath}
              </span>
              <span>{timestamp}</span>
            </div>
            {(event as any).diff && (
              <pre style={{ margin: 0, fontSize: '0.75rem', opacity: 0.9 }}>
                {(event as any).diff}
              </pre>
            )}
          </div>
        );

      case 'bash_command':
        return (
          <div key={index} style={{ ...styles.eventBlock, borderColor: color }}>
            <div style={styles.eventHeader}>
              <span style={{ color }}>Bash Command</span>
              <span>{timestamp}</span>
            </div>
            <code style={{ color }}>{(event as any).command}</code>
          </div>
        );

      case 'bash_output':
        return (
          <div key={index} style={{ ...styles.eventBlock, borderColor: color }}>
            <span style={{ color: (event as any).isStderr ? '#f87171' : color }}>
              {(event as any).output}
            </span>
          </div>
        );

      case 'subagent_spawn':
        return (
          <div key={index} style={{ ...styles.eventBlock, borderColor: color }}>
            <div style={styles.eventHeader}>
              <span style={{ color }}>Sub-agent: {(event as any).description}</span>
              <span>{timestamp}</span>
            </div>
          </div>
        );

      case 'progress':
        return (
          <div key={index} style={{ ...styles.eventBlock, borderColor: color }}>
            <span style={{ color }}>
              [{(event as any).phase}] {(event as any).message}
            </span>
          </div>
        );

      case 'error':
        return (
          <div key={index} style={{ ...styles.eventBlock, borderColor: color }}>
            <span style={{ color }}>Error: {(event as any).message}</span>
          </div>
        );

      case 'warning':
        return (
          <div key={index} style={{ ...styles.eventBlock, borderColor: color }}>
            <span style={{ color }}>Warning: {(event as any).message}</span>
          </div>
        );

      case 'session_end':
        return (
          <div key={index} style={{ ...styles.eventBlock, borderColor: (event as any).success ? '#4ade80' : '#f87171' }}>
            <div style={styles.eventHeader}>
              <span style={{ color: (event as any).success ? '#4ade80' : '#f87171' }}>
                Session {(event as any).success ? 'Completed' : 'Failed'}
              </span>
              <span>{timestamp}</span>
            </div>
            <div>{(event as any).summary}</div>
            {(event as any).filesModified?.length > 0 && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                Files modified: {(event as any).filesModified.join(', ')}
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  const isRunning = sessionState === 'running' || sessionState === 'pending' || sessionState.startsWith('running:');

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>
        <span style={{ fontSize: '1.8rem' }}>🤖</span>
        Coding Agent
      </h2>

      <div style={styles.grid}>
        {/* Sidebar */}
        <div style={styles.sidebar}>
          {/* Templates */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Templates</h3>
            <div style={{ maxHeight: '200px', overflow: 'auto' }}>
              {templates.map((template) => (
                <div
                  key={template.id}
                  style={{
                    ...styles.templateCard,
                    ...(selectedTemplate === template.id ? styles.templateCardActive : {}),
                  }}
                  onClick={() => setSelectedTemplate(template.id)}
                >
                  <div style={styles.templateName}>{template.name}</div>
                  <div style={styles.templateDesc}>{template.description}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Configuration */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Configuration</h3>

            <label style={styles.label}>Repository (optional)</label>
            <select
              style={styles.select}
              value={selectedRepo}
              onChange={(e) => setSelectedRepo(e.target.value)}
            >
              <option value="">Working directory</option>
              {repos.map((repo) => (
                <option key={repo.repoFullName} value={repo.repoFullName}>
                  {repo.repoFullName}
                </option>
              ))}
            </select>

            {selectedRepo && branches.length > 0 && (
              <>
                <label style={styles.label}>Branch</label>
                <select
                  style={styles.select}
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                >
                  <option value="">Default branch</option>
                  {branches.map((branch) => (
                    <option key={branch} value={branch}>
                      {branch}
                    </option>
                  ))}
                </select>
              </>
            )}

            <label style={styles.label}>Mode</label>
            <select
              style={styles.select}
              value={mode}
              onChange={(e) => setMode(e.target.value as AgentMode)}
            >
              {Object.entries(MODE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* Capabilities */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Capabilities</h3>
            <label style={styles.checkbox}>
              <input
                type="checkbox"
                checked={allowSubAgents}
                onChange={(e) => setAllowSubAgents(e.target.checked)}
              />
              Allow Sub-agents
            </label>
            <label style={styles.checkbox}>
              <input
                type="checkbox"
                checked={allowFileEdits}
                onChange={(e) => setAllowFileEdits(e.target.checked)}
              />
              Allow File Edits
            </label>
            <label style={styles.checkbox}>
              <input
                type="checkbox"
                checked={allowBash}
                onChange={(e) => setAllowBash(e.target.checked)}
              />
              Allow Bash Commands
            </label>
            <label style={styles.checkbox}>
              <input
                type="checkbox"
                checked={allowMcp}
                onChange={(e) => setAllowMcp(e.target.checked)}
              />
              Allow MCP Servers
            </label>
          </div>

          {/* Active Sessions */}
          {activeSessions.length > 0 && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Active Sessions</h3>
              {activeSessions.map((session) => (
                <div
                  key={session.sessionId}
                  style={styles.historyItem}
                  onClick={() => handleReconnect(session.sessionId)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={styles.statusDot(session.state)} />
                    <span style={styles.badge(session.config.mode)}>
                      {MODE_LABELS[session.config.mode]}
                    </span>
                  </div>
                  <div style={{ marginTop: '0.25rem', fontSize: '0.8rem', opacity: 0.8 }}>
                    {session.config.repoFullName || 'Local'}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* History */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Recent Sessions</h3>
            <div style={{ maxHeight: '200px', overflow: 'auto' }}>
              {history.length === 0 ? (
                <div style={{ fontSize: '0.85rem', opacity: 0.6 }}>No recent sessions</div>
              ) : (
                history.slice(0, 10).map((entry) => (
                  <div
                    key={entry.sessionId}
                    style={styles.historyItem}
                    onClick={() => handleReconnect(entry.sessionId)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={styles.statusDot(entry.state)} />
                      <span style={styles.badge(entry.mode)}>{MODE_LABELS[entry.mode]}</span>
                      {entry.duration && (
                        <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>
                          {Math.round(entry.duration / 1000)}s
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        marginTop: '0.25rem',
                        fontSize: '0.8rem',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {entry.summary || entry.prompt.substring(0, 50)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Prompt Input */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Prompt</h3>
            <textarea
              style={styles.textarea}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe what you want the agent to do..."
              disabled={isRunning}
            />
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              {!isRunning ? (
                <button
                  style={{ ...styles.button, ...styles.primaryButton }}
                  onClick={handleStartAgent}
                >
                  Start Agent
                </button>
              ) : (
                <button
                  style={{ ...styles.button, ...styles.dangerButton }}
                  onClick={handleCancelAgent}
                >
                  Cancel
                </button>
              )}
              <button
                style={{ ...styles.button, ...styles.secondaryButton }}
                onClick={() => {
                  setPrompt('');
                  setSelectedTemplate('');
                }}
                disabled={isRunning}
              >
                Clear
              </button>
            </div>
          </div>

          {/* Stream Output */}
          <div style={styles.streamContainer}>
            <div style={styles.streamHeader}>
              <div style={styles.streamStatus}>
                <span style={styles.statusDot(sessionState)} />
                <span style={{ color: '#fff' }}>
                  {sessionState === 'idle' ? 'Ready' :
                   sessionState.startsWith('running') ? sessionState :
                   sessionState.charAt(0).toUpperCase() + sessionState.slice(1)}
                </span>
                {isConnected && (
                  <span style={{ fontSize: '0.75rem', color: '#4ade80' }}>Connected</span>
                )}
              </div>
              {events.length > 0 && (
                <span style={{ color: '#6b7280', fontSize: '0.8rem' }}>
                  {events.length} events
                </span>
              )}
            </div>

            <div ref={outputRef} style={styles.streamOutput}>
              {events.length === 0 ? (
                <div style={styles.emptyState}>
                  <div style={styles.emptyIcon}>🚀</div>
                  <div>Start an agent to see output here</div>
                  <div style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
                    Select a template or write a custom prompt
                  </div>
                </div>
              ) : (
                events.map((event, i) => renderEvent(event, i))
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

export default Agent;
