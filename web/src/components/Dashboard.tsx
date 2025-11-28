import { useState, useEffect } from 'react';
import { api, RepoConfig, getScreenshotUrl } from '../apiClient';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRepos();
  }, []);

  async function loadRepos() {
    try {
      setLoading(true);
      const data = await api.getRepos();
      setRepos(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load repos');
    } finally {
      setLoading(false);
    }
  }

  async function toggleEnabled(repo: RepoConfig) {
    try {
      await api.updateRepo(repo.repoFullName, { enabled: !repo.enabled });
      loadRepos();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update repo');
    }
  }

  async function runMain(repo: RepoConfig) {
    try {
      await api.triggerRun(repo.repoFullName, 'main');
      // Reload after a moment to see the queued status
      setTimeout(loadRepos, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger run');
    }
  }

  function getLatestRun(repo: RepoConfig) {
    if (!repo.lastRuns || repo.lastRuns.length === 0) return null;
    return repo.lastRuns[0];
  }

  function formatTime(timestamp: string) {
    const date = new Date(timestamp);
    return date.toLocaleString();
  }

  if (loading) {
    return <div style={styles.loading}>Loading...</div>;
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
      <h2 style={styles.title}>Dashboard</h2>

      {error && (
        <div style={{ background: '#fee2e2', color: '#dc2626', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      <div style={styles.grid}>
        {repos.map((repo) => {
          const latestRun = getLatestRun(repo);

          return (
            <div key={repo.repoFullName} style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={styles.repoName}>{repo.repoFullName}</span>
                {latestRun && (
                  <span style={styles.badge(latestRun.status)}>
                    {latestRun.status.toUpperCase()}
                  </span>
                )}
              </div>

              <div style={styles.cardBody}>
                {latestRun?.screenshotPath ? (
                  <img
                    src={getScreenshotUrl(repo.repoFullName, latestRun.branch)}
                    alt="Latest screenshot"
                    style={styles.screenshot}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div style={styles.noScreenshot}>No screenshot</div>
                )}

                <div style={styles.info}>
                  <strong>Profile:</strong> {repo.profile}
                </div>
                <div style={styles.info}>
                  <strong>Path:</strong> {repo.localPath}
                </div>
                {latestRun && (
                  <>
                    <div style={styles.info}>
                      <strong>Last run:</strong> {latestRun.branch} at {formatTime(latestRun.timestamp)}
                    </div>
                    {latestRun.errorMessage && (
                      <div style={{ ...styles.info, color: '#dc2626' }}>
                        <strong>Error:</strong> {latestRun.errorMessage}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div style={styles.cardFooter}>
                <button
                  style={{ ...styles.button, ...styles.primaryButton }}
                  onClick={() => runMain(repo)}
                  disabled={!repo.enabled}
                >
                  Run main
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
