import { useState } from 'react';
import { getScreenshotUrl } from '../apiClient';

interface Props {
  repoFullName: string;
  branch: string;
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '1rem',
  },
  imageContainer: {
    width: '100%',
    background: '#f5f5f5',
    borderRadius: '4px',
    overflow: 'hidden',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '200px',
  },
  image: {
    maxWidth: '100%',
    height: 'auto',
  },
  error: {
    color: '#666',
    fontStyle: 'italic',
  },
  link: {
    color: '#1a1a2e',
    textDecoration: 'underline',
    fontSize: '0.85rem',
  },
};

function ScreenshotView({ repoFullName, branch }: Props) {
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const url = getScreenshotUrl(repoFullName, branch);

  return (
    <div style={styles.container}>
      <div style={styles.imageContainer}>
        {error ? (
          <span style={styles.error}>No screenshot available</span>
        ) : (
          <img
            src={url}
            alt={`Screenshot for ${repoFullName}/${branch}`}
            style={{ ...styles.image, display: loading ? 'none' : 'block' }}
            onLoad={() => setLoading(false)}
            onError={() => {
              setError(true);
              setLoading(false);
            }}
          />
        )}
        {loading && !error && <span style={styles.error}>Loading...</span>}
      </div>

      {!error && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={styles.link}
        >
          Open in new tab
        </a>
      )}
    </div>
  );
}

export default ScreenshotView;
