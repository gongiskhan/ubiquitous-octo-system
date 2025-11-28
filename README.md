# BranchRunner

A local development service that receives GitHub push webhooks via Tailscale Funnel, checks out pushed branches, runs builds based on configured profiles, captures screenshots and logs, and sends detailed notifications to Slack.

## Features

- **GitHub Webhook Integration**: Receive push events from GitHub repositories with automatic webhook creation
- **FIFO Build Queue**: Processes builds sequentially with deduplication (same repo+branch only queued once)
- **Multiple Build Profiles**:
  - iOS Capacitor (screenshots from iPhone Simulator with auto-detection of available simulators)
  - Web Generic (React/Vue/Angular/Vite with Playwright screenshots)
  - Node Service (build and test)
  - Android Capacitor (stub)
  - Tauri App (stub)
- **Screenshot Capture**: Automatic screenshots of running apps
- **Log Collection**: Build, runtime, and network logs per run
- **Slack Notifications**: Success/failure notifications with log excerpts (last 30 lines)
- **Web UI**: Configure repos, trigger builds, view logs and screenshots with real-time updates
- **Tailscale Funnel**: Expose webhook endpoint securely via Tailscale
- **Admin Tools**: Cleanup old runs, clear queue, reset branches to main

## Prerequisites

- Node.js 18+ (LTS recommended)
- npm 9+
- Git (for cloning repos and branch switching)
- Tailscale (installed, logged in, and configured)
- For iOS Capacitor builds:
  - macOS only
  - Xcode 14+ with iPhone Simulator
  - Xcode Command Line Tools: `xcode-select --install`
  - At least one iOS Simulator available (iPhone 15 Pro preferred)
- For web builds:
  - Playwright will be installed automatically
  - Chromium browser (installed by Playwright)

## Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd branchrunner

# Install dependencies
npm install

# This also runs postinstall to install web dependencies
```

## Environment Variables

Create a `.env` file or export these variables:

```bash
# Required: GitHub Personal Access Token
# Scopes needed: repo, admin:repo_hook
export GITHUB_TOKEN="ghp_..."

# Required: Secret for validating GitHub webhook signatures
# Generate with: openssl rand -hex 32
export GITHUB_WEBHOOK_SECRET="your-secret-here"

# Optional: Slack incoming webhook URL for notifications
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."

# Optional: Log level (debug, info, warn, error)
export LOG_LEVEL="info"

# Optional: Server port (default: 3000)
export PORT=3000
```

## Running the Server

### Development Mode

```bash
# Run backend and frontend concurrently
npm run dev

# Or run them separately:
npm run dev:server  # Backend on port 3000
npm run dev:web     # Frontend on port 5173 (proxies to backend)
```

### Production Mode

```bash
# Build everything
npm run build

# Start the server
npm start
```

## Configuring Tailscale Funnel

BranchRunner needs to be accessible from the internet so GitHub can send webhooks. Tailscale Funnel provides a secure way to expose your local server.

1. **Ensure Tailscale is running and you're logged in:**
   ```bash
   tailscale status
   ```

2. **Enable Funnel for your account** (if not already enabled):
   - Visit https://login.tailscale.com/admin/dns
   - Enable "Funnel" in the Features section

3. **Expose the server:**
   ```bash
   tailscale funnel 443 http://localhost:3000
   ```

4. **Note your Funnel URL:**
   The URL will be something like `https://your-machine.tail12345.ts.net`

5. **Configure the webhook URL in BranchRunner:**
   - Open the web UI at http://localhost:5173 (dev) or http://localhost:3000 (prod)
   - Go to Settings
   - Enter your Funnel URL in the "Funnel URL" field
   - Save

## Setting Up Your First Repository

1. **Open the web UI:**
   - Development: http://localhost:5173
   - Production: http://localhost:3000

2. **Go to the Repos tab**

3. **Click "Load my GitHub repos"** to fetch your repositories

4. **Select a repository** to configure:
   - **Local Path**: Absolute path to your local clone (e.g., `/Users/you/projects/my-app`)
   - **Profile**: Choose the appropriate build profile
   - **Dev Port**: For web apps, specify the dev server port
   - **Enabled**: Toggle to enable/disable webhook processing

5. **Click "Auto-detect"** to automatically detect the profile and port

6. **Click "Create Webhook"** to set up the GitHub webhook
   - If webhook already exists (409): You'll see a message that it's already configured
   - If you lack permissions (403/404): Ensure your GitHub token has `admin:repo_hook` scope
   - If validation fails (422): Check your Funnel URL is accessible from the internet

7. **Click "Save Configuration"**

## Build Profiles

### iOS Capacitor (`ios-capacitor`)

Builds and runs Capacitor iOS apps in the simulator:

1. Runs `npm ci`
2. Runs `npx cap sync ios`
3. Boots iPhone 15 Pro simulator
4. Runs the app with `npx cap run ios`
5. Waits for app to launch
6. Takes simulator screenshot
7. Captures iOS device logs

**Requirements:**
- Xcode installed
- iPhone Simulator available
- Project has `ios/` folder and Capacitor configured

### Web Generic (`web-generic`)

Builds and screenshots web applications:

1. Runs `npm ci`
2. Detects and runs dev script (`npm run dev` or `npm run start`)
3. Waits for dev server to start
4. Launches Chromium via Playwright
5. Navigates to the app
6. Captures console and network logs
7. Takes full-page screenshot
8. Cleans up

**Requirements:**
- Project has a dev/start script in package.json
- Playwright is included as a dependency

### Node Service (`node-service`)

Runs build and tests for Node.js services:

1. Runs `npm ci`
2. Runs `npm run build` (if present)
3. Runs `npm test` (if present)

### Stubs

- **Android Capacitor** (`android-capacitor`): Not yet implemented
- **Tauri App** (`tauri-app`): Not yet implemented
- **Custom** (`custom`): Placeholder for user-defined profiles

## Build Queue

BranchRunner processes builds using a FIFO (First In, First Out) queue:

### How It Works

1. **Enqueue**: When a webhook arrives or manual trigger is requested, the job is added to the queue
2. **Deduplication**: If a job for the same repo+branch is already queued, it's replaced (not duplicated)
3. **Processing**: Jobs are processed one at a time in order
4. **Status**: The UI shows real-time queue status with running and queued indicators

### Queue Behavior

- Jobs are added via:
  - GitHub push webhooks (automatic)
  - Manual "Run main" button in the UI
  - API call to `/api/trigger-run`
- The queue persists in memory (clears on server restart)
- Use `/api/admin/clear-queue` to clear all pending jobs

### Viewing Queue Status

The Dashboard header shows:
- Number of queued jobs
- Whether a job is currently running
- Per-repo indicators for running/queued state

## API Endpoints

### Webhook

- `POST /webhook` - GitHub webhook receiver

### Configuration

- `GET /api/config/repos` - List configured repos
- `POST /api/config/repos` - Add/update repo config
- `PATCH /api/config/repos/:repoFullName` - Update repo config
- `DELETE /api/config/repos/:repoFullName` - Delete repo config
- `POST /api/config/repos/:repoFullName/create-webhook` - Create GitHub webhook

### GitHub

- `GET /api/github/repos` - List GitHub repos (from token)
- `GET /api/github/repos/:repoFullName/branches` - List branches

### Builds

- `POST /api/trigger-run` - Trigger a build manually
- `GET /api/queue` - Get queue status
- `GET /api/runs/:repoFullName` - Get run history

### Logs

- `GET /api/logs/:repoFullName/branches/:branch/runs/:runId/build` - Get build log
- `GET /api/logs/:repoFullName/branches/:branch/runs/:runId/runtime` - Get runtime log
- `GET /api/logs/:repoFullName/branches/:branch/runs/:runId/network` - Get network log

### Preview

- `GET /preview/:repoFullName/:branch.png` - Get latest screenshot

### Status

- `GET /api/status` - Get server status
- `GET /health` - Health check

### Admin

- `POST /api/admin/cleanup` - Clean up old runs and branches
  - Body: `{ "olderThanDays": 7, "dryRun": true, "resetToMain": false }`
  - `olderThanDays`: Delete runs older than this (default: 7)
  - `dryRun`: If true, only reports what would be deleted (default: false)
  - `resetToMain`: If true, resets all repos to main branch after cleanup (default: false)
- `POST /api/admin/clear-queue` - Clear all queued jobs (does not affect running job)

## Directory Structure

```
branchrunner/
├── config/
│   └── config.json          # Persistent configuration
├── data/
│   ├── logs/                 # Build and runtime logs
│   │   └── owner_repo/
│   │       └── branch/
│   │           └── run-id/
│   │               ├── build.log
│   │               ├── runtime.log
│   │               └── network.log
│   └── screenshots/          # Captured screenshots
│       └── owner_repo/
│           └── branch/
│               └── run-id.png
├── server/                   # Backend TypeScript source
│   ├── index.ts
│   ├── config.ts
│   ├── github/
│   ├── build/
│   │   └── profiles/
│   ├── logging/
│   ├── slack/
│   ├── tailscale/
│   └── routes/
├── web/                      # React frontend
│   ├── src/
│   │   ├── App.tsx
│   │   ├── apiClient.ts
│   │   └── components/
│   └── index.html
├── package.json
├── tsconfig.json
└── README.md
```

## Troubleshooting

### Webhook not receiving events

1. **Check Tailscale Funnel is running:**
   ```bash
   tailscale funnel status
   ```

2. **Verify webhook URL in Settings:**
   - Open the UI and go to Settings
   - Ensure the Funnel URL matches your Tailscale hostname
   - URL should be like: `https://your-machine.tail12345.ts.net`

3. **Check GitHub webhook delivery:**
   - Go to your repo on GitHub → Settings → Webhooks
   - Click the webhook to see recent deliveries
   - Check response codes and error messages

4. **Verify webhook secret:**
   - Ensure `GITHUB_WEBHOOK_SECRET` environment variable matches the secret in GitHub
   - Regenerate if unsure: `openssl rand -hex 32`

5. **Check server logs:**
   - Look for webhook validation errors in terminal output
   - Common errors: invalid signature, missing headers

### iOS builds failing

1. **Check Xcode installation:**
   ```bash
   xcode-select -p
   # Should show: /Applications/Xcode.app/Contents/Developer
   ```

2. **Accept Xcode license:**
   ```bash
   sudo xcodebuild -license accept
   ```

3. **List available simulators:**
   ```bash
   xcrun simctl list devices available
   ```
   BranchRunner auto-detects available simulators (prefers iPhone 15 Pro, falls back to others).

4. **Boot simulator manually to test:**
   ```bash
   xcrun simctl boot "iPhone 15 Pro"
   open -a Simulator
   ```

5. **Check iOS folder exists:**
   - Project must have an `ios/` folder
   - Run `npx cap add ios` if missing

6. **View build logs:**
   - Go to Logs tab in UI
   - Select the repo and failed run
   - Check Build Log for specific errors

### Web builds failing

1. **Check for dev script:**
   ```bash
   cat package.json | grep -A5 '"scripts"'
   ```
   Project needs `dev`, `start`, or `serve` script.

2. **Verify port configuration:**
   - Check the configured port in repo settings
   - Ensure it matches the dev server port
   - Common ports: 3000, 5173, 4200, 8080

3. **Check for port conflicts:**
   ```bash
   lsof -i :3000  # Replace with your port
   ```
   BranchRunner auto-kills processes on the port, but conflicts can occur.

4. **View build and runtime logs:**
   - Build Log: npm ci output, startup messages
   - Runtime Log: console.log output, React errors
   - Network Log: HTTP requests made by the app

5. **Playwright issues:**
   ```bash
   npx playwright install chromium
   ```

### Slack notifications not sending

1. **Verify webhook URL:**
   - Check `SLACK_WEBHOOK_URL` in environment
   - Format: `https://hooks.slack.com/services/T.../B.../...`

2. **Test webhook manually:**
   ```bash
   curl -X POST -H 'Content-type: application/json' \
     --data '{"text":"Test message"}' \
     "$SLACK_WEBHOOK_URL"
   ```

3. **Check Slack app configuration:**
   - Verify the app is installed in your workspace
   - Check the channel is correct

4. **View server logs:**
   - Look for "Failed to send Slack notification" errors

### Build stuck or queue not processing

1. **Check queue status:**
   - Dashboard shows queue count in header
   - Use `/api/queue` endpoint for details

2. **Clear the queue:**
   ```bash
   curl -X POST http://localhost:3000/api/admin/clear-queue
   ```

3. **Restart the server:**
   - Queue is memory-only, restart clears it
   - Any running build will be killed

### Debugging builds locally

1. **View all logs for a run:**
   ```
   data/logs/{owner}_{repo}/{branch}/{run-id}/
   ├── build.log    # npm ci, build commands
   ├── runtime.log  # App console output
   └── network.log  # HTTP requests (web only)
   ```

2. **View screenshots:**
   ```
   data/screenshots/{owner}_{repo}/{branch}/{run-id}.png
   ```

3. **Trigger a test build:**
   - Use "Run main" button in Dashboard
   - Or via API:
   ```bash
   curl -X POST http://localhost:3000/api/trigger-run-main \
     -H 'Content-Type: application/json' \
     -d '{"repoFullName": "owner/repo"}'
   ```

## Slack Notifications

BranchRunner sends Slack notifications for build success and failure:

### Notification Format

**Success:**
```
✅ Build succeeded
owner/repo @ branch
Profile: web-generic
View screenshot: https://your-funnel.ts.net/preview/owner/repo/branch.png
```

**Failure:**
```
❌ Build failed
owner/repo @ branch
Profile: ios-capacitor
Error: npm ci failed

Last 30 lines of build log:
[log excerpt...]
```

### Configuration

1. Create a Slack incoming webhook at https://api.slack.com/messaging/webhooks
2. Set `SLACK_WEBHOOK_URL` environment variable
3. Notifications are sent automatically after each build

## Development

### Project Structure

- **Backend**: Express + TypeScript in `server/`
- **Frontend**: React + Vite + TypeScript in `web/`
- **Config**: JSON file in `config/`
- **Data**: Logs and screenshots in `data/`

### Adding a New Profile

1. Create a new file in `server/build/profiles/yourProfile.ts`:
   ```typescript
   import type { ProfileContext, ProfileResult } from './profileTypes.js';

   export async function runYourProfile(ctx: ProfileContext): Promise<ProfileResult> {
     const { localPath, branch, runId, logsDir, screenshotsDir } = ctx;

     // Your build logic here

     return {
       status: 'success',
       screenshotPath: '/path/to/screenshot.png',
       buildLogPath: '/path/to/build.log',
     };
   }
   ```

2. Add the profile to `server/build/runner.ts`:
   ```typescript
   import { runYourProfile } from './profiles/yourProfile.js';

   // In the switch statement:
   case 'your-profile':
     return runYourProfile(context);
   ```

3. Add the profile option to `web/src/components/RepoConfigForm.tsx`:
   ```typescript
   <option value="your-profile">Your Profile</option>
   ```

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

### Code Style

- TypeScript strict mode enabled
- ESLint for linting
- Prettier for formatting (optional)

### Building for Production

```bash
# Build both backend and frontend
npm run build

# Backend output: dist/
# Frontend output: web/dist/
```

## Cleanup and Maintenance

### Automatic Cleanup

Schedule a cron job to clean old runs:

```bash
# Clean runs older than 7 days, nightly at 2am
0 2 * * * curl -X POST http://localhost:3000/api/admin/cleanup \
  -H 'Content-Type: application/json' \
  -d '{"olderThanDays": 7}'
```

### Manual Cleanup

```bash
# Preview what would be deleted (dry run)
curl -X POST http://localhost:3000/api/admin/cleanup \
  -H 'Content-Type: application/json' \
  -d '{"olderThanDays": 7, "dryRun": true}'

# Actually delete old runs
curl -X POST http://localhost:3000/api/admin/cleanup \
  -H 'Content-Type: application/json' \
  -d '{"olderThanDays": 7}'

# Delete and reset all repos to main branch
curl -X POST http://localhost:3000/api/admin/cleanup \
  -H 'Content-Type: application/json' \
  -d '{"olderThanDays": 7, "resetToMain": true}'
```

### Disk Space

Monitor disk usage in the `data/` directory:
```bash
du -sh data/logs data/screenshots
```

## License

MIT
