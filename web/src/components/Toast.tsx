import { useEffect } from 'react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  duration?: number;
}

interface Props {
  toasts: ToastMessage[];
  onRemove: (id: string) => void;
  darkMode?: boolean;
}

const styles = {
  container: {
    position: 'fixed' as const,
    top: '1rem',
    right: '1rem',
    zIndex: 9999,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.5rem',
    maxWidth: '400px',
  },
  toast: (type: ToastMessage['type'], darkMode: boolean) => ({
    padding: '0.75rem 1rem',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.75rem',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    animation: 'slideIn 0.3s ease-out',
    ...(type === 'success' && {
      background: darkMode ? '#064e3b' : '#dcfce7',
      color: darkMode ? '#a7f3d0' : '#166534',
      borderLeft: `4px solid ${darkMode ? '#10b981' : '#22c55e'}`,
    }),
    ...(type === 'error' && {
      background: darkMode ? '#7f1d1d' : '#fee2e2',
      color: darkMode ? '#fecaca' : '#dc2626',
      borderLeft: `4px solid ${darkMode ? '#ef4444' : '#dc2626'}`,
    }),
    ...(type === 'info' && {
      background: darkMode ? '#1e3a5f' : '#dbeafe',
      color: darkMode ? '#93c5fd' : '#1e40af',
      borderLeft: `4px solid ${darkMode ? '#3b82f6' : '#2563eb'}`,
    }),
    ...(type === 'warning' && {
      background: darkMode ? '#78350f' : '#fef3c7',
      color: darkMode ? '#fcd34d' : '#92400e',
      borderLeft: `4px solid ${darkMode ? '#f59e0b' : '#d97706'}`,
    }),
  }),
  icon: {
    fontSize: '1.2rem',
    flexShrink: 0,
  },
  content: {
    flex: 1,
    fontSize: '0.9rem',
    lineHeight: 1.4,
  },
  closeButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '0',
    fontSize: '1.2rem',
    opacity: 0.6,
    color: 'inherit',
  },
};

const icons: Record<ToastMessage['type'], string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
  warning: '⚠',
};

function ToastItem({
  toast,
  onRemove,
  darkMode,
}: {
  toast: ToastMessage;
  onRemove: () => void;
  darkMode: boolean;
}) {
  useEffect(() => {
    const duration = toast.duration || 5000;
    const timer = setTimeout(onRemove, duration);
    return () => clearTimeout(timer);
  }, [toast.duration, onRemove]);

  return (
    <div style={styles.toast(toast.type, darkMode)}>
      <span style={styles.icon}>{icons[toast.type]}</span>
      <span style={styles.content}>{toast.message}</span>
      <button
        style={styles.closeButton}
        onClick={onRemove}
        aria-label="Close"
      >
        ×
      </button>
    </div>
  );
}

export function ToastContainer({ toasts, onRemove, darkMode = false }: Props) {
  return (
    <div style={styles.container}>
      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onRemove={() => onRemove(toast.id)}
          darkMode={darkMode}
        />
      ))}
    </div>
  );
}

// Hook for managing toasts
let toastIdCounter = 0;

export function useToasts() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback(
    (type: ToastMessage['type'], message: string, duration?: number) => {
      const id = `toast-${++toastIdCounter}`;
      setToasts((prev) => [...prev, { id, type, message, duration }]);
      return id;
    },
    []
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = {
    success: (message: string, duration?: number) => addToast('success', message, duration),
    error: (message: string, duration?: number) => addToast('error', message, duration),
    info: (message: string, duration?: number) => addToast('info', message, duration),
    warning: (message: string, duration?: number) => addToast('warning', message, duration),
  };

  return { toasts, toast, removeToast };
}

// Need to import these for the hook
import { useState, useCallback } from 'react';
