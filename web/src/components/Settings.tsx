import { useState, useEffect } from 'react';
import { api, Status } from '../apiClient';

interface Props {
  status: Status | null;
  onRefresh: () => void;
}

const styles = {
  container: {
    maxWidth: '800px',
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
  statusGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1rem',
  },
  statusItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem',
    background: '#f9f9f9',
    borderRadius: '4px',
  },
  statusDot: (active: boolean) => ({
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    background: active ? '#4ade80' : '#f87171',
    flexShrink: 0,
  }),
  statusLabel: {
    fontWeight: 500,
  },
  statusValue: {
    color: '#666',
    fontSize: '0.85rem',
  },
  field: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.5rem',
    marginBottom: '1rem',
  },
  label: {
    fontWeight: 500,
    fontSize: '0.9rem',
  },
  input: {
    padding: '0.5rem',
    borderRadius: '4px',
    border: '1px solid #ddd',
    fontSize: '0.9rem',
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
  dangerButton: {
    background: '#dc2626',
    color: '#fff',
  },
  hint: {
    fontSize: '0.8rem',
    color: '#666',
  },
  buttons: {
    display: 'flex',
    gap: '0.5rem',
    marginTop: '1rem',
  },
  success: {
    color: '#166534',
    fontSize: '0.85rem',
    padding: '0.5rem',
    background: '#dcfce7',
    borderRadius: '4px',
    marginTop: '0.5rem',
  },
  error: {
    color: '#dc2626',
    fontSize: '0.85rem',
    padding: '0.5rem',
    background: '#fee2e2',
    borderRadius: '4px',
    marginTop: '0.5rem',
  },
};

function Settings({ status, onRefresh }: Props) {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [testingSlack, setTestingSlack] = useState(false);
  const [testingTailscale, setTestingTailscale] = useState(false);
  const [runningCleanup, setRunningCleanup] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadWebhookUrl();
  }, []);

  async function loadWebhookUrl() {
    try {
      const result = await api.getWebhookUrl();
      setWebhookUrl(result.url);
    } catch (err) {
      console.error('Failed to load webhook URL:', err);
    }
  }

  async function saveWebhookUrl() {
    try {
      await api.setWebhookUrl(webhookUrl);
      setMessage({ type: 'success', text: 'Webhook URL saved' });
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to save webhook URL' });
    }
  }

  async function testSlack() {
    try {
      setTestingSlack(true);
      setMessage(null);
      const result = await api.testSlack();
      if (result.success) {
        setMessage({ type: 'success', text: 'Slack test notification sent!' });
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to send test' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to send Slack test' });
    } finally {
      setTestingSlack(false);
    }
  }

  async function testTailscale() {
    try {
      setTestingTailscale(true);
      setMessage(null);
      const result = await api.testTailscale();
      if (result.ip) {
        setMessage({ type: 'success', text: `Tailscale IP: ${result.ip}` });
      } else {
        setMessage({ type: 'error', text: 'Tailscale not connected' });
      }
      onRefresh();
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to get Tailscale IP' });
    } finally {
      setTestingTailscale(false);
    }
  }

  async function runCleanup() {
    try {
      setRunningCleanup(true);
      setMessage(null);
      const result = await api.cleanup(7);
      setMessage({
        type: 'success',
        text: `Cleanup complete: ${result.logsDeleted} logs, ${result.screenshotsDeleted} screenshots deleted`,
      });
    } catch (err) {
      setMessage({ type: 'error', text: 'Cleanup failed' });
    } finally {
      setRunningCleanup(false);
    }
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Settings</h2>

      {message && (
        <div style={message.type === 'success' ? styles.success : styles.error}>
          {message.text}
        </div>
      )}

      {/* Status Overview */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Status</h3>
        <div style={styles.statusGrid}>
          <div style={styles.statusItem}>
            <div style={styles.statusDot(!!status?.tailscaleIp)} />
            <div>
              <div style={styles.statusLabel}>Tailscale</div>
              <div style={styles.statusValue}>
                {status?.tailscaleIp || 'Not connected'}
              </div>
            </div>
          </div>

          <div style={styles.statusItem}>
            <div style={styles.statusDot(status?.githubTokenSet || false)} />
            <div>
              <div style={styles.statusLabel}>GitHub Token</div>
              <div style={styles.statusValue}>
                {status?.githubTokenSet ? 'Configured' : 'Not set'}
              </div>
            </div>
          </div>

          <div style={styles.statusItem}>
            <div style={styles.statusDot(status?.webhookSecretSet || false)} />
            <div>
              <div style={styles.statusLabel}>Webhook Secret</div>
              <div style={styles.statusValue}>
                {status?.webhookSecretSet ? 'Configured' : 'Not set'}
              </div>
            </div>
          </div>

          <div style={styles.statusItem}>
            <div style={styles.statusDot(status?.slackConfigured || false)} />
            <div>
              <div style={styles.statusLabel}>Slack</div>
              <div style={styles.statusValue}>
                {status?.slackConfigured ? 'Configured' : 'Not set'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Webhook URL */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Webhook Configuration</h3>
        <div style={styles.field}>
          <label style={styles.label}>Funnel URL</label>
          <input
            type="text"
            style={styles.input}
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://your-machine.tail12345.ts.net"
          />
          <span style={styles.hint}>
            Your Tailscale Funnel URL. This is used when creating GitHub webhooks.
            Run "tailscale funnel 443 http://localhost:3000" to set up Funnel.
          </span>
        </div>
        <button
          style={{ ...styles.button, ...styles.primaryButton }}
          onClick={saveWebhookUrl}
        >
          Save URL
        </button>
      </div>

      {/* Tests */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Connection Tests</h3>
        <div style={styles.buttons}>
          <button
            style={{ ...styles.button, ...styles.secondaryButton }}
            onClick={testSlack}
            disabled={testingSlack || !status?.slackConfigured}
          >
            {testingSlack ? 'Sending...' : 'Test Slack Notification'}
          </button>

          <button
            style={{ ...styles.button, ...styles.secondaryButton }}
            onClick={testTailscale}
            disabled={testingTailscale}
          >
            {testingTailscale ? 'Testing...' : 'Test Tailscale IP'}
          </button>
        </div>
      </div>

      {/* Cleanup */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Maintenance</h3>
        <p style={styles.hint}>
          Delete logs and screenshots older than 7 days to free up disk space.
        </p>
        <div style={styles.buttons}>
          <button
            style={{ ...styles.button, ...styles.dangerButton }}
            onClick={runCleanup}
            disabled={runningCleanup}
          >
            {runningCleanup ? 'Cleaning...' : 'Run Cleanup'}
          </button>
        </div>
      </div>

      {/* Environment Info */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Environment Variables</h3>
        <p style={styles.hint}>
          The following environment variables must be set when starting the server:
        </p>
        <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', color: '#666' }}>
          <li><code>GITHUB_TOKEN</code> - GitHub Personal Access Token (repo, admin:repo_hook scopes)</li>
          <li><code>GITHUB_WEBHOOK_SECRET</code> - Secret for validating webhook signatures</li>
          <li><code>SLACK_WEBHOOK_URL</code> - Slack incoming webhook URL</li>
        </ul>
      </div>
    </div>
  );
}

export default Settings;
