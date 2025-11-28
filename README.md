# BranchRunner

A local development service that receives GitHub push webhooks via Tailscale Funnel, checks out pushed branches, runs builds based on configured profiles, captures screenshots and logs, and sends detailed notifications to Slack.

## Features

- **GitHub Webhook Integration**: Receive push events from GitHub repositories
- **Multiple Build Profiles**:
  - iOS Capacitor (screenshots from iPhone Simulator)
  - Web Generic (React/Vue/Angular/Vite with Playwright screenshots)
  - Node Service (build and test)
  - Android Capacitor (stub)
  - Tauri App (stub)
- **Screenshot Capture**: Automatic screenshots of running apps
- **Log Collection**: Build, runtime, and network logs
- **Slack Notifications**: Success/failure notifications with log excerpts
- **Web UI**: Configure repos, trigger builds, view logs and screenshots
- **Tailscale Funnel**: Expose webhook endpoint securely via Tailscale

## Prerequisites

- Node.js 18+
- npm
- Tailscale (installed and configured)
- For iOS Capacitor builds:
  - Xcode with iPhone Simulator
  - iOS development tools
- For web builds:
  - Playwright will be installed automatically

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

1. Check that Tailscale Funnel is running: `tailscale funnel status`
2. Verify the webhook URL is correct in Settings
3. Check GitHub webhook delivery history in repo settings
4. Ensure `GITHUB_WEBHOOK_SECRET` matches the secret in GitHub

### iOS builds failing

1. Ensure Xcode is installed and you've agreed to the license
2. Check that the iPhone 15 Pro simulator is available: `xcrun simctl list devices`
3. Try booting the simulator manually: `xcrun simctl boot "iPhone 15 Pro"`

### Web builds failing

1. Check that the project has a `dev` or `start` script
2. Verify the correct port is configured
3. Check the build log for npm install errors

### Slack notifications not sending

1. Verify `SLACK_WEBHOOK_URL` is set correctly
2. Test the webhook in Settings
3. Check server logs for Slack API errors

## Development

### Project Structure

- **Backend**: Express + TypeScript in `server/`
- **Frontend**: React + Vite + TypeScript in `web/`
- **Config**: JSON file in `config/`
- **Data**: Logs and screenshots in `data/`

### Adding a New Profile

1. Create a new file in `server/build/profiles/`
2. Implement the `ProfileRunner` type
3. Add the profile to the switch in `server/build/runner.ts`
4. Add the profile option to the frontend

## License

MIT
