import { useState, useRef, useEffect } from 'react';

interface Props {
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  darkMode?: boolean;
}

const styles = {
  container: {
    position: 'relative' as const,
    overflow: 'hidden',
    cursor: 'zoom-in',
  },
  image: {
    width: '100%',
    height: 'auto',
    display: 'block',
    transition: 'transform 0.1s ease-out',
  },
  modal: (darkMode: boolean) => ({
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: darkMode ? 'rgba(0,0,0,0.95)' : 'rgba(0,0,0,0.9)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    cursor: 'zoom-out',
  }),
  modalImage: {
    maxWidth: '95vw',
    maxHeight: '95vh',
    objectFit: 'contain' as const,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  },
  controls: {
    position: 'absolute' as const,
    bottom: '1rem',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: '0.5rem',
    background: 'rgba(0,0,0,0.7)',
    padding: '0.5rem 1rem',
    borderRadius: '8px',
  },
  controlButton: {
    background: 'rgba(255,255,255,0.2)',
    border: 'none',
    color: '#fff',
    padding: '0.5rem 1rem',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1rem',
  },
  closeButton: {
    position: 'absolute' as const,
    top: '1rem',
    right: '1rem',
    background: 'rgba(255,255,255,0.2)',
    border: 'none',
    color: '#fff',
    padding: '0.75rem',
    borderRadius: '50%',
    cursor: 'pointer',
    fontSize: '1.5rem',
    width: '48px',
    height: '48px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomLevel: {
    color: '#fff',
    fontSize: '0.9rem',
    display: 'flex',
    alignItems: 'center',
    minWidth: '60px',
    justifyContent: 'center',
  },
  loading: {
    position: 'absolute' as const,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    color: '#666',
  },
  error: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#666',
    fontStyle: 'italic',
    height: '100%',
    minHeight: '100px',
  },
};

export function ZoomableImage({ src, alt, className, style, darkMode = false }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      setZoom(1);
      setPosition({ x: 0, y: 0 });
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        setIsOpen(false);
      } else if (e.key === '+' || e.key === '=') {
        setZoom((z) => Math.min(z + 0.25, 5));
      } else if (e.key === '-') {
        setZoom((z) => Math.max(z - 0.25, 0.25));
      } else if (e.key === '0') {
        setZoom(1);
        setPosition({ x: 0, y: 0 });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleWheel = (e: React.WheelEvent) => {
    if (!isOpen) return;
    e.preventDefault();

    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom((z) => Math.max(0.25, Math.min(5, z + delta)));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleModalClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isDragging) {
      setIsOpen(false);
    }
  };

  if (error) {
    return (
      <div style={{ ...styles.error, ...style }} className={className}>
        No screenshot available
      </div>
    );
  }

  return (
    <>
      <div
        style={{ ...styles.container, ...style }}
        className={className}
        onClick={() => !loading && setIsOpen(true)}
      >
        {loading && <span style={styles.loading}>Loading...</span>}
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          style={{ ...styles.image, opacity: loading ? 0 : 1 }}
          onLoad={() => setLoading(false)}
          onError={() => {
            setError(true);
            setLoading(false);
          }}
        />
      </div>

      {isOpen && (
        <div
          style={styles.modal(darkMode)}
          onClick={handleModalClick}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <img
            src={src}
            alt={alt}
            style={{
              ...styles.modalImage,
              transform: `scale(${zoom}) translate(${position.x / zoom}px, ${position.y / zoom}px)`,
              cursor: isDragging ? 'grabbing' : zoom > 1 ? 'grab' : 'zoom-out',
            }}
          />

          <button
            style={styles.closeButton}
            onClick={() => setIsOpen(false)}
            title="Close (Esc)"
          >
            ×
          </button>

          <div style={styles.controls}>
            <button
              style={styles.controlButton}
              onClick={(e) => {
                e.stopPropagation();
                setZoom((z) => Math.max(z - 0.25, 0.25));
              }}
              title="Zoom out (-)"
            >
              −
            </button>
            <span style={styles.zoomLevel}>{Math.round(zoom * 100)}%</span>
            <button
              style={styles.controlButton}
              onClick={(e) => {
                e.stopPropagation();
                setZoom((z) => Math.min(z + 0.25, 5));
              }}
              title="Zoom in (+)"
            >
              +
            </button>
            <button
              style={styles.controlButton}
              onClick={(e) => {
                e.stopPropagation();
                setZoom(1);
                setPosition({ x: 0, y: 0 });
              }}
              title="Reset (0)"
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default ZoomableImage;
