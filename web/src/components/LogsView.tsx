import { useState, useEffect, useRef } from 'react';
import { api, RepoConfig, RunRecord, getRunScreenshotUrl, getDiffScreenshotUrl, Status } from '../apiClient';
import { useTheme } from '../context/ThemeContext';
import ZoomableImage from './ZoomableImage';

const getStyles = (darkMode: boolean) => ({
  container: {
    maxWidth: '1400px',
  },
  title: {
    fontSize: '1.5rem',
    marginBottom: '1.5rem',
    color: darkMode ? '#e0e0e0' : '#1a1a2e',
  },
  filters: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '1.5rem',
    flexWrap: 'wrap' as const,
    alignItems: 'center',
  },
  select: {
    padding: '0.5rem',
    borderRadius: '4px',
    border: `1px solid ${darkMode ? '#374151' : '#ddd'}`,
    background: darkMode ? '#1f2937' : '#fff',
    color: darkMode ? '#e0e0e0' : '#333',
    minWidth: '200px',
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
  thumbnailGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '1rem',
    marginBottom: '1rem',
  },
  thumbnailCard: (selected: boolean) => ({
    background: selected ? (darkMode ? '#374151' : '#f0f9ff') : (darkMode ? '#0f0f1a' : '#f5f5f5'),
    borderRadius: '8px',
    padding: '0.5rem',
    cursor: 'pointer',
    border: selected ? `2px solid ${darkMode ? '#3b82f6' : '#2563eb'}` : '2px solid transparent',
    transition: 'all 0.2s',
  }),
  thumbnail: {
    width: '100%',
    height: '100px',
    objectFit: 'cover' as const,
    borderRadius: '4px',
    background: darkMode ? '#1a1a2e' : '#e5e5e5',
  },
  thumbnailInfo: {
    marginTop: '0.5rem',
    fontSize: '0.75rem',
    color: darkMode ? '#9ca3af' : '#666',
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
    borderBottom: `1px solid ${darkMode ? '#2a2a4e' : '#eee'}`,
    cursor: 'pointer',
    background: selected ? (darkMode ? '#374151' : '#f0f9ff') : 'transparent',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    transition: 'background 0.15s',
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
  tabs: {
    display: 'flex',
    gap: '0',
    marginBottom: '1rem',
    borderBottom: `1px solid ${darkMode ? '#2a2a4e' : '#ddd'}`,
  },
  tab: (active: boolean) => ({
    padding: '0.5rem 1rem',
    background: 'transparent',
    border: 'none',
    borderBottom: active ? `2px solid ${darkMode ? '#3b82f6' : '#1a1a2e'}` : '2px solid transparent',
    cursor: 'pointer',
    fontWeight: active ? 600 : 400,
    color: active ? (darkMode ? '#e0e0e0' : '#1a1a2e') : (darkMode ? '#6b7280' : '#666'),
  }),
  logContent: {
    background: darkMode ? '#0f0f1a' : '#1a1a2e',
    color: '#e0e0e0',
    padding: '1rem',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: '0.85rem',
    whiteSpace: 'pre-wrap' as const,
    overflow: 'auto',
    maxHeight: 'calc(100vh - 400px)',
    minHeight: '300px',
  },
  screenshotContainer: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '1rem',
  },
  screenshotBox: {
    background: darkMode ? '#0f0f1a' : '#f5f5f5',
    borderRadius: '8px',
    padding: '1rem',
  },
  screenshotLabel: {
    fontSize: '0.85rem',
    fontWeight: 500,
    marginBottom: '0.5rem',
    color: darkMode ? '#9ca3af' : '#666',
  },
  empty: {
    color: darkMode ? '#6b7280' : '#666',
    fontStyle: 'italic',
  },
  loading: {
    textAlign: 'center' as const,
    padding: '2rem',
    color: darkMode ? '#6b7280' : '#666',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 2fr',
    gap: '1.5rem',
  },
  metadataBox: {
    marginTop: '1rem',
    padding: '1rem',
    background: darkMode ? '#0f0f1a' : '#f5f5f5',
    borderRadius: '4px',
  },
  metadataRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.25rem 0',
    borderBottom: `1px solid ${darkMode ? '#1a1a2e' : '#e5e5e5'}`,
    fontSize: '0.85rem',
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
  viewToggle: {
    display: 'flex',
    gap: '0.5rem',
    marginLeft: 'auto',
  },
  viewButton: (active: boolean, darkMode: boolean) => ({
    padding: '0.4rem 0.8rem',
    borderRadius: '4px',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.8rem',
    background: active ? (darkMode ? '#3b82f6' : '#1a1a2e') : (darkMode ? '#374151' : '#e5e5e5'),
    color: active ? '#fff' : (darkMode ? '#9ca3af' : '#666'),
  }),
});

type LogTab = 'build' | 'runtime' | 'screenshot' | 'metadata';
type ViewMode = 'list' | 'thumbnails';

function LogsView() {
  const { darkMode, toast } = useTheme();
  const styles = getStyles(darkMode);

  const [repos, setRepos] = useState<RepoConfig[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string>('');
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [branches, setBranches] = useState<string[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedRun, setSelectedRun] = useState<RunRecord | null>(null);
  const [tailscaleIp, setTailscaleIp] = useState<string | null>(null);

  const [logTab, setLogTab] = useState<LogTab>('build');
  const [logContent, setLogContent] = useState<string>('');
  const [loadingLog, setLoadingLog] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('thumbnails');
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    loadRepos();
    loadStatus();
  }, []);

  async function loadStatus() {
    try {
      const status = await api.getStatus();
      setTailscaleIp(status.tailscaleIp);
    } catch (err) {
      // Ignore status errors
    }
  }

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
    if (selectedRun && logTab !== 'screenshot' && logTab !== 'metadata') {
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
      toast.error('Failed to load repos');
    }
  }

  async function loadRuns() {
    try {
      const runsData = await api.getRuns(selectedRepo);
      setRuns(runsData);

      const uniqueBranches = [...new Set(runsData.map((r) => r.branch))];
      setBranches(uniqueBranches);

      if (uniqueBranches.length > 0 && !selectedBranch) {
        setSelectedBranch(uniqueBranches[0]);
      }
    } catch (err) {
      toast.error('Failed to load runs');
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
      }

      setLogContent(content);
    } catch (err) {
      setLogContent(`Error loading log: ${err}`);
    } finally {
      setLoadingLog(false);
    }
  }

  // Auto-scroll to bottom when log content changes
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logContent, autoScroll]);

  function formatTime(timestamp: string) {
    const date = new Date(timestamp);
    return date.toLocaleString();
  }

  function formatDuration(ms?: number) {
    if (!ms) return '-';
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  const filteredRuns = runs.filter((r) => !selectedBranch || r.branch === selectedBranch);

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Logs & Run History</h2>

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

        <div style={styles.viewToggle}>
          <button
            style={styles.viewButton(viewMode === 'thumbnails', darkMode)}
            onClick={() => setViewMode('thumbnails')}
          >
            Thumbnails
          </button>
          <button
            style={styles.viewButton(viewMode === 'list', darkMode)}
            onClick={() => setViewMode('list')}
          >
            List
          </button>
        </div>
      </div>

      {!selectedRepo ? (
        <div style={styles.section}>
          <p style={styles.empty}>Select a repository to view run history</p>
        </div>
      ) : (
        <>
          {/* Thumbnail Grid View */}
          {viewMode === 'thumbnails' && filteredRuns.length > 0 && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Recent Runs ({filteredRuns.length})</h3>
              <div style={styles.thumbnailGrid}>
                {filteredRuns.slice(0, 20).map((run) => (
                  <div
                    key={run.runId}
                    style={styles.thumbnailCard(selectedRun?.runId === run.runId)}
                    onClick={() => setSelectedRun(run)}
                  >
                    {run.screenshotPath ? (
                      <img
                        src={getRunScreenshotUrl(selectedRepo, run.branch, run.runId, tailscaleIp)}
                        alt={`Run ${run.runId}`}
                        style={styles.thumbnail}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div style={{ ...styles.thumbnail, display: 'flex', alignItems: 'center', justifyContent: 'center', color: darkMode ? '#666' : '#999' }}>
                        No image
                      </div>
                    )}
                    <div style={styles.thumbnailInfo}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{run.branch}</span>
                        <span style={styles.badge(run.status)}>{run.status}</span>
                      </div>
                      <div style={{ fontSize: '0.7rem', marginTop: '0.25rem', color: darkMode ? '#6b7280' : '#999' }}>
                        {new Date(run.timestamp).toLocaleDateString()}
                      </div>
                      {run.diffResult && (
                        <div style={{ marginTop: '0.25rem' }}>
                          <span style={styles.diffBadge(run.diffResult.diffPercentage)}>
                            {run.diffResult.diffPercentage === 0 ? '=' : `${run.diffResult.diffPercentage.toFixed(1)}%`}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
                        <span style={{ fontWeight: 500, color: darkMode ? '#e0e0e0' : '#1a1a2e' }}>{run.branch}</span>
                        <span style={{ fontSize: '0.8rem', color: darkMode ? '#6b7280' : '#666' }}>
                          {formatTime(run.timestamp)}
                        </span>
                        {run.durations?.total && (
                          <span style={{ fontSize: '0.75rem', color: darkMode ? '#4b5563' : '#9ca3af' }}>
                            {formatDuration(run.durations.total)}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        {run.diffResult && (
                          <span style={styles.diffBadge(run.diffResult.diffPercentage)}>
                            {run.diffResult.diffPercentage === 0 ? '=' : `${run.diffResult.diffPercentage.toFixed(1)}%`}
                          </span>
                        )}
                        <span style={styles.badge(run.status)}>{run.status}</span>
                      </div>
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

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
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
                        Runtime
                      </button>
                      <button
                        style={styles.tab(logTab === 'screenshot')}
                        onClick={() => setLogTab('screenshot')}
                      >
                        Screenshots
                      </button>
                      <button
                        style={styles.tab(logTab === 'metadata')}
                        onClick={() => setLogTab('metadata')}
                      >
                        Metadata
                      </button>
                    </div>
                    {(logTab === 'build' || logTab === 'runtime') && (
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
                        {autoScroll ? 'Auto-tail ON' : 'Auto-tail OFF'}
                      </button>
                    )}
                  </div>

                  {logTab === 'screenshot' ? (
                    <div style={styles.screenshotContainer}>
                      <div style={styles.screenshotBox}>
                        <div style={styles.screenshotLabel}>Current Screenshot</div>
                        {selectedRun.screenshotPath ? (
                          <ZoomableImage
                            src={getRunScreenshotUrl(selectedRepo, selectedRun.branch, selectedRun.runId, tailscaleIp)}
                            alt="Current screenshot"
                            darkMode={darkMode}
                            style={{ width: '100%', borderRadius: '4px' }}
                          />
                        ) : (
                          <p style={styles.empty}>No screenshot available</p>
                        )}
                      </div>
                      {selectedRun.diffResult?.diffPath && (
                        <div style={styles.screenshotBox}>
                          <div style={styles.screenshotLabel}>
                            Diff ({selectedRun.diffResult.diffPercentage.toFixed(2)}% changed)
                          </div>
                          <ZoomableImage
                            src={getDiffScreenshotUrl(selectedRepo, selectedRun.branch, selectedRun.runId, tailscaleIp)}
                            alt="Diff screenshot"
                            darkMode={darkMode}
                            style={{ width: '100%', borderRadius: '4px' }}
                          />
                        </div>
                      )}
                    </div>
                  ) : logTab === 'metadata' ? (
                    <div style={styles.metadataBox}>
                      <div style={styles.metadataRow}>
                        <span>Run ID</span>
                        <span style={{ fontFamily: 'monospace' }}>{selectedRun.runId}</span>
                      </div>
                      <div style={styles.metadataRow}>
                        <span>Branch</span>
                        <span>{selectedRun.branch}</span>
                      </div>
                      <div style={styles.metadataRow}>
                        <span>Status</span>
                        <span style={styles.badge(selectedRun.status)}>{selectedRun.status}</span>
                      </div>
                      <div style={styles.metadataRow}>
                        <span>Timestamp</span>
                        <span>{formatTime(selectedRun.timestamp)}</span>
                      </div>
                      {selectedRun.durations && (
                        <>
                          <div style={styles.metadataRow}>
                            <span>Total Duration</span>
                            <span>{formatDuration(selectedRun.durations.total)}</span>
                          </div>
                          {selectedRun.durations.git && (
                            <div style={styles.metadataRow}>
                              <span>Git</span>
                              <span>{formatDuration(selectedRun.durations.git)}</span>
                            </div>
                          )}
                          {selectedRun.durations.install && (
                            <div style={styles.metadataRow}>
                              <span>Install</span>
                              <span>{formatDuration(selectedRun.durations.install)}</span>
                            </div>
                          )}
                          {selectedRun.durations.build && (
                            <div style={styles.metadataRow}>
                              <span>Build</span>
                              <span>{formatDuration(selectedRun.durations.build)}</span>
                            </div>
                          )}
                          {selectedRun.durations.screenshot && (
                            <div style={styles.metadataRow}>
                              <span>Screenshot</span>
                              <span>{formatDuration(selectedRun.durations.screenshot)}</span>
                            </div>
                          )}
                        </>
                      )}
                      {selectedRun.diffResult && (
                        <div style={styles.metadataRow}>
                          <span>Visual Diff</span>
                          <span style={styles.diffBadge(selectedRun.diffResult.diffPercentage)}>
                            {selectedRun.diffResult.diffPercentage.toFixed(2)}%
                          </span>
                        </div>
                      )}
                      {selectedRun.errorMessage && (
                        <div style={{ marginTop: '1rem', padding: '0.5rem', background: darkMode ? '#450a0a' : '#fee2e2', borderRadius: '4px', color: darkMode ? '#fca5a5' : '#dc2626', fontSize: '0.85rem' }}>
                          <strong>Error:</strong> {selectedRun.errorMessage}
                        </div>
                      )}
                      {selectedRun.errorSummary && selectedRun.errorSummary.errorLines.length > 0 && (
                        <div style={{ marginTop: '1rem' }}>
                          <strong style={{ fontSize: '0.85rem' }}>Error Summary:</strong>
                          <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem', fontSize: '0.8rem' }}>
                            {selectedRun.errorSummary.errorLines.slice(0, 5).map((line, i) => (
                              <li key={i} style={{ marginBottom: '0.25rem', color: darkMode ? '#fca5a5' : '#dc2626' }}>
                                {line.slice(0, 100)}{line.length > 100 ? '...' : ''}
                              </li>
                            ))}
                          </ul>
                          {selectedRun.errorSummary.warningCount > 0 && (
                            <p style={{ fontSize: '0.8rem', color: darkMode ? '#fcd34d' : '#d97706' }}>
                              + {selectedRun.errorSummary.warningCount} warnings
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ) : loadingLog ? (
                    <div style={styles.loading}>Loading log...</div>
                  ) : (
                    <pre
                      ref={logContainerRef}
                      style={{
                        ...styles.logContent,
                        scrollBehavior: autoScroll ? 'smooth' : 'auto',
                      }}
                      onScroll={(e) => {
                        const target = e.target as HTMLPreElement;
                        const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 50;
                        if (!isAtBottom && autoScroll) {
                          setAutoScroll(false);
                        }
                      }}
                    >
                      {logContent || 'No log content available'}
                    </pre>
                  )}
                </>
              ) : (
                <p style={styles.empty}>Select a run to view details</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default LogsView;
