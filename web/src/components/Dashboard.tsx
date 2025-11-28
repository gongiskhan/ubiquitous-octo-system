import { useState, useEffect, useCallback } from 'react';
import { api, RepoConfig, getScreenshotUrl, Status, GitHubBranch } from '../apiClient';
import { useTheme } from '../context/ThemeContext';
import ZoomableImage from './ZoomableImage';

const AUTO_REFRESH_INTERVAL = 5000;

const getStyles = (darkMode: boolean) => ({
  container: {
    maxWidth: '1400px',
  },
  title: {
    fontSize: '1.5rem',
    marginBottom: '1.5rem',
    color: darkMode ? '#e0e0e0' : '#1a1a2e',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
    gap: '1.5rem',
  },
  card: {
    background: darkMode ? '#1a1a2e' : '#fff',
    borderRadius: '8px',
    boxShadow: darkMode ? '0 4px 12px rgba(0,0,0,0.4)' : '0 2px 4px rgba(0,0,0,0.1)',
    overflow: 'hidden',
    transition: 'box-shadow 0.2s, transform 0.2s',
  },
  cardHeader: {
    padding: '1rem',
    borderBottom: `1px solid ${darkMode ? '#2a2a4e' : '#eee'}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  repoName: {
    fontWeight: 600,
    fontSize: '1.1rem',
    color: darkMode ? '#e0e0e0' : '#1a1a2e',
  },
  badge: (status: string) => ({
    padding: '0.25rem 0.5rem',
    borderRadius: '4px',
    fontSize: '0.75rem',
    fontWeight: 500,
    background: status === 'success'
      ? (darkMode ? '#064e3b' : '#dcfce7')
      : status === 'failure'
        ? (darkMode ? '#450a0a' : '#fee2e2')
        : (darkMode ? '#78350f' : '#fef3c7'),
    color: status === 'success'
      ? (darkMode ? '#a7f3d0' : '#166534')
      : status === 'failure'
        ? (darkMode ? '#fca5a5' : '#dc2626')
        : (darkMode ? '#fcd34d' : '#92400e'),
  }),
  cardBody: {
    padding: '1rem',
  },
  screenshot: {
    width: '100%',
    height: '200px',
    objectFit: 'cover' as const,
    background: darkMode ? '#0f0f1a' : '#f5f5f5',
    borderRadius: '4px',
    marginBottom: '1rem',
    cursor: 'pointer',
  },
  noScreenshot: {
    width: '100%',
    height: '200px',
    background: darkMode ? '#0f0f1a' : '#f5f5f5',
    borderRadius: '4px',
    marginBottom: '1rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: darkMode ? '#666' : '#999',
  },
  info: {
    fontSize: '0.85rem',
    color: darkMode ? '#9ca3af' : '#666',
    marginBottom: '0.5rem',
  },
  cardFooter: {
    padding: '1rem',
    borderTop: `1px solid ${darkMode ? '#2a2a4e' : '#eee'}`,
  },
  buttonRow: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '0.75rem',
    flexWrap: 'wrap' as const,
  },
  button: {
    padding: '0.5rem 1rem',
    borderRadius: '4px',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 500,
    transition: 'opacity 0.2s',
  },
  primaryButton: (darkMode: boolean) => ({
    background: darkMode ? '#3b82f6' : '#1a1a2e',
    color: '#fff',
  }),
  secondaryButton: (darkMode: boolean) => ({
    background: darkMode ? '#374151' : '#e5e5e5',
    color: darkMode ? '#e0e0e0' : '#333',
  }),
  toggle: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  branchSelect: (darkMode: boolean) => ({
    padding: '0.4rem',
    borderRadius: '4px',
    border: `1px solid ${darkMode ? '#374151' : '#ddd'}`,
    background: darkMode ? '#1f2937' : '#fff',
    color: darkMode ? '#e0e0e0' : '#333',
    fontSize: '0.85rem',
    minWidth: '120px',
  }),
  empty: {
    textAlign: 'center' as const,
    padding: '3rem',
    color: darkMode ? '#9ca3af' : '#666',
  },
  loading: {
    textAlign: 'center' as const,
    padding: '2rem',
    color: darkMode ? '#9ca3af' : '#666',
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
  },
  diffBadge: (percentage: number) => ({
    padding: '0.2rem 0.5rem',
    borderRadius: '4px',
    fontSize: '0.75rem',
    background: percentage === 0
      ? (darkMode ? '#064e3b' : '#dcfce7')
      : percentage < 1
        ? (darkMode ? '#1e3a5f' : '#dbeafe')
        : percentage < 10
          ? (darkMode ? '#78350f' : '#fef3c7')
          : (darkMode ? '#450a0a' : '#fee2e2'),
    color: percentage === 0
      ? (darkMode ? '#a7f3d0' : '#166534')
      : percentage < 1
        ? (darkMode ? '#93c5fd' : '#1e40af')
        : percentage < 10
          ? (darkMode ? '#fcd34d' : '#92400e')
          : (darkMode ? '#fca5a5' : '#dc2626'),
  }),
  durationInfo: {
    fontSize: '0.75rem',
    color: darkMode ? '#6b7280' : '#9ca3af',
    marginTop: '0.25rem',
  },
  errorBox: (darkMode: boolean) => ({
    marginTop: '0.5rem',
    padding: '0.5rem',
    background: darkMode ? '#450a0a' : '#fee2e2',
    borderRadius: '4px',
    fontSize: '0.8rem',
    color: darkMode ? '#fca5a5' : '#dc2626',
  }),
});

function Dashboard() {
  const { darkMode, toast } = useTheme();
  const styles = getStyles(darkMode);

  const [repos, setRepos] = useState<RepoConfig[]>([]);
  const [queueStatus, setQueueStatus] = useState<Status['queue'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triggeringRepo, setTriggeringRepo] = useState<string | null>(null);
  const [selectedBranches, setSelectedBranches] = useState<Record<string, string>>({});
  const [repoBranches, setRepoBranches] = useState<Record<string, GitHubBranch[]>>({});
  const [loadingBranches, setLoadingBranches] = useState<Record<string, boolean>>({});

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
    const interval = setInterval(() => loadRepos(false), AUTO_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [loadRepos]);

  async function loadBranches(repoFullName: string) {
    if (repoBranches[repoFullName] || loadingBranches[repoFullName]) return;

    try {
      setLoadingBranches((prev) => ({ ...prev, [repoFullName]: true }));
      const branches = await api.getGitHubBranches(repoFullName);
      setRepoBranches((prev) => ({ ...prev, [repoFullName]: branches }));
    } catch (err) {
      toast.error(`Failed to load branches for ${repoFullName}`);
    } finally {
      setLoadingBranches((prev) => ({ ...prev, [repoFullName]: false }));
    }
  }

  async function toggleEnabled(repo: RepoConfig) {
    try {
      await api.updateRepo(repo.repoFullName, { enabled: !repo.enabled });
      toast.success(`${repo.repoFullName} ${repo.enabled ? 'disabled' : 'enabled'}`);
      loadRepos(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update repo');
    }
  }

  async function runBranch(repo: RepoConfig, branch: string) {
    try {
      setTriggeringRepo(repo.repoFullName);
      await api.triggerRun(repo.repoFullName, branch);
      toast.success(`Build queued for ${repo.repoFullName}/${branch}`);
      await loadRepos(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to trigger run');
    } finally {
      setTriggeringRepo(null);
    }
  }

  async function rebuildLast(repo: RepoConfig) {
    const latestRun = getLatestRun(repo);
    if (!latestRun) {
      toast.warning('No previous run to rebuild');
      return;
    }

    await runBranch(repo, latestRun.branch);
  }

  async function resetRepo(repo: RepoConfig) {
    try {
      await api.resetToMain(repo.repoFullName);
      toast.success(`Reset ${repo.repoFullName} to main`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reset repo');
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

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;

    return date.toLocaleString();
  }

  function formatDuration(ms?: number) {
    if (!ms) return '';
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
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
          {refreshing && <span style={{ color: darkMode ? '#9ca3af' : '#666', fontSize: '0.85rem' }}>Refreshing...</span>}
          {queueStatus && queueStatus.queueLength > 0 && (
            <span style={{
              background: darkMode ? '#78350f' : '#fef3c7',
              color: darkMode ? '#fcd34d' : '#92400e',
              padding: '0.25rem 0.75rem',
              borderRadius: '4px',
              fontSize: '0.85rem'
            }}>
              Queue: {queueStatus.queueLength} job{queueStatus.queueLength !== 1 ? 's' : ''}
              {queueStatus.isProcessing && ' (running)'}
            </span>
          )}
          <button
            style={{ ...styles.button, ...styles.secondaryButton(darkMode) }}
            onClick={() => loadRepos(false)}
            disabled={refreshing}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          background: darkMode ? '#450a0a' : '#fee2e2',
          color: darkMode ? '#fca5a5' : '#dc2626',
          padding: '1rem',
          borderRadius: '4px',
          marginBottom: '1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          {error}
          <button
            style={{ marginLeft: '1rem', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
            onClick={() => setError(null)}
          >
            ×
          </button>
        </div>
      )}

      <div style={styles.grid}>
        {repos.map((repo) => {
          const latestRun = getLatestRun(repo);
          const inQueue = isRepoInQueue(repo.repoFullName);
          const running = isRepoRunning(repo.repoFullName);
          const triggering = triggeringRepo === repo.repoFullName;
          const branches = repoBranches[repo.repoFullName] || [];
          const selectedBranch = selectedBranches[repo.repoFullName] || 'main';

          return (
            <div key={repo.repoFullName} style={{
              ...styles.card,
              ...(running ? { border: '2px solid #f59e0b', boxShadow: '0 0 10px rgba(245, 158, 11, 0.3)' } : {}),
              ...(inQueue && !running ? { border: `2px solid ${darkMode ? '#3b82f6' : '#3b82f6'}` } : {})
            }}>
              <div style={styles.cardHeader}>
                <span style={styles.repoName}>{repo.repoFullName}</span>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {running && (
                    <span style={{ ...styles.badge('running'), background: darkMode ? '#78350f' : '#fef3c7', color: darkMode ? '#fcd34d' : '#92400e' }}>
                      RUNNING
                    </span>
                  )}
                  {inQueue && !running && (
                    <span style={{ ...styles.badge('queued'), background: darkMode ? '#1e3a5f' : '#dbeafe', color: darkMode ? '#93c5fd' : '#1e40af' }}>
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
                  <ZoomableImage
                    src={getScreenshotUrl(repo.repoFullName, latestRun.branch) + `?t=${Date.now()}`}
                    alt="Latest screenshot"
                    style={styles.screenshot}
                    darkMode={darkMode}
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
                    <div style={styles.statusRow}>
                      <div style={styles.info}>
                        <strong>Last:</strong> {latestRun.branch} - {formatTime(latestRun.timestamp)}
                      </div>
                      {latestRun.diffResult && (
                        <span style={styles.diffBadge(latestRun.diffResult.diffPercentage)}>
                          {latestRun.diffResult.diffPercentage === 0 ? 'No changes' : `${latestRun.diffResult.diffPercentage.toFixed(1)}% diff`}
                        </span>
                      )}
                    </div>
                    {latestRun.durations?.total && (
                      <div style={styles.durationInfo}>
                        Duration: {formatDuration(latestRun.durations.total)}
                        {latestRun.durations.build && ` (build: ${formatDuration(latestRun.durations.build)})`}
                      </div>
                    )}
                    {latestRun.errorMessage && (
                      <div style={styles.errorBox(darkMode)} title={latestRun.errorMessage}>
                        {latestRun.errorMessage.slice(0, 80)}
                        {latestRun.errorMessage.length > 80 ? '...' : ''}
                      </div>
                    )}
                    {latestRun.errorSummary && latestRun.errorSummary.errorLines.length > 0 && (
                      <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: darkMode ? '#9ca3af' : '#666' }}>
                        {latestRun.errorSummary.warningCount > 0 && (
                          <span style={{ marginRight: '0.5rem' }}>Warn: {latestRun.errorSummary.warningCount}</span>
                        )}
                        <span>Errors: {latestRun.errorSummary.errorLines.length}</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div style={styles.cardFooter}>
                <div style={styles.buttonRow}>
                  <button
                    style={{
                      ...styles.button,
                      ...styles.primaryButton(darkMode),
                      opacity: (!repo.enabled || inQueue || triggering) ? 0.6 : 1,
                      cursor: (!repo.enabled || inQueue || triggering) ? 'not-allowed' : 'pointer'
                    }}
                    onClick={() => runBranch(repo, 'main')}
                    disabled={!repo.enabled || inQueue || triggering}
                  >
                    {triggering ? 'Queueing...' : running ? 'Running...' : inQueue ? 'Queued' : 'Run main'}
                  </button>

                  <select
                    style={styles.branchSelect(darkMode)}
                    value={selectedBranch}
                    onClick={() => loadBranches(repo.repoFullName)}
                    onChange={(e) => setSelectedBranches(prev => ({ ...prev, [repo.repoFullName]: e.target.value }))}
                  >
                    <option value="main">main</option>
                    {branches.filter(b => b.name !== 'main').map(b => (
                      <option key={b.name} value={b.name}>{b.name}</option>
                    ))}
                  </select>

                  <button
                    style={{
                      ...styles.button,
                      ...styles.secondaryButton(darkMode),
                      opacity: (!repo.enabled || inQueue || triggering || selectedBranch === 'main') ? 0.6 : 1,
                    }}
                    onClick={() => runBranch(repo, selectedBranch)}
                    disabled={!repo.enabled || inQueue || triggering || selectedBranch === 'main'}
                    title="Run selected branch"
                  >
                    Run
                  </button>
                </div>

                <div style={styles.buttonRow}>
                  <button
                    style={{
                      ...styles.button,
                      ...styles.secondaryButton(darkMode),
                      opacity: (!repo.enabled || inQueue || triggering || !latestRun) ? 0.6 : 1,
                    }}
                    onClick={() => rebuildLast(repo)}
                    disabled={!repo.enabled || inQueue || triggering || !latestRun}
                    title="Rebuild last run"
                  >
                    Rebuild
                  </button>

                  <button
                    style={{ ...styles.button, ...styles.secondaryButton(darkMode) }}
                    onClick={() => resetRepo(repo)}
                    title="Reset to main branch"
                  >
                    Reset
                  </button>

                  <div style={{ ...styles.toggle, marginLeft: 'auto' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={repo.enabled}
                        onChange={() => toggleEnabled(repo)}
                      />
                      <span style={{ fontSize: '0.85rem', color: darkMode ? '#9ca3af' : '#666' }}>Enabled</span>
                    </label>
                  </div>
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
