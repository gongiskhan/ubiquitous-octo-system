import { useState, useEffect } from 'react';
import { api, GitHubRepo, RepoConfig } from '../apiClient';
import RepoConfigForm from './RepoConfigForm';

const styles = {
  container: {
    maxWidth: '900px',
  },
  title: {
    fontSize: '1.5rem',
    marginBottom: '1.5rem',
    color: '#1a1a2e',
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
  button: {
    padding: '0.5rem 1rem',
    borderRadius: '4px',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.9rem',
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
  list: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  listItem: {
    padding: '0.75rem 1rem',
    borderBottom: '1px solid #eee',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer',
  },
  listItemHover: {
    background: '#f9f9f9',
  },
  repoInfo: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.25rem',
  },
  repoName: {
    fontWeight: 500,
  },
  repoDesc: {
    fontSize: '0.85rem',
    color: '#666',
  },
  badge: {
    padding: '0.2rem 0.5rem',
    borderRadius: '4px',
    fontSize: '0.75rem',
    background: '#e5e5e5',
    color: '#666',
  },
  configuredBadge: {
    background: '#dcfce7',
    color: '#166534',
  },
  select: {
    padding: '0.5rem',
    borderRadius: '4px',
    border: '1px solid #ddd',
    width: '100%',
    marginBottom: '1rem',
  },
  infoText: {
    fontSize: '0.9rem',
    color: '#666',
    marginBottom: '1rem',
  },
  error: {
    background: '#fee2e2',
    color: '#dc2626',
    padding: '1rem',
    borderRadius: '4px',
    marginBottom: '1rem',
  },
  loading: {
    textAlign: 'center' as const,
    padding: '1rem',
    color: '#666',
  },
};

function RepoSelector() {
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [configuredRepos, setConfiguredRepos] = useState<RepoConfig[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadConfiguredRepos();
  }, []);

  async function loadConfiguredRepos() {
    try {
      const data = await api.getRepos();
      setConfiguredRepos(data);
    } catch (err) {
      console.error('Failed to load configured repos:', err);
    }
  }

  async function loadGitHubRepos() {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getGitHubRepos();
      setGithubRepos(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load GitHub repos');
    } finally {
      setLoading(false);
    }
  }

  function isConfigured(repoFullName: string): boolean {
    return configuredRepos.some((r) => r.repoFullName === repoFullName);
  }

  function getConfiguredRepo(repoFullName: string): RepoConfig | undefined {
    return configuredRepos.find((r) => r.repoFullName === repoFullName);
  }

  async function handleSave() {
    setSelectedRepo(null);
    await loadConfiguredRepos();
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Repository Configuration</h2>

      {error && <div style={styles.error}>{error}</div>}

      {/* Configured Repos */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Configured Repositories</h3>

        {configuredRepos.length === 0 ? (
          <p style={styles.infoText}>No repositories configured yet.</p>
        ) : (
          <ul style={styles.list}>
            {configuredRepos.map((repo) => (
              <li
                key={repo.repoFullName}
                style={styles.listItem}
                onClick={() => setSelectedRepo(repo.repoFullName)}
              >
                <div style={styles.repoInfo}>
                  <span style={styles.repoName}>{repo.repoFullName}</span>
                  <span style={styles.repoDesc}>
                    Profile: {repo.profile} | Path: {repo.localPath}
                  </span>
                </div>
                <span style={{ ...styles.badge, ...(repo.enabled ? styles.configuredBadge : {}) }}>
                  {repo.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Load GitHub Repos */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Add from GitHub</h3>

        <p style={styles.infoText}>
          Load your GitHub repositories to configure them for BranchRunner.
          Make sure GITHUB_TOKEN is set in your environment.
        </p>

        <button
          style={{ ...styles.button, ...styles.primaryButton, marginBottom: '1rem' }}
          onClick={loadGitHubRepos}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Load my GitHub repos'}
        </button>

        {githubRepos.length > 0 && (
          <>
            <select
              style={styles.select}
              value={selectedRepo || ''}
              onChange={(e) => setSelectedRepo(e.target.value || null)}
            >
              <option value="">Select a repository...</option>
              {githubRepos.map((repo) => (
                <option key={repo.fullName} value={repo.fullName}>
                  {repo.fullName} {isConfigured(repo.fullName) ? '(configured)' : ''}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {/* Config Form */}
      {selectedRepo && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Configure: {selectedRepo}</h3>
          <RepoConfigForm
            repoFullName={selectedRepo}
            existingConfig={getConfiguredRepo(selectedRepo)}
            onSave={handleSave}
            onCancel={() => setSelectedRepo(null)}
          />
        </div>
      )}
    </div>
  );
}

export default RepoSelector;
