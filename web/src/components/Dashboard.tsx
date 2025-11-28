import { useState, useEffect, useCallback } from 'react';
import { api, RepoConfig, getScreenshotUrl, Status } from '../apiClient';

const AUTO_REFRESH_INTERVAL = 5000; // 5 seconds

const styles = {
  container: {
    maxWidth: '1200px',
  },
  title: {
    fontSize: '1.5rem',
    marginBottom: '1.5rem',
    color: '#1a1a2e',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
    gap: '1.5rem',
  },
  card: {
    background: '#fff',
    borderRadius: '8px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    overflow: 'hidden',
  },
  cardHeader: {
    padding: '1rem',
    borderBottom: '1px solid #eee',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  repoName: {
    fontWeight: 600,
    fontSize: '1.1rem',
    color: '#1a1a2e',
  },
  badge: (status: string) => ({
    padding: '0.25rem 0.5rem',
    borderRadius: '4px',
    fontSize: '0.75rem',
    fontWeight: 500,
    background: status === 'success' ? '#dcfce7' : status === 'failure' ? '#fee2e2' : '#fef3c7',
    color: status === 'success' ? '#166534' : status === 'failure' ? '#dc2626' : '#92400e',
  }),
  cardBody: {
    padding: '1rem',
  },
  screenshot: {
    width: '100%',
    height: '180px',
    objectFit: 'cover' as const,
    background: '#f5f5f5',
    borderRadius: '4px',
    marginBottom: '1rem',
  },
  noScreenshot: {
    width: '100%',
    height: '180px',
    background: '#f5f5f5',
    borderRadius: '4px',
    marginBottom: '1rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#999',
  },
  info: {
    fontSize: '0.85rem',
    color: '#666',
    marginBottom: '0.5rem',
  },
  cardFooter: {
    padding: '1rem',
    borderTop: '1px solid #eee',
    display: 'flex',
    gap: '0.5rem',
  },
  button: {
    padding: '0.5rem 1rem',
    borderRadius: '4px',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 500,
  },
  primaryButton: {
    background: '#1a1a2e',
    color: '#fff',
  },
  secondaryButton: {
    background: '#e5e5e5',
    color: '#333',
  },
  toggle: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginLeft: 'auto',
  },
  empty: {
    textAlign: 'center' as const,
    padding: '3rem',
    color: '#666',
  },
  loading: {
    textAlign: 'center' as const,
    padding: '2rem',
    color: '#666',
  },
};

function Dashboard() {
  const [repos, setRepos] = useState<RepoConfig[]>([]);
  const [queueStatus, setQueueStatus] = useState<Status['queue'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triggeringRepo, setTriggeringRepo] = useState<string | null>(null);

  const loadRepos = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      else setRefreshing(true);

      const [reposData, statusData] = await Promise.all([
        api.getRepos(),
        api.getQueue()
      ]);

      setRepos(reposData);
      setQueueStatus(statusData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load repos');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadRepos();

    // Auto-refresh when queue is processing
    const interval = setInterval(() => {
      loadRepos(false);
    }, AUTO_REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [loadRepos]);

  async function toggleEnabled(repo: RepoConfig) {
    try {
      await api.updateRepo(repo.repoFullName, { enabled: !repo.enabled });
      loadRepos(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update repo');
    }
  }

  async function runMain(repo: RepoConfig) {
    try {
      setTriggeringRepo(repo.repoFullName);
      await api.triggerRun(repo.repoFullName, 'main');
      // Reload immediately to see the queued status
      await loadRepos(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger run');
    } finally {
      setTriggeringRepo(null);
    }
  }

  function getLatestRun(repo: RepoConfig) {
    if (!repo.lastRuns || repo.lastRuns.length === 0) return null;
    return repo.lastRuns[0];
  }

  function isRepoInQueue(repoFullName: string): boolean {
    if (!queueStatus) return false;
    if (queueStatus.currentJob?.repoFullName === repoFullName) return true;
    return queueStatus.queuedJobs.some(j => j.repoFullName === repoFullName);
  }

  function isRepoRunning(repoFullName: string): boolean {
    return queueStatus?.currentJob?.repoFullName === repoFullName;
  }

  function formatTime(timestamp: string) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    // Show relative time for recent runs
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;

    return date.toLocaleString();
  }

  if (loading) {
    return <div style={styles.loading}>Loading dashboard...</div>;
  }

  if (repos.length === 0) {
    return (
      <div style={styles.empty}>
        <h2>No repos configured</h2>
        <p>Go to the Repos tab to add your first repository.</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ ...styles.title, marginBottom: 0 }}>Dashboard</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {refreshing && <span style={{ color: '#666', fontSize: '0.85rem' }}>Refreshing...</span>}
          {queueStatus && queueStatus.queueLength > 0 && (
            <span style={{
              background: '#fef3c7',
              color: '#92400e',
              padding: '0.25rem 0.75rem',
              borderRadius: '4px',
              fontSize: '0.85rem'
            }}>
              Queue: {queueStatus.queueLength} job{queueStatus.queueLength !== 1 ? 's' : ''}
              {queueStatus.isProcessing && ' (running)'}
            </span>
          )}
          <button
            style={{ ...styles.button, ...styles.secondaryButton }}
            onClick={() => loadRepos(false)}
            disabled={refreshing}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#dc2626', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
          {error}
          <button
            style={{ marginLeft: '1rem', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <div style={styles.grid}>
        {repos.map((repo) => {
          const latestRun = getLatestRun(repo);
          const inQueue = isRepoInQueue(repo.repoFullName);
          const running = isRepoRunning(repo.repoFullName);
          const triggering = triggeringRepo === repo.repoFullName;

          return (
            <div key={repo.repoFullName} style={{
              ...styles.card,
              ...(running ? { border: '2px solid #f59e0b', boxShadow: '0 0 10px rgba(245, 158, 11, 0.3)' } : {}),
              ...(inQueue && !running ? { border: '2px solid #3b82f6' } : {})
            }}>
              <div style={styles.cardHeader}>
                <span style={styles.repoName}>{repo.repoFullName}</span>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {running && (
                    <span style={{ ...styles.badge('running'), background: '#fef3c7', color: '#92400e' }}>
                      RUNNING
                    </span>
                  )}
                  {inQueue && !running && (
                    <span style={{ ...styles.badge('queued'), background: '#dbeafe', color: '#1e40af' }}>
                      QUEUED
                    </span>
                  )}
                  {latestRun && !running && (
                    <span style={styles.badge(latestRun.status)}>
                      {latestRun.status.toUpperCase()}
                    </span>
                  )}
                </div>
              </div>

              <div style={styles.cardBody}>
                {latestRun?.screenshotPath ? (
                  <img
                    src={getScreenshotUrl(repo.repoFullName, latestRun.branch) + `?t=${Date.now()}`}
                    alt="Latest screenshot"
                    style={styles.screenshot}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div style={styles.noScreenshot}>
                    {running ? 'Building...' : 'No screenshot'}
                  </div>
                )}

                <div style={styles.info}>
                  <strong>Profile:</strong> {repo.profile}
                </div>
                <div style={styles.info} title={repo.localPath}>
                  <strong>Path:</strong> {repo.localPath.length > 40 ? '...' + repo.localPath.slice(-37) : repo.localPath}
                </div>
                {latestRun && (
                  <>
                    <div style={styles.info}>
                      <strong>Last run:</strong> {latestRun.branch} - {formatTime(latestRun.timestamp)}
                    </div>
                    {latestRun.errorMessage && (
                      <div style={{ ...styles.info, color: '#dc2626' }} title={latestRun.errorMessage}>
                        <strong>Error:</strong> {latestRun.errorMessage.slice(0, 50)}
                        {latestRun.errorMessage.length > 50 ? '...' : ''}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div style={styles.cardFooter}>
                <button
                  style={{
                    ...styles.button,
                    ...styles.primaryButton,
                    opacity: (!repo.enabled || inQueue || triggering) ? 0.6 : 1,
                    cursor: (!repo.enabled || inQueue || triggering) ? 'not-allowed' : 'pointer'
                  }}
                  onClick={() => runMain(repo)}
                  disabled={!repo.enabled || inQueue || triggering}
                >
                  {triggering ? 'Queueing...' : running ? 'Running...' : inQueue ? 'Queued' : 'Run main'}
                </button>
                <div style={styles.toggle}>
                  <label>
                    <input
                      type="checkbox"
                      checked={repo.enabled}
                      onChange={() => toggleEnabled(repo)}
                    />
                    {' '}Enabled
                  </label>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default Dashboard;
