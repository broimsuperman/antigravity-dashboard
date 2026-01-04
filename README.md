# Antigravity Dashboard

Real-time monitoring dashboard for Google Cloud accounts using the antigravity OAuth flow. Track API quotas, usage limits, and reset times across multiple accounts.

## Features

- **Multi-Account Monitoring** - Track 7+ Google Cloud accounts simultaneously
- **Real-Time Quotas** - View Claude and Gemini model quota percentages
- **Reset Timers** - Countdown to quota reset for each account
- **Live Updates** - WebSocket connection for instant status changes
- **Usage Analytics** - Token usage, request stats, and performance metrics
- **Manager Integration** - Proxy to antigravity-manager for account management

## Quick Start

```bash
# Install all dependencies (monorepo)
npm install

# Build backend and frontend
npm run build

# Start the server
npm start
```

Dashboard available at: **http://localhost:3456**

## Project Structure

```
antigravity-dashboard/
├── apps/
│   ├── backend/           # Express API server
│   │   ├── src/
│   │   │   ├── server.ts         # Main server, API endpoints
│   │   │   ├── monitor.ts        # SQLite usage logging
│   │   │   ├── interceptor.ts    # Request interception
│   │   │   └── services/
│   │   │       ├── quotaService.ts   # Google Cloud API integration
│   │   │       ├── accountsFile.ts   # Accounts file watcher
│   │   │       └── websocket.ts      # WebSocket manager
│   │   └── dist/                 # Compiled backend
│   │
│   └── web/               # React frontend
│       ├── src/
│       │   ├── App.tsx           # Main dashboard component
│       │   ├── hooks/            # useQuota, useWebSocket
│       │   ├── stores/           # Zustand store
│       │   └── types/            # TypeScript interfaces
│       └── dist/                 # Built frontend (served by Express)
│
├── package.json           # Root workspace config
└── usage.db               # SQLite database
```

## API Reference

### Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Server health check |
| `/api/accounts/local` | GET | List all configured accounts |
| `/api/accounts/quota` | GET | Get cached quota data |
| `/api/accounts/quota/refresh` | POST | Force refresh quotas |
| `/api/stats` | GET | Aggregated usage statistics |

### Analytics Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/analytics/overview` | GET | Combined local + manager stats |
| `/api/analytics/performance` | GET | Request performance metrics |
| `/api/analytics/errors` | GET | Error breakdown and analysis |
| `/api/analytics/trends` | GET | Daily usage trends |
| `/api/hourly-stats` | GET | Hourly breakdown |
| `/api/recent-calls` | GET | Recent API calls log |
| `/api/export/csv` | GET | Export usage data as CSV |

### Manager Proxy Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/manager/status` | GET | Check manager availability |
| `/api/manager/accounts` | GET | Get accounts from manager |
| `/api/manager/proxy/status` | GET | Proxy server status |
| `/api/manager/proxy/start` | POST | Start proxy server |
| `/api/manager/proxy/stop` | POST | Stop proxy server |

### WebSocket

Connect to `/ws` for live updates:
- `initial` - Full account state on connect
- `accounts_update` - Account status changes
- `config_update` - Quota updates
- `stats_update` - Statistics changes
- `rate_limit_change` - Rate limit events
- `heartbeat` - Connection keepalive

## Configuration

### Accounts File

Accounts are read from `~/.config/opencode/antigravity-accounts.json`:

```json
{
  "accounts": [
    {
      "email": "user@gmail.com",
      "refreshToken": "1//...",
      "projectId": "project-id"
    }
  ]
}
```

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Server
DASHBOARD_PORT=3456
MANAGER_URL=http://localhost:8080

# Database
DB_PATH=/custom/path/to/usage.db
DATA_RETENTION_DAYS=30
AUTO_CLEANUP_ON_START=false

# WebSocket
WS_HEARTBEAT_INTERVAL=30000
WS_MAX_CONNECTIONS=100

# API
API_RATE_LIMIT=100
CORS_ORIGINS=http://localhost:3000,http://localhost:5173

# Development
DEV_MODE=false
LOG_LEVEL=info
```

## Tech Stack

**Backend:**
- Node.js + Express
- TypeScript
- SQLite (better-sqlite3)
- WebSocket (ws)
- File watching (chokidar)

**Frontend:**
- React 18
- Vite
- Tailwind CSS
- Zustand (state management)
- Recharts (data visualization)
- Lucide React (icons)

## Development

### Frontend Dev Server

Start with hot reload (proxies to backend):

```bash
cd apps/web
npm run dev
```

Dev server runs on port 5173 and proxies `/api` and `/ws` to port 3456.

### Backend Dev

Watch mode for TypeScript compilation:

```bash
cd apps/backend
npm run dev
```

### Workspace Commands

```bash
# Build all packages
npm run build

# Run dev mode for all packages
npm run dev

# Start production server
npm start

# Typecheck backend
npm run typecheck --workspace=@antigravity/backend
```

## How It Works

1. **OAuth Tokens** - Uses stored refresh tokens to get access tokens
2. **Cloud Code API** - Fetches quota from Google's internal API endpoint
3. **Polling** - Refreshes all accounts every 2 minutes
4. **WebSocket** - Broadcasts updates to connected clients
5. **SQLite** - Logs all API calls for analytics
6. **Manager Proxy** - Optionally integrates with antigravity-manager

## License

MIT
