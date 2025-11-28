import { useState, useEffect } from 'react';
import { api, Status } from './apiClient';
import Dashboard from './components/Dashboard';
import RepoSelector from './components/RepoSelector';
import LogsView from './components/LogsView';
import Settings from './components/Settings';

type Page = 'dashboard' | 'repos' | 'logs' | 'settings';

const styles = {
  app: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  header: {
    background: '#1a1a2e',
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
  },
  statusBar: {
    display: 'flex',
    gap: '1rem',
    fontSize: '0.85rem',
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
    background: '#16213e',
    padding: '0 2rem',
    display: 'flex',
    gap: '0',
  },
  navButton: (active: boolean) => ({
    background: active ? '#0f3460' : 'transparent',
    color: '#fff',
    border: 'none',
    padding: '0.75rem 1.5rem',
    cursor: 'pointer',
    fontSize: '0.9rem',
    borderBottom: active ? '2px solid #4ade80' : '2px solid transparent',
    transition: 'all 0.2s',
  }),
  main: {
    flex: 1,
    padding: '2rem',
    background: '#f5f5f5',
  },
};

function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <header style={styles.header}>
        <h1 style={styles.title}>BranchRunner</h1>
        <div style={styles.statusBar}>
          <div style={styles.statusItem}>
            <div style={styles.statusDot(!!status?.tailscaleIp)} />
            <span>
              Tailscale: {status?.tailscaleIp || 'Not connected'}
            </span>
          </div>
          <div style={styles.statusItem}>
            <div style={styles.statusDot(status?.queue?.isProcessing || false)} />
            <span>
              Queue: {status?.queue?.queueLength || 0} jobs
              {status?.queue?.isProcessing && ' (running)'}
            </span>
          </div>
          <div style={styles.statusItem}>
            <div style={styles.statusDot(status?.githubTokenSet || false)} />
            <span>GitHub</span>
          </div>
          <div style={styles.statusItem}>
            <div style={styles.statusDot(status?.slackConfigured || false)} />
            <span>Slack</span>
          </div>
        </div>
      </header>

      <nav style={styles.nav}>
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
          Logs
        </button>
        <button
          style={styles.navButton(page === 'settings')}
          onClick={() => setPage('settings')}
        >
          Settings
        </button>
      </nav>

      <main style={styles.main}>
        {error && (
          <div style={{ background: '#fee2e2', color: '#dc2626', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
            Error: {error}
          </div>
        )}

        {page === 'dashboard' && <Dashboard />}
        {page === 'repos' && <RepoSelector />}
        {page === 'logs' && <LogsView />}
        {page === 'settings' && <Settings status={status} onRefresh={loadStatus} />}
      </main>
    </div>
  );
}

export default App;
