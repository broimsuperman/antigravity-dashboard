# CLAUDE.md

This file provides guidance for Claude when working with this codebase.

## Project Overview

Antigravity Dashboard is a monitoring solution for opencode-antigravity-auth plugin. It displays real-time quota and usage data for multiple Google Cloud accounts authenticated via the antigravity OAuth flow.

## Tech Stack

**Backend:**
- Node.js with Express
- TypeScript
- SQLite (better-sqlite3) for usage logging
- WebSocket for live updates

**Frontend:**
- React 18 with TypeScript
- Vite build tool
- Tailwind CSS
- Zustand for state management
- Recharts for data visualization

## Project Structure

This is a monorepo using npm workspaces.

```
├── apps/
│   ├── backend/                 # @antigravity/backend
│   │   ├── src/
│   │   │   ├── server.ts       # Express server, API endpoints, WebSocket
│   │   │   ├── monitor.ts      # SQLite operations
│   │   │   ├── interceptor.ts  # Request interception
│   │   │   └── services/
│   │   │       ├── quotaService.ts  # Google Cloud Code API integration
│   │   │       ├── accountsFile.ts  # Accounts file watcher
│   │   │       └── websocket.ts     # WebSocket manager
│   │   └── dist/               # Compiled backend
│   │
│   └── web/                    # @antigravity/web
│       ├── src/
│       │   ├── App.tsx        # Main dashboard component
│       │   ├── hooks/         # useQuota, useWebSocket
│       │   ├── stores/        # Zustand store
│       │   └── types/         # TypeScript interfaces
│       └── dist/              # Built frontend (served by Express)
│
├── package.json               # Root workspace config
└── usage.db                   # SQLite database
```

## Key Commands

```bash
npm install                    # Install all dependencies (workspaces)
npm run build                  # Build both backend and frontend
npm start                      # Start the server (port 3456)
npm run dev                    # Dev mode for all packages
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/accounts/local` | GET | List all accounts with status |
| `/api/accounts/quota` | GET | Get cached quota data |
| `/api/accounts/quota/refresh` | POST | Force refresh quotas |
| `/api/stats` | GET | Usage statistics |
| `/api/analytics/overview` | GET | Combined analytics |
| `/api/analytics/performance` | GET | Performance metrics |
| `/api/manager/*` | GET/POST | Proxy to antigravity-manager |
| `/ws` | WebSocket | Live updates |

## Quota Service

The quota service fetches data from Google's undocumented Cloud Code API:
- Endpoint: `https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels`
- Requires OAuth access token (refreshed from stored refresh tokens)
- Returns `remainingFraction` (0.0-1.0) and `resetTime` per model
- Polls every 2 minutes by default

## Configuration

Accounts are stored in: `~/.config/opencode/antigravity-accounts.json`

Each account has:
- `email`: Account identifier
- `refreshToken`: OAuth refresh token
- `projectId`: Google Cloud project ID

Environment variables (`.env`):
- `DASHBOARD_PORT`: Server port (default: 3456)
- `MANAGER_URL`: antigravity-manager URL (default: http://localhost:8080)
- `DB_PATH`: Custom database path

## Development

Frontend dev server (with hot reload):
```bash
cd apps/web && npm run dev
```

Backend watch mode:
```bash
cd apps/backend && npm run dev
```

The Vite dev server proxies `/api` and `/ws` to the backend on port 3456.

## Code Style

- TypeScript strict mode enabled
- Functional React components with hooks
- Tailwind for styling (no CSS modules)
- Dark theme with CSS variables
