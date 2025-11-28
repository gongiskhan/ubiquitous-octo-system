import { useState } from 'react';
import { api, RepoConfig } from '../apiClient';

interface Props {
  repoFullName: string;
  existingConfig?: RepoConfig;
  onSave: () => void;
  onCancel: () => void;
}

const PROFILES = [
  { value: 'ios-capacitor', label: 'iOS Capacitor' },
  { value: 'web-generic', label: 'Web Generic (React/Vue/Angular/Vite)' },
  { value: 'node-service', label: 'Node Service' },
  { value: 'android-capacitor', label: 'Android Capacitor (stub)' },
  { value: 'tauri-app', label: 'Tauri App (stub)' },
  { value: 'custom', label: 'Custom (stub)' },
];

const styles = {
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '1rem',
  },
  field: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.25rem',
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
  select: {
    padding: '0.5rem',
    borderRadius: '4px',
    border: '1px solid #ddd',
    fontSize: '0.9rem',
  },
  checkbox: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  buttons: {
    display: 'flex',
    gap: '0.5rem',
    marginTop: '1rem',
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
  successButton: {
    background: '#16a34a',
    color: '#fff',
  },
  error: {
    color: '#dc2626',
    fontSize: '0.85rem',
    padding: '0.5rem',
    background: '#fee2e2',
    borderRadius: '4px',
  },
  success: {
    color: '#166534',
    fontSize: '0.85rem',
    padding: '0.5rem',
    background: '#dcfce7',
    borderRadius: '4px',
  },
  hint: {
    fontSize: '0.8rem',
    color: '#666',
  },
  webhookSection: {
    padding: '1rem',
    background: '#f9f9f9',
    borderRadius: '4px',
    marginTop: '0.5rem',
  },
};

function RepoConfigForm({ repoFullName, existingConfig, onSave, onCancel }: Props) {
  const [localPath, setLocalPath] = useState(existingConfig?.localPath || '');
  const [profile, setProfile] = useState(existingConfig?.profile || 'web-generic');
  const [devPort, setDevPort] = useState(existingConfig?.devPort || 3000);
  const [enabled, setEnabled] = useState(existingConfig?.enabled ?? true);
  const [webhookId, setWebhookId] = useState(existingConfig?.webhookId);

  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [creatingWebhook, setCreatingWebhook] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSave() {
    if (!localPath.trim()) {
      setError('Local path is required');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      await api.addRepo({
        repoFullName,
        localPath: localPath.trim(),
        profile: profile as RepoConfig['profile'],
        devPort,
        enabled,
        webhookId,
      });

      setSuccess('Configuration saved');
      setTimeout(() => onSave(), 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete configuration for ${repoFullName}?`)) {
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await api.deleteRepo(repoFullName);
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setSaving(false);
    }
  }

  async function handleDetectProfile() {
    if (!localPath.trim()) {
      setError('Enter local path first');
      return;
    }

    try {
      setDetecting(true);
      setError(null);
      const result = await api.detectProfile(localPath.trim());
      setProfile(result.profile as RepoConfig['profile']);
      setDevPort(result.devPort);
      setSuccess(`Detected: ${result.profile}, port ${result.devPort}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to detect profile');
    } finally {
      setDetecting(false);
    }
  }

  async function handleCreateWebhook() {
    try {
      setCreatingWebhook(true);
      setError(null);

      // First save the config to ensure it exists
      await api.addRepo({
        repoFullName,
        localPath: localPath.trim(),
        profile: profile as RepoConfig['profile'],
        devPort,
        enabled,
      });

      const result = await api.createWebhook(repoFullName);
      setWebhookId(result.webhook.id);
      setSuccess(`Webhook created (ID: ${result.webhook.id})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create webhook');
    } finally {
      setCreatingWebhook(false);
    }
  }

  async function handleDeleteWebhook() {
    if (!webhookId) return;

    try {
      setCreatingWebhook(true);
      setError(null);
      await api.deleteWebhook(repoFullName);
      setWebhookId(undefined);
      setSuccess('Webhook deleted');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete webhook');
    } finally {
      setCreatingWebhook(false);
    }
  }

  return (
    <div style={styles.form}>
      {error && <div style={styles.error}>{error}</div>}
      {success && <div style={styles.success}>{success}</div>}

      <div style={styles.field}>
        <label style={styles.label}>Local Path</label>
        <input
          type="text"
          style={styles.input}
          value={localPath}
          onChange={(e) => setLocalPath(e.target.value)}
          placeholder="/Users/you/projects/my-repo"
        />
        <span style={styles.hint}>Absolute path to the local clone of this repository</span>
      </div>

      <div style={styles.field}>
        <label style={styles.label}>Profile</label>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <select
            style={{ ...styles.select, flex: 1 }}
            value={profile}
            onChange={(e) => setProfile(e.target.value as RepoConfig['profile'])}
          >
            {PROFILES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <button
            style={{ ...styles.button, ...styles.secondaryButton }}
            onClick={handleDetectProfile}
            disabled={detecting || !localPath}
          >
            {detecting ? 'Detecting...' : 'Auto-detect'}
          </button>
        </div>
      </div>

      {profile === 'web-generic' && (
        <div style={styles.field}>
          <label style={styles.label}>Dev Server Port</label>
          <input
            type="number"
            style={styles.input}
            value={devPort}
            onChange={(e) => setDevPort(parseInt(e.target.value) || 3000)}
          />
          <span style={styles.hint}>Port where the dev server runs (e.g., 3000, 5173, 4200)</span>
        </div>
      )}

      <div style={styles.checkbox}>
        <input
          type="checkbox"
          id="enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <label htmlFor="enabled">Enabled (process webhooks for this repo)</label>
      </div>

      <div style={styles.webhookSection}>
        <label style={styles.label}>GitHub Webhook</label>
        {webhookId ? (
          <div style={{ marginTop: '0.5rem' }}>
            <p style={styles.hint}>Webhook ID: {webhookId}</p>
            <button
              style={{ ...styles.button, ...styles.dangerButton, marginTop: '0.5rem' }}
              onClick={handleDeleteWebhook}
              disabled={creatingWebhook}
            >
              Delete Webhook
            </button>
          </div>
        ) : (
          <div style={{ marginTop: '0.5rem' }}>
            <p style={styles.hint}>
              Create a webhook to receive push events from GitHub.
              Make sure you've configured your Tailscale Funnel URL in Settings first.
            </p>
            <button
              style={{ ...styles.button, ...styles.successButton, marginTop: '0.5rem' }}
              onClick={handleCreateWebhook}
              disabled={creatingWebhook || !localPath}
            >
              {creatingWebhook ? 'Creating...' : 'Create Webhook'}
            </button>
          </div>
        )}
      </div>

      <div style={styles.buttons}>
        <button
          style={{ ...styles.button, ...styles.primaryButton }}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
        <button
          style={{ ...styles.button, ...styles.secondaryButton }}
          onClick={onCancel}
        >
          Cancel
        </button>
        {existingConfig && (
          <button
            style={{ ...styles.button, ...styles.dangerButton, marginLeft: 'auto' }}
            onClick={handleDelete}
            disabled={saving}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

export default RepoConfigForm;
