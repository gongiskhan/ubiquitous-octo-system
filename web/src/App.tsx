import { useState, useEffect } from 'react';
import { api, Status } from './apiClient';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { ToastContainer } from './components/Toast';
import Dashboard from './components/Dashboard';
import RepoSelector from './components/RepoSelector';
import LogsView from './components/LogsView';
import Settings from './components/Settings';
import Terminal from './components/Terminal';
import Agent from './components/Agent';

type Page = 'dashboard' | 'repos' | 'logs' | 'terminal' | 'agent' | 'settings';

const getStyles = (darkMode: boolean) => ({
  app: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column' as const,
    background: darkMode ? '#0f0f1a' : '#f5f5f5',
    color: darkMode ? '#e0e0e0' : '#1a1a2e',
    transition: 'background 0.3s, color 0.3s',
  },
  header: {
    background: darkMode ? '#1a1a2e' : '#1a1a2e',
    color: '#fff',
    padding: '1rem 2rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    margin: 0,
    fontSize: '1.5rem',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  statusBar: {
    display: 'flex',
    gap: '1rem',
    fontSize: '0.85rem',
    alignItems: 'center',
  },
  statusItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  statusDot: (active: boolean) => ({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: active ? '#4ade80' : '#f87171',
  }),
  nav: {
    background: darkMode ? '#12122a' : '#16213e',
    padding: '0 2rem',
    display: 'flex',
    gap: '0',
    justifyContent: 'space-between',
  },
  navLeft: {
    display: 'flex',
    gap: '0',
  },
  navButton: (active: boolean) => ({
    background: active ? (darkMode ? '#1f1f4a' : '#0f3460') : 'transparent',
    color: '#fff',
    border: 'none',
    padding: '0.75rem 1.5rem',
    cursor: 'pointer',
    fontSize: '0.9rem',
    borderBottom: active ? '2px solid #4ade80' : '2px solid transparent',
    transition: 'all 0.2s',
  }),
  darkModeToggle: {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.3)',
    color: '#fff',
    padding: '0.5rem 1rem',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.85rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    margin: '0.5rem 0',
  },
  main: {
    flex: 1,
    padding: '2rem',
    background: darkMode ? '#0f0f1a' : '#f5f5f5',
  },
  error: {
    background: darkMode ? '#450a0a' : '#fee2e2',
    color: darkMode ? '#fca5a5' : '#dc2626',
    padding: '1rem',
    borderRadius: '4px',
    marginBottom: '1rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  machineInfo: {
    fontSize: '0.75rem',
    opacity: 0.7,
    display: 'flex',
    gap: '1rem',
    alignItems: 'center',
  },
});

function AppContent() {
  const { darkMode, toggleDarkMode, toasts, removeToast } = useTheme();
  const [page, setPage] = useState<Page>('dashboard');
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  const styles = getStyles(darkMode);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  async function loadStatus() {
    try {
      const data = await api.getStatus();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load status');
    }
  }

  return (
    <div style={styles.app}>
      <ToastContainer toasts={toasts} onRemove={removeToast} darkMode={darkMode} />

      <header style={styles.header}>
        <h1 style={styles.title}>
          <span style={{ fontSize: '1.8rem' }}>⚡</span>
          BranchRunner
        </h1>
        <div style={styles.statusBar}>
          {status?.machine && (
            <div style={styles.machineInfo}>
              <span>{status.machine.hostname}</span>
              <span>CPU: {status.machine.cpuCount}x</span>
              <span>RAM: {status.machine.memoryUsagePercent}%</span>
            </div>
          )}
          <div style={styles.statusItem}>
            <div style={styles.statusDot(!!status?.tailscaleIp)} />
            <span>
              {status?.tailscaleIp ? status.tailscaleIp.split('.').slice(-2).join('.') : 'Offline'}
            </span>
          </div>
          <div style={styles.statusItem}>
            <div style={styles.statusDot(status?.queue?.isProcessing || false)} />
            <span>
              Q: {status?.queue?.queueLength || 0}
              {status?.queue?.isProcessing && ' ▶'}
            </span>
          </div>
          <div style={styles.statusItem}>
            <div style={styles.statusDot(status?.githubTokenSet || false)} />
            <span>GH</span>
          </div>
          <div style={styles.statusItem}>
            <div style={styles.statusDot(status?.slackConfigured || false)} />
            <span>Slack</span>
          </div>
        </div>
      </header>

      <nav style={styles.nav}>
        <div style={styles.navLeft}>
          <button
            style={styles.navButton(page === 'dashboard')}
            onClick={() => setPage('dashboard')}
          >
            Dashboard
          </button>
          <button
            style={styles.navButton(page === 'repos')}
            onClick={() => setPage('repos')}
          >
            Repos
          </button>
          <button
            style={styles.navButton(page === 'logs')}
            onClick={() => setPage('logs')}
          >
            Logs & History
          </button>
          <button
            style={styles.navButton(page === 'terminal')}
            onClick={() => setPage('terminal')}
          >
            Terminal
          </button>
          <button
            style={styles.navButton(page === 'agent')}
            onClick={() => setPage('agent')}
          >
            Agent
          </button>
          <button
            style={styles.navButton(page === 'settings')}
            onClick={() => setPage('settings')}
          >
            Settings
          </button>
        </div>
        <button style={styles.darkModeToggle} onClick={toggleDarkMode}>
          {darkMode ? '☀️ Light' : '🌙 Dark'}
        </button>
      </nav>

      <main style={styles.main}>
        {error && (
          <div style={styles.error}>
            <span>Error: {error}</span>
            <button
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '1.2rem',
                color: 'inherit',
              }}
              onClick={() => setError(null)}
            >
              ×
            </button>
          </div>
        )}

        {page === 'dashboard' && <Dashboard />}
        {page === 'repos' && <RepoSelector />}
        {page === 'logs' && <LogsView />}
        {page === 'terminal' && <Terminal />}
        {page === 'agent' && <Agent />}
        {page === 'settings' && <Settings status={status} onRefresh={loadStatus} />}
      </main>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

export default App;
