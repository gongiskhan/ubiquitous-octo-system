import { useState, useEffect } from 'react';
import { api, RepoConfig, RunRecord } from '../apiClient';
import ScreenshotView from './ScreenshotView';

const styles = {
  container: {
    maxWidth: '1200px',
  },
  title: {
    fontSize: '1.5rem',
    marginBottom: '1.5rem',
    color: '#1a1a2e',
  },
  filters: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '1.5rem',
    flexWrap: 'wrap' as const,
  },
  select: {
    padding: '0.5rem',
    borderRadius: '4px',
    border: '1px solid #ddd',
    minWidth: '200px',
  },
  section: {
    background: '#fff',
    borderRadius: '8px',
    padding: '1.5rem',
    marginBottom: '1.5rem',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
  sectionTitle: {
    fontSize: '1.1rem',
    fontWeight: 600,
    marginBottom: '1rem',
    color: '#1a1a2e',
  },
  runsList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    maxHeight: '300px',
    overflowY: 'auto' as const,
  },
  runItem: (selected: boolean) => ({
    padding: '0.75rem',
    borderBottom: '1px solid #eee',
    cursor: 'pointer',
    background: selected ? '#f0f9ff' : 'transparent',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  }),
  runInfo: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.25rem',
  },
  badge: (status: string) => ({
    padding: '0.2rem 0.5rem',
    borderRadius: '4px',
    fontSize: '0.75rem',
    fontWeight: 500,
    background: status === 'success' ? '#dcfce7' : status === 'failure' ? '#fee2e2' : '#fef3c7',
    color: status === 'success' ? '#166534' : status === 'failure' ? '#dc2626' : '#92400e',
  }),
  tabs: {
    display: 'flex',
    gap: '0',
    marginBottom: '1rem',
    borderBottom: '1px solid #ddd',
  },
  tab: (active: boolean) => ({
    padding: '0.5rem 1rem',
    background: 'transparent',
    border: 'none',
    borderBottom: active ? '2px solid #1a1a2e' : '2px solid transparent',
    cursor: 'pointer',
    fontWeight: active ? 600 : 400,
    color: active ? '#1a1a2e' : '#666',
  }),
  logContent: {
    background: '#1a1a2e',
    color: '#e0e0e0',
    padding: '1rem',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: '0.85rem',
    whiteSpace: 'pre-wrap' as const,
    overflow: 'auto',
    maxHeight: '500px',
  },
  empty: {
    color: '#666',
    fontStyle: 'italic',
  },
  loading: {
    textAlign: 'center' as const,
    padding: '2rem',
    color: '#666',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 2fr',
    gap: '1.5rem',
  },
};

type LogTab = 'build' | 'runtime' | 'network' | 'screenshot';

function LogsView() {
  const [repos, setRepos] = useState<RepoConfig[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string>('');
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [branches, setBranches] = useState<string[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedRun, setSelectedRun] = useState<RunRecord | null>(null);

  const [logTab, setLogTab] = useState<LogTab>('build');
  const [logContent, setLogContent] = useState<string>('');
  const [loadingLog, setLoadingLog] = useState(false);

  useEffect(() => {
    loadRepos();
  }, []);

  useEffect(() => {
    if (selectedRepo) {
      loadRuns();
    }
  }, [selectedRepo]);

  useEffect(() => {
    if (selectedRepo && selectedBranch) {
      const branchRuns = runs.filter((r) => r.branch === selectedBranch);
      if (branchRuns.length > 0 && !selectedRun) {
        setSelectedRun(branchRuns[0]);
      }
    }
  }, [runs, selectedBranch]);

  useEffect(() => {
    if (selectedRun && logTab !== 'screenshot') {
      loadLog();
    }
  }, [selectedRun, logTab]);

  async function loadRepos() {
    try {
      const data = await api.getRepos();
      setRepos(data);
      if (data.length > 0 && !selectedRepo) {
        setSelectedRepo(data[0].repoFullName);
      }
    } catch (err) {
      console.error('Failed to load repos:', err);
    }
  }

  async function loadRuns() {
    try {
      const runsData = await api.getRuns(selectedRepo);
      setRuns(runsData);

      // Get unique branches
      const uniqueBranches = [...new Set(runsData.map((r) => r.branch))];
      setBranches(uniqueBranches);

      if (uniqueBranches.length > 0 && !selectedBranch) {
        setSelectedBranch(uniqueBranches[0]);
      }
    } catch (err) {
      console.error('Failed to load runs:', err);
      setRuns([]);
      setBranches([]);
    }
  }

  async function loadLog() {
    if (!selectedRun) return;

    try {
      setLoadingLog(true);
      let content = '';

      switch (logTab) {
        case 'build':
          content = await api.getBuildLog(selectedRepo, selectedRun.branch, selectedRun.runId);
          break;
        case 'runtime':
          content = await api.getRuntimeLog(selectedRepo, selectedRun.branch, selectedRun.runId);
          break;
        case 'network':
          content = await api.getNetworkLog(selectedRepo, selectedRun.branch, selectedRun.runId);
          break;
      }

      setLogContent(content);
    } catch (err) {
      setLogContent(`Error loading log: ${err}`);
    } finally {
      setLoadingLog(false);
    }
  }

  function formatTime(timestamp: string) {
    const date = new Date(timestamp);
    return date.toLocaleString();
  }

  const filteredRuns = runs.filter((r) => !selectedBranch || r.branch === selectedBranch);

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Logs</h2>

      <div style={styles.filters}>
        <select
          style={styles.select}
          value={selectedRepo}
          onChange={(e) => {
            setSelectedRepo(e.target.value);
            setSelectedBranch('');
            setSelectedRun(null);
          }}
        >
          <option value="">Select repository...</option>
          {repos.map((repo) => (
            <option key={repo.repoFullName} value={repo.repoFullName}>
              {repo.repoFullName}
            </option>
          ))}
        </select>

        <select
          style={styles.select}
          value={selectedBranch}
          onChange={(e) => {
            setSelectedBranch(e.target.value);
            setSelectedRun(null);
          }}
          disabled={!selectedRepo}
        >
          <option value="">All branches</option>
          {branches.map((branch) => (
            <option key={branch} value={branch}>
              {branch}
            </option>
          ))}
        </select>
      </div>

      {!selectedRepo ? (
        <div style={styles.section}>
          <p style={styles.empty}>Select a repository to view logs</p>
        </div>
      ) : (
        <div style={styles.grid}>
          {/* Runs List */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Runs</h3>
            {filteredRuns.length === 0 ? (
              <p style={styles.empty}>No runs found</p>
            ) : (
              <ul style={styles.runsList}>
                {filteredRuns.map((run) => (
                  <li
                    key={run.runId}
                    style={styles.runItem(selectedRun?.runId === run.runId)}
                    onClick={() => setSelectedRun(run)}
                  >
                    <div style={styles.runInfo}>
                      <span>{run.branch}</span>
                      <span style={{ fontSize: '0.8rem', color: '#666' }}>
                        {formatTime(run.timestamp)}
                      </span>
                    </div>
                    <span style={styles.badge(run.status)}>{run.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Log Content */}
          <div style={styles.section}>
            {selectedRun ? (
              <>
                <h3 style={styles.sectionTitle}>
                  {selectedRun.branch} - {selectedRun.runId}
                </h3>

                <div style={styles.tabs}>
                  <button
                    style={styles.tab(logTab === 'build')}
                    onClick={() => setLogTab('build')}
                  >
                    Build Log
                  </button>
                  <button
                    style={styles.tab(logTab === 'runtime')}
                    onClick={() => setLogTab('runtime')}
                  >
                    Runtime Log
                  </button>
                  <button
                    style={styles.tab(logTab === 'network')}
                    onClick={() => setLogTab('network')}
                  >
                    Network Log
                  </button>
                  <button
                    style={styles.tab(logTab === 'screenshot')}
                    onClick={() => setLogTab('screenshot')}
                  >
                    Screenshot
                  </button>
                </div>

                {logTab === 'screenshot' ? (
                  <ScreenshotView
                    repoFullName={selectedRepo}
                    branch={selectedRun.branch}
                  />
                ) : loadingLog ? (
                  <div style={styles.loading}>Loading log...</div>
                ) : (
                  <pre style={styles.logContent}>
                    {logContent || 'No log content available'}
                  </pre>
                )}

                {selectedRun.errorMessage && (
                  <div style={{ marginTop: '1rem', padding: '1rem', background: '#fee2e2', borderRadius: '4px', color: '#dc2626' }}>
                    <strong>Error:</strong> {selectedRun.errorMessage}
                  </div>
                )}
              </>
            ) : (
              <p style={styles.empty}>Select a run to view logs</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default LogsView;
