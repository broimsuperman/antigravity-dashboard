import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { getMonitor } from './monitor';
import { getAccountsService } from './services/accountsFile';
import { getWebSocketManager } from './services/websocket';
import { getQuotaService } from './services/quotaService';
import { setWsManager } from './interceptor';
import path from 'path';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import dotenv from 'dotenv';

dotenv.config();

const ACCOUNTS_FILE_PATH = join(homedir(), '.config', 'opencode', 'antigravity-accounts.json');

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3456;
const MANAGER_URL = process.env.MANAGER_URL || 'http://localhost:8080';

app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || '*',
  credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../web/dist')));

const monitor = getMonitor();
const accountsService = getAccountsService();
const wsManager = getWebSocketManager();
const quotaService = getQuotaService(120000);

setWsManager(wsManager);

function getRawAccountsForQuota(): Array<{ email: string; refreshToken: string; projectId?: string }> {
  try {
    if (!existsSync(ACCOUNTS_FILE_PATH)) return [];
    const content = readFileSync(ACCOUNTS_FILE_PATH, 'utf-8');
    const data = JSON.parse(content);
    if (!Array.isArray(data.accounts)) return [];
    return data.accounts.map((acc: any) => ({
      email: acc.email,
      refreshToken: acc.refreshToken,
      projectId: acc.projectId || acc.managedProjectId,
    }));
  } catch {
    return [];
  }
}

async function proxyToManager(endpoint: string, options?: RequestInit): Promise<any> {
  try {
    const response = await fetch(`${MANAGER_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers
      }
    });

    if (!response.ok) {
      throw new Error(`Manager returned ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error(`Error proxying to manager:`, error.message);
    return null;
  }
}

async function isManagerAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${MANAGER_URL}/health`, {
      signal: AbortSignal.timeout(5000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

app.get('/api/accounts/local', (req, res) => {
  try {
    const accounts = accountsService.getAccounts();
    const stats = monitor.getAccountStats();

    // Merge burn rate into local accounts
    const merged = accounts.map(acc => {
      const stat = stats.find(s => s.email === acc.email);
      return {
        ...acc,
        burnRate1h: stat?.burn_rate_1h || 0
      };
    });

    res.json({ success: true, data: merged });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/accounts/active', (req, res) => {
  try {
    const active = accountsService.getActiveAccount();
    const activeForClaude = accountsService.getActiveAccountForFamily('claude');
    const activeForGemini = accountsService.getActiveAccountForFamily('gemini');
    res.json({
      success: true,
      data: {
        active,
        activeForClaude,
        activeForGemini
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/accounts/rate-limits', (req, res) => {
  try {
    const rateLimited = accountsService.getRateLimitedAccounts();
    res.json({ success: true, data: rateLimited });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/accounts/stats', (req, res) => {
  try {
    const stats = accountsService.getStats();
    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/accounts/quota', async (req, res) => {
  try {
    let quotas = quotaService.getCachedQuotas();

    if (quotas.length === 0 || quotaService.isCacheStale()) {
      const accounts = getRawAccountsForQuota();
      if (accounts.length > 0) {
        quotas = await quotaService.fetchAllQuotas(accounts);
      }
    }

    res.json({
      success: true,
      data: {
        quotas,
        cacheAge: quotaService.getCacheAge(),
        isStale: quotaService.isCacheStale()
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/accounts/quota/refresh', async (req, res) => {
  try {
    const accounts = getRawAccountsForQuota();
    if (accounts.length === 0) {
      res.status(400).json({ success: false, error: 'No accounts found' });
      return;
    }

    const quotas = await quotaService.forceRefresh(accounts);
    res.json({ success: true, data: quotas });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/stats', (req, res) => {
  try {
    const accounts = monitor.getAccountStats();
    const models = monitor.getModelStats();
    const hourlyStats = monitor.getHourlyStats(24);
    const localAccounts = accountsService.getAccounts();
    const accountsStats = accountsService.getStats();

    res.json({
      success: true,
      data: {
        accounts,
        models,
        hourlyStats,
        localAccounts,
        accountsStats
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/accounts', (req, res) => {
  try {
    const accounts = monitor.getAccountStats();
    res.json({ success: true, data: accounts });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/models', (req, res) => {
  try {
    const models = monitor.getModelStats();
    res.json({ success: true, data: models });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/recent-calls', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const calls = monitor.getRecentCalls(limit);
    res.json({ success: true, data: calls });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/hourly-stats', (req, res) => {
  try {
    const hours = parseInt(req.query.hours as string) || 24;
    const stats = monitor.getHourlyStats(hours);
    res.json({ success: true, data: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/session-events', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const events = monitor.getSessionEvents(limit);
    res.json({ success: true, data: events });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/export', (req, res) => {
  try {
    const data = monitor.exportData();
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/export/csv', (req, res) => {
  try {
    const calls = monitor.getRecentCalls(10000);

    const headers = [
      'Timestamp', 'Account', 'Model', 'Endpoint', 'Status',
      'Duration (ms)', 'Request Tokens', 'Response Tokens',
      'Total Tokens', 'Error'
    ];

    const rows = calls.map(call => [
      new Date(call.timestamp).toISOString(),
      call.account_email, call.model, call.endpoint, call.status,
      call.duration_ms, call.request_tokens || '', call.response_tokens || '',
      call.total_tokens || '', call.error_message || ''
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(escapeCSVCell).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="antigravity-usage-${Date.now()}.csv"`);
    res.send(csv);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/cleanup', (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const result = monitor.clearOldData(days);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

function escapeCSVCell(value: unknown): string {
  const str = String(value ?? '');
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: Date.now(),
      dbPath: monitor.getDatabasePath(),
      accountsFilePath: accountsService.getFilePath(),
      accountsFileExists: accountsService.fileExists(),
      wsClients: wsManager.getClientCount(),
      managerUrl: MANAGER_URL
    }
  });
});

app.get('/api/manager/status', async (req, res) => {
  const available = await isManagerAvailable();
  res.json({
    success: true,
    data: {
      available,
      url: MANAGER_URL
    }
  });
});

app.get('/api/manager/accounts', async (req, res) => {
  const data = await proxyToManager('/accounts');
  if (data) {
    res.json({ success: true, data });
  } else {
    res.status(503).json({ success: false, error: 'Manager unavailable' });
  }
});

app.get('/api/manager/proxy/status', async (req, res) => {
  const data = await proxyToManager('/proxy/status');
  if (data) {
    res.json({ success: true, data });
  } else {
    res.status(503).json({ success: false, error: 'Manager unavailable' });
  }
});

app.get('/api/manager/proxy/stats', async (req, res) => {
  const data = await proxyToManager('/proxy/stats');
  if (data) {
    res.json({ success: true, data });
  } else {
    res.status(503).json({ success: false, error: 'Manager unavailable' });
  }
});

app.get('/api/manager/proxy/logs', async (req, res) => {
  const limit = req.query.limit || 100;
  const data = await proxyToManager(`/proxy/logs?limit=${limit}`);
  if (data) {
    res.json({ success: true, data });
  } else {
    res.status(503).json({ success: false, error: 'Manager unavailable' });
  }
});

app.post('/api/manager/proxy/start', async (req, res) => {
  const data = await proxyToManager('/proxy/start', { method: 'POST' });
  if (data) {
    res.json({ success: true, data });
  } else {
    res.status(503).json({ success: false, error: 'Manager unavailable' });
  }
});

app.post('/api/manager/proxy/stop', async (req, res) => {
  const data = await proxyToManager('/proxy/stop', { method: 'POST' });
  if (data) {
    res.json({ success: true, data });
  } else {
    res.status(503).json({ success: false, error: 'Manager unavailable' });
  }
});

app.post('/api/manager/accounts/refresh', async (req, res) => {
  const data = await proxyToManager('/accounts/refresh', { method: 'POST' });
  if (data) {
    res.json({ success: true, data });
  } else {
    res.status(503).json({ success: false, error: 'Manager unavailable' });
  }
});

app.get('/api/manager/models', async (req, res) => {
  const data = await proxyToManager('/v1/models');
  if (data) {
    res.json({ success: true, data });
  } else {
    res.status(503).json({ success: false, error: 'Manager unavailable' });
  }
});

app.get('/api/manager/config', async (req, res) => {
  const data = await proxyToManager('/config');
  if (data) {
    res.json({ success: true, data });
  } else {
    res.status(503).json({ success: false, error: 'Manager unavailable' });
  }
});

app.get('/api/analytics/overview', async (req, res) => {
  try {
    const managerAvailable = await isManagerAvailable();
    let managerData = null;

    if (managerAvailable) {
      const [accounts, proxyStatus, proxyStats] = await Promise.all([
        proxyToManager('/accounts'),
        proxyToManager('/proxy/status'),
        proxyToManager('/proxy/stats')
      ]);
      managerData = { accounts, proxyStatus, proxyStats };
    }

    const localStats = {
      accounts: monitor.getAccountStats(),
      models: monitor.getModelStats(),
      hourlyStats: monitor.getHourlyStats(24),
      recentCalls: monitor.getRecentCalls(50),
      localAccounts: accountsService.getAccounts(),
      accountsStats: accountsService.getStats()
    };

    res.json({
      success: true,
      data: {
        managerAvailable,
        managerData,
        localStats
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/analytics/performance', (req, res) => {
  try {
    const hours = parseInt(req.query.hours as string) || 24;
    const startTime = Date.now() - hours * 60 * 60 * 1000;
    const calls = monitor.getCallsInRange(startTime, Date.now());

    const successfulCalls = calls.filter(c => c.status === 'success');
    const failedCalls = calls.filter(c => c.status === 'error');
    const rateLimitedCalls = calls.filter(c => c.status === 'rate_limited');

    const avgDuration = successfulCalls.length > 0
      ? successfulCalls.reduce((sum, c) => sum + c.duration_ms, 0) / successfulCalls.length
      : 0;

    const totalTokens = successfulCalls.reduce((sum, c) => sum + (c.total_tokens || 0), 0);
    const totalInputTokens = successfulCalls.reduce((sum, c) => sum + (c.request_tokens || 0), 0);
    const totalOutputTokens = successfulCalls.reduce((sum, c) => sum + (c.response_tokens || 0), 0);

    const durations = successfulCalls.map(c => c.duration_ms).sort((a, b) => a - b);
    const p50 = durations[Math.floor(durations.length * 0.5)] || 0;
    const p95 = durations[Math.floor(durations.length * 0.95)] || 0;
    const p99 = durations[Math.floor(durations.length * 0.99)] || 0;

    const errorBreakdown: Record<string, number> = {};
    failedCalls.forEach(call => {
      const error = call.error_message || 'unknown';
      errorBreakdown[error] = (errorBreakdown[error] || 0) + 1;
    });

    res.json({
      success: true,
      data: {
        summary: {
          totalRequests: calls.length,
          successfulRequests: successfulCalls.length,
          failedRequests: failedCalls.length,
          rateLimitedRequests: rateLimitedCalls.length,
          successRate: calls.length > 0 ? (successfulCalls.length / calls.length * 100).toFixed(2) : 0
        },
        performance: {
          avgDurationMs: Math.round(avgDuration),
          minDurationMs: durations[0] || 0,
          maxDurationMs: durations[durations.length - 1] || 0,
          p50,
          p95,
          p99
        },
        tokens: {
          total: totalTokens,
          input: totalInputTokens,
          output: totalOutputTokens,
          avgPerRequest: successfulCalls.length > 0 ? Math.round(totalTokens / successfulCalls.length) : 0
        },
        errorBreakdown,
        requestsPerHour: calls.length / hours
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/analytics/errors', (req, res) => {
  try {
    const hours = parseInt(req.query.hours as string) || 24;
    const startTime = Date.now() - hours * 60 * 60 * 1000;
    const calls = monitor.getCallsInRange(startTime, Date.now());

    const errorCalls = calls.filter(c => c.status !== 'success');

    const errorsByType: Record<string, any> = {};
    errorCalls.forEach(call => {
      const key = `${call.http_status || 'unknown'}_${call.status}`;
      if (!errorsByType[key]) {
        errorsByType[key] = {
          httpStatus: call.http_status,
          status: call.status,
          count: 0,
          messages: [],
          accounts: new Set(),
          models: new Set()
        };
      }
      errorsByType[key].count++;
      if (call.error_message) {
        errorsByType[key].messages.push(call.error_message);
      }
      errorsByType[key].accounts.add(call.account_email);
      errorsByType[key].models.add(call.model);
    });

    const formattedErrors = Object.values(errorsByType).map((e: any) => ({
      httpStatus: e.httpStatus,
      status: e.status,
      count: e.count,
      affectedAccounts: Array.from(e.accounts),
      affectedModels: Array.from(e.models),
      sampleMessages: [...new Set(e.messages)].slice(0, 5)
    })).sort((a, b) => b.count - a.count);

    res.json({
      success: true,
      data: {
        totalErrors: errorCalls.length,
        errorsByType: formattedErrors
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/analytics/trends', (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const hourlyData = monitor.getHourlyStats(days * 24);

    const dailyData: Record<string, any> = {};
    hourlyData.forEach((row: any) => {
      const date = new Date(row.hour).toISOString().split('T')[0];
      if (!dailyData[date]) {
        dailyData[date] = {
          date,
          calls: 0,
          tokens: 0,
          successful: 0,
          errors: 0,
          rateLimited: 0
        };
      }
      dailyData[date].calls += row.calls;
      dailyData[date].tokens += row.tokens;
      dailyData[date].successful += row.successful;
      dailyData[date].errors += row.errors;
      dailyData[date].rateLimited += row.rate_limited;
    });

    res.json({
      success: true,
      data: Object.values(dailyData)
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../web/dist/index.html'));
});

const server = createServer(app);

wsManager.initialize(server, '/ws');

accountsService.on('accounts_loaded', (accounts) => {
  wsManager.broadcastNow({
    type: 'initial',
    data: { accounts, stats: accountsService.getStats() },
    timestamp: Date.now()
  });
});

accountsService.on('accounts_changed', (diffs) => {
  wsManager.broadcastAccountsUpdate(diffs);
});

accountsService.on('rate_limits_updated', () => {
  wsManager.broadcastStatsUpdate(accountsService.getStats());
});

accountsService.on('rate_limit_cleared', ({ email, family }) => {
  wsManager.broadcastRateLimitChange(email, family, true);
});

quotaService.on('quotas_updated', (quotas) => {
  wsManager.broadcastNow({
    type: 'config_update',
    data: { quotas },
    timestamp: Date.now()
  });
});

quotaService.startPolling(getRawAccountsForQuota);

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🚀 Antigravity Usage Dashboard                          ║
║                                                            ║
║   Dashboard: http://localhost:${PORT}                    ║
║   API:       http://localhost:${PORT}/api/stats          ║
║   Database:  ${monitor.getDatabasePath()}                 ║
║   Accounts:  ${accountsService.getFilePath()}             ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});

process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  accountsService.stop();
  quotaService.stopPolling();
  wsManager.shutdown();
  monitor.close();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export { app, server, monitor, accountsService, wsManager };
