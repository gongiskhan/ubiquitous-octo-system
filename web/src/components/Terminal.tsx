import { useState, useEffect, useRef, useMemo } from 'react';
import { api, RepoConfig, SavedCommand } from '../apiClient';
import { useTheme } from '../context/ThemeContext';

// ANSI color code to CSS color mapping
const ansiColors: Record<number, string> = {
  30: '#000000', 31: '#cd0000', 32: '#00cd00', 33: '#cdcd00',
  34: '#0000ee', 35: '#cd00cd', 36: '#00cdcd', 37: '#e5e5e5',
  90: '#7f7f7f', 91: '#ff0000', 92: '#00ff00', 93: '#ffff00',
  94: '#5c5cff', 95: '#ff00ff', 96: '#00ffff', 97: '#ffffff',
};

const ansiBgColors: Record<number, string> = {
  40: '#000000', 41: '#cd0000', 42: '#00cd00', 43: '#cdcd00',
  44: '#0000ee', 45: '#cd00cd', 46: '#00cdcd', 47: '#e5e5e5',
  100: '#7f7f7f', 101: '#ff0000', 102: '#00ff00', 103: '#ffff00',
  104: '#5c5cff', 105: '#ff00ff', 106: '#00ffff', 107: '#ffffff',
};

function parseAnsi(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Match ANSI escape sequences
  const regex = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let match;
  let currentStyle: React.CSSProperties = {};
  let keyIndex = 0;

  while ((match = regex.exec(text)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      const textPart = text.slice(lastIndex, match.index);
      if (Object.keys(currentStyle).length > 0) {
        parts.push(<span key={keyIndex++} style={currentStyle}>{textPart}</span>);
      } else {
        parts.push(textPart);
      }
    }

    // Parse the codes
    const codes = match[1].split(';').map(Number);
    for (const code of codes) {
      if (code === 0) {
        currentStyle = {};
      } else if (code === 1) {
        currentStyle = { ...currentStyle, fontWeight: 'bold' };
      } else if (code === 2) {
        currentStyle = { ...currentStyle, opacity: 0.7 };
      } else if (code === 3) {
        currentStyle = { ...currentStyle, fontStyle: 'italic' };
      } else if (code === 4) {
        currentStyle = { ...currentStyle, textDecoration: 'underline' };
      } else if (code === 9) {
        currentStyle = { ...currentStyle, textDecoration: 'line-through' };
      } else if (ansiColors[code]) {
        currentStyle = { ...currentStyle, color: ansiColors[code] };
      } else if (ansiBgColors[code]) {
        currentStyle = { ...currentStyle, backgroundColor: ansiBgColors[code] };
      } else if (code === 39) {
        const { color, ...rest } = currentStyle;
        currentStyle = rest;
      } else if (code === 49) {
        const { backgroundColor, ...rest } = currentStyle;
        currentStyle = rest;
      }
    }

    lastIndex = regex.lastIndex;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    const textPart = text.slice(lastIndex);
    if (Object.keys(currentStyle).length > 0) {
      parts.push(<span key={keyIndex++} style={currentStyle}>{textPart}</span>);
    } else {
      parts.push(textPart);
    }
  }

  return parts.length > 0 ? parts : [text];
}

const getStyles = (darkMode: boolean) => ({
  container: {
    maxWidth: '1400px',
  },
  title: {
    fontSize: '1.5rem',
    marginBottom: '1.5rem',
    color: darkMode ? '#e0e0e0' : '#1a1a2e',
  },
  section: {
    background: darkMode ? '#1a1a2e' : '#fff',
    borderRadius: '8px',
    padding: '1.5rem',
    marginBottom: '1.5rem',
    boxShadow: darkMode ? '0 4px 12px rgba(0,0,0,0.4)' : '0 2px 4px rgba(0,0,0,0.1)',
  },
  sectionTitle: {
    fontSize: '1.1rem',
    fontWeight: 600,
    marginBottom: '1rem',
    color: darkMode ? '#e0e0e0' : '#1a1a2e',
  },
  select: {
    padding: '0.5rem',
    borderRadius: '4px',
    border: `1px solid ${darkMode ? '#374151' : '#ddd'}`,
    background: darkMode ? '#1f2937' : '#fff',
    color: darkMode ? '#e0e0e0' : '#333',
    minWidth: '200px',
    marginRight: '1rem',
  },
  inputRow: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '1rem',
  },
  input: {
    flex: 1,
    padding: '0.75rem',
    borderRadius: '4px',
    border: `1px solid ${darkMode ? '#374151' : '#ddd'}`,
    background: darkMode ? '#0f0f1a' : '#fff',
    color: darkMode ? '#e0e0e0' : '#333',
    fontFamily: 'monospace',
    fontSize: '0.9rem',
  },
  button: {
    padding: '0.75rem 1.5rem',
    borderRadius: '4px',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 500,
    background: darkMode ? '#3b82f6' : '#2563eb',
    color: '#fff',
  },
  buttonSecondary: {
    padding: '0.75rem 1.5rem',
    borderRadius: '4px',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 500,
    background: darkMode ? '#4b5563' : '#6b7280',
    color: '#fff',
  },
  buttonDanger: {
    padding: '0.5rem 1rem',
    borderRadius: '4px',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 500,
    background: darkMode ? '#dc2626' : '#ef4444',
    color: '#fff',
    fontSize: '0.8rem',
  },
  terminalOutput: {
    background: darkMode ? '#0f0f1a' : '#1a1a2e',
    color: '#4ade80',
    padding: '1rem',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: '0.85rem',
    whiteSpace: 'pre-wrap' as const,
    overflow: 'auto',
    maxHeight: 'calc(100vh - 500px)',
    minHeight: '300px',
  },
  statusBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.5rem',
    fontSize: '0.85rem',
    color: darkMode ? '#9ca3af' : '#666',
  },
  statusDot: (status: 'running' | 'completed' | 'error' | 'idle') => ({
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    display: 'inline-block',
    marginRight: '0.5rem',
    background: status === 'running' ? '#facc15' :
                status === 'completed' ? '#4ade80' :
                status === 'error' ? '#f87171' : '#6b7280',
  }),
  savedCommandsGrid: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '0.5rem',
    marginTop: '1rem',
  },
  savedCommandButton: {
    padding: '0.5rem 1rem',
    borderRadius: '4px',
    border: `1px solid ${darkMode ? '#374151' : '#ddd'}`,
    background: darkMode ? '#1f2937' : '#f5f5f5',
    color: darkMode ? '#e0e0e0' : '#333',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontFamily: 'monospace',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    transition: 'all 0.2s',
  },
  deleteButton: {
    background: 'none',
    border: 'none',
    color: darkMode ? '#9ca3af' : '#666',
    cursor: 'pointer',
    padding: '0 0.25rem',
    fontSize: '1rem',
    opacity: 0.7,
  },
});

function Terminal() {
  const { darkMode, toast } = useTheme();
  const styles = getStyles(darkMode);

  const [repos, setRepos] = useState<RepoConfig[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string>('');
  const [command, setCommand] = useState<string>('');
  const [output, setOutput] = useState<string>('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'error'>('idle');
  const [savedCommands, setSavedCommands] = useState<SavedCommand[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);

  const outputRef = useRef<HTMLPreElement>(null);
  const pollIntervalRef = useRef<number | null>(null);

  // Memoize parsed ANSI output
  const parsedOutput = useMemo(() => parseAnsi(output), [output]);

  useEffect(() => {
    loadRepos();
    loadSavedCommands();

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output, autoScroll]);

  async function loadRepos() {
    try {
      const data = await api.getRepos();
      setRepos(data);
    } catch (err) {
      toast.error('Failed to load repos');
    }
  }

  async function loadSavedCommands() {
    try {
      const commands = await api.getSavedCommands();
      setSavedCommands(commands);
    } catch (err) {
      toast.error('Failed to load saved commands');
    }
  }

  async function executeCommand(cmd: string = command) {
    if (!cmd.trim()) {
      toast.warning('Please enter a command');
      return;
    }

    try {
      setStatus('running');
      setOutput('');

      const result = await api.executeCommand(cmd, selectedRepo || undefined);
      setSessionId(result.sessionId);

      // Poll for output
      pollIntervalRef.current = window.setInterval(async () => {
        try {
          const session = await api.getTerminalSession(result.sessionId);
          setOutput(session.output);

          if (session.status !== 'running') {
            setStatus(session.status);
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
          }
        } catch (err) {
          console.error('Failed to poll session:', err);
        }
      }, 500);
    } catch (err) {
      setStatus('error');
      setOutput(`Error: ${err instanceof Error ? err.message : 'Failed to execute command'}`);
      toast.error('Failed to execute command');
    }
  }

  async function killSession() {
    if (!sessionId) return;

    try {
      await api.killTerminalSession(sessionId);
      setStatus('completed');
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      toast.info('Process killed');
    } catch (err) {
      toast.error('Failed to kill process');
    }
  }

  async function runAndSave() {
    if (!command.trim()) {
      toast.warning('Please enter a command');
      return;
    }

    try {
      await api.addSavedCommand(command);
      await loadSavedCommands();
      toast.success('Command saved');
      executeCommand();
    } catch (err) {
      toast.error('Failed to save command');
    }
  }

  async function deleteSavedCommand(id: string) {
    try {
      await api.deleteSavedCommand(id);
      await loadSavedCommands();
      toast.success('Command deleted');
    } catch (err) {
      toast.error('Failed to delete command');
    }
  }

  function runSavedCommand(cmd: string) {
    setCommand(cmd);
    executeCommand(cmd);
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Terminal</h2>

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Execute Command</h3>

        <div style={{ marginBottom: '1rem' }}>
          <select
            style={styles.select}
            value={selectedRepo}
            onChange={(e) => setSelectedRepo(e.target.value)}
          >
            <option value="">Base directory (default)</option>
            {repos.map((repo) => (
              <option key={repo.repoFullName} value={repo.repoFullName}>
                {repo.repoFullName}
              </option>
            ))}
          </select>
          <span style={{ fontSize: '0.85rem', color: darkMode ? '#9ca3af' : '#666' }}>
            Working directory: {selectedRepo ? repos.find(r => r.repoFullName === selectedRepo)?.localPath : 'Clone base dir'}
          </span>
        </div>

        <div style={styles.inputRow}>
          <input
            style={styles.input}
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="Enter command (e.g., npm run build, git status)"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                executeCommand();
              }
            }}
          />
          <button
            style={styles.button}
            onClick={() => executeCommand()}
            disabled={status === 'running'}
          >
            Run
          </button>
          <button
            style={styles.buttonSecondary}
            onClick={runAndSave}
            disabled={status === 'running'}
          >
            Run & Save
          </button>
          {status === 'running' && (
            <button style={styles.buttonDanger} onClick={killSession}>
              Kill
            </button>
          )}
        </div>

        <div style={styles.statusBar}>
          <div>
            <span style={styles.statusDot(status)} />
            <span>
              {status === 'idle' ? 'Ready' :
               status === 'running' ? 'Running...' :
               status === 'completed' ? 'Completed' : 'Error'}
            </span>
          </div>
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            style={{
              padding: '0.3rem 0.6rem',
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '0.75rem',
              background: autoScroll ? (darkMode ? '#3b82f6' : '#2563eb') : (darkMode ? '#374151' : '#e5e5e5'),
              color: autoScroll ? '#fff' : (darkMode ? '#9ca3af' : '#666'),
            }}
          >
            {autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
          </button>
        </div>

        <pre
          ref={outputRef}
          style={styles.terminalOutput}
          onScroll={(e) => {
            const target = e.target as HTMLPreElement;
            const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 50;
            if (!isAtBottom && autoScroll) {
              setAutoScroll(false);
            }
          }}
        >
          {output ? parsedOutput : 'Output will appear here...'}
        </pre>
      </div>

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Saved Commands</h3>

        {savedCommands.length === 0 ? (
          <p style={{ color: darkMode ? '#6b7280' : '#666', fontStyle: 'italic' }}>
            No saved commands yet. Use "Run & Save" to save frequently used commands.
          </p>
        ) : (
          <div style={styles.savedCommandsGrid}>
            {savedCommands.map((cmd) => (
              <div
                key={cmd.id}
                style={styles.savedCommandButton}
                onClick={() => runSavedCommand(cmd.command)}
              >
                <span>{cmd.command}</span>
                <button
                  style={styles.deleteButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSavedCommand(cmd.id);
                  }}
                  title="Delete command"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Terminal;
