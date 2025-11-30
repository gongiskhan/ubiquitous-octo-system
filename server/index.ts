import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from './config.js';
import { info, error as logError, setLogLevel } from './logging/logger.js';
import webhookRouter from './github/webhooks.js';
import uiApiRouter from './routes/uiApi.js';
import previewRouter from './routes/preview.js';
import { getTailscaleIp } from './tailscale/ip.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || '3892', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  // Set log level from environment
  const logLevel = process.env.LOG_LEVEL || 'info';
  if (logLevel === 'debug' || logLevel === 'info' || logLevel === 'warn' || logLevel === 'error') {
    setLogLevel(logLevel);
  }

  info('Starting BranchRunner server...', 'Server');

  // Load config on startup
  try {
    loadConfig();
    info('Configuration loaded', 'Server');
  } catch (error) {
    logError(`Failed to load config: ${error}`, 'Server');
    process.exit(1);
  }

  // Create Express app
  const app = express();

  // Middleware
  app.use(cors({
    origin: true,
    credentials: true,
  }));

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Request logging
  app.use((req, _res, next) => {
    if (!req.path.startsWith('/preview')) {
      info(`${req.method} ${req.path}`, 'HTTP');
    }
    next();
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Mount routes
  app.use('/webhook', webhookRouter);
  app.use('/api', uiApiRouter);
  app.use('/preview', previewRouter);

  // Serve static frontend in production
  const webDistPath = join(__dirname, '..', 'web', 'dist');
  app.use(express.static(webDistPath));

  // SPA fallback
  app.get('*', (req, res, next) => {
    // Don't interfere with API routes
    if (req.path.startsWith('/api') || req.path.startsWith('/webhook') || req.path.startsWith('/preview')) {
      next();
      return;
    }
    res.sendFile(join(webDistPath, 'index.html'), (err) => {
      if (err) {
        res.status(200).send(`
          <!DOCTYPE html>
          <html>
          <head><title>BranchRunner</title></head>
          <body>
            <h1>BranchRunner</h1>
            <p>Frontend not built. Run <code>npm run build:web</code> or <code>npm run dev:web</code></p>
            <p>API is available at <a href="/api/status">/api/status</a></p>
          </body>
          </html>
        `);
      }
    });
  });

  // Error handling
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logError(`Unhandled error: ${err.message}`, 'Server');
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
  });

  // Start server
  app.listen(PORT, HOST, async () => {
    info(`Server listening on http://${HOST}:${PORT}`, 'Server');

    // Try to get Tailscale IP
    try {
      const tailscaleIp = await getTailscaleIp();
      if (tailscaleIp) {
        info(`Tailscale IP: ${tailscaleIp}`, 'Server');
        info(`Access via Tailscale: http://${tailscaleIp}:${PORT}`, 'Server');
      }
    } catch {
      info('Tailscale not available', 'Server');
    }

    info('', 'Server');
    info('=== BranchRunner Ready ===', 'Server');
    info('', 'Server');
    info('Endpoints:', 'Server');
    info(`  Webhook:    POST http://localhost:${PORT}/webhook`, 'Server');
    info(`  API:        http://localhost:${PORT}/api/*`, 'Server');
    info(`  Preview:    http://localhost:${PORT}/preview/*`, 'Server');
    info(`  Frontend:   http://localhost:${PORT}/`, 'Server');
    info('', 'Server');
    info('Environment checks:', 'Server');
    info(`  GITHUB_TOKEN:          ${process.env.GITHUB_TOKEN ? 'Set' : 'NOT SET'}`, 'Server');
    info(`  GITHUB_WEBHOOK_SECRET: ${process.env.GITHUB_WEBHOOK_SECRET ? 'Set' : 'NOT SET'}`, 'Server');
    info(`  SLACK_WEBHOOK_URL:     ${process.env.SLACK_WEBHOOK_URL ? 'Set' : 'NOT SET'}`, 'Server');
    info('', 'Server');
  });
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  info('SIGTERM received, shutting down...', 'Server');
  process.exit(0);
});

process.on('SIGINT', () => {
  info('SIGINT received, shutting down...', 'Server');
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logError(`Uncaught exception: ${error.message}`, 'Server');
  console.error(error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logError(`Unhandled rejection: ${reason}`, 'Server');
  process.exit(1);
});

main().catch((error) => {
  logError(`Failed to start server: ${error}`, 'Server');
  process.exit(1);
});
