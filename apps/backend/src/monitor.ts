import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync, existsSync } from 'fs';

export interface ApiCall {
  id?: number;
  timestamp: number;
  account_email: string;
  model: string;
  endpoint: string;
  request_tokens?: number;
  response_tokens?: number;
  total_tokens?: number;
  duration_ms: number;
  status: 'success' | 'error' | 'rate_limited';
  error_message?: string;
  http_status?: number;
}

export interface AccountStats {
  email: string;
  total_calls: number;
  successful_calls: number;
  failed_calls: number;
  rate_limited_calls: number;
  total_tokens: number;
  last_used: number;
  is_rate_limited: boolean;
  rate_limit_reset?: number;
  burn_rate_1h?: number;
}

export interface ModelStats {
  model: string;
  total_calls: number;
  total_tokens: number;
  avg_duration_ms: number;
}

export class UsageMonitor {
  private db: Database.Database;
  private dbPath: string;

  constructor(customDbPath?: string) {
    const configDir = join(homedir(), '.config', 'opencode', 'antigravity-dashboard');
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    this.dbPath = customDbPath || join(configDir, 'usage.db');
    this.db = new Database(this.dbPath);
    this.initDatabase();
  }

  private initDatabase() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        account_email TEXT NOT NULL,
        model TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        request_tokens INTEGER,
        response_tokens INTEGER,
        total_tokens INTEGER,
        duration_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        http_status INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_timestamp ON api_calls(timestamp);
      CREATE INDEX IF NOT EXISTS idx_account_email ON api_calls(account_email);
      CREATE INDEX IF NOT EXISTS idx_model ON api_calls(model);
      CREATE INDEX IF NOT EXISTS idx_status ON api_calls(status);

      CREATE TABLE IF NOT EXISTS account_status (
        email TEXT PRIMARY KEY,
        is_rate_limited BOOLEAN NOT NULL DEFAULT 0,
        rate_limit_reset INTEGER,
        last_error TEXT,
        last_updated INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        account_email TEXT,
        details TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_session_timestamp ON session_events(timestamp);
    `);
  }

  logApiCall(call: ApiCall): number {
    const stmt = this.db.prepare(`
      INSERT INTO api_calls (
        timestamp, account_email, model, endpoint,
        request_tokens, response_tokens, total_tokens,
        duration_ms, status, error_message, http_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      call.timestamp, call.account_email, call.model, call.endpoint,
      call.request_tokens || null, call.response_tokens || null,
      call.total_tokens || null, call.duration_ms, call.status,
      call.error_message || null, call.http_status || null
    );

    return info.lastInsertRowid as number;
  }

  updateAccountStatus(email: string, isRateLimited: boolean, rateLimitReset?: number, lastError?: string) {
    const stmt = this.db.prepare(`
      INSERT INTO account_status (email, is_rate_limited, rate_limit_reset, last_error, last_updated)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        is_rate_limited = excluded.is_rate_limited,
        rate_limit_reset = excluded.rate_limit_reset,
        last_error = excluded.last_error,
        last_updated = excluded.last_updated
    `);

    stmt.run(email, isRateLimited ? 1 : 0, rateLimitReset || null, lastError || null, Date.now());
  }

  logSessionEvent(eventType: string, accountEmail?: string, details?: any) {
    const stmt = this.db.prepare(`
      INSERT INTO session_events (timestamp, event_type, account_email, details)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(Date.now(), eventType, accountEmail || null, details ? JSON.stringify(details) : null);
  }

  getAccountStats(burnWindowMs: number = 3600000): AccountStats[] {
    const burnStartTime = Date.now() - burnWindowMs;

    const stmt = this.db.prepare(`
      SELECT 
        ac.account_email as email,
        COUNT(*) as total_calls,
        SUM(CASE WHEN ac.status = 'success' THEN 1 ELSE 0 END) as successful_calls,
        SUM(CASE WHEN ac.status = 'error' THEN 1 ELSE 0 END) as failed_calls,
        SUM(CASE WHEN ac.status = 'rate_limited' THEN 1 ELSE 0 END) as rate_limited_calls,
        COALESCE(SUM(ac.total_tokens), 0) as total_tokens,
        MAX(ac.timestamp) as last_used,
        COALESCE(ast.is_rate_limited, 0) as is_rate_limited,
        ast.rate_limit_reset,
        COALESCE(SUM(CASE WHEN ac.timestamp >= ? THEN ac.total_tokens ELSE 0 END), 0) as burn_rate_1h
      FROM api_calls ac
      LEFT JOIN account_status ast ON ac.account_email = ast.email
      GROUP BY ac.account_email
      ORDER BY total_calls DESC
    `);

    return stmt.all(burnStartTime) as AccountStats[];
  }

  getModelStats(): ModelStats[] {
    const stmt = this.db.prepare(`
      SELECT 
        model,
        COUNT(*) as total_calls,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        AVG(duration_ms) as avg_duration_ms
      FROM api_calls
      WHERE status = 'success'
      GROUP BY model
      ORDER BY total_calls DESC
    `);

    return stmt.all() as ModelStats[];
  }

  getRecentCalls(limit: number = 100): ApiCall[] {
    const stmt = this.db.prepare(`
      SELECT * FROM api_calls
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    return stmt.all(limit) as ApiCall[];
  }

  getCallsInRange(startTime: number, endTime: number): ApiCall[] {
    const stmt = this.db.prepare(`
      SELECT * FROM api_calls
      WHERE timestamp BETWEEN ? AND ?
      ORDER BY timestamp ASC
    `);

    return stmt.all(startTime, endTime) as ApiCall[];
  }

  getHourlyStats(hours: number = 24) {
    const startTime = Date.now() - hours * 60 * 60 * 1000;

    const stmt = this.db.prepare(`
      SELECT 
        (timestamp / 3600000) * 3600000 as hour,
        COUNT(*) as calls,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors,
        SUM(CASE WHEN status = 'rate_limited' THEN 1 ELSE 0 END) as rate_limited,
        COALESCE(SUM(total_tokens), 0) as tokens
      FROM api_calls
      WHERE timestamp >= ?
      GROUP BY hour
      ORDER BY hour ASC
    `);

    return stmt.all(startTime);
  }

  getSessionEvents(limit: number = 100) {
    const stmt = this.db.prepare(`
      SELECT * FROM session_events
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    return stmt.all(limit);
  }

  clearOldData(daysToKeep: number = 30) {
    const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

    const stmtCalls = this.db.prepare('DELETE FROM api_calls WHERE timestamp < ?');
    const stmtEvents = this.db.prepare('DELETE FROM session_events WHERE timestamp < ?');

    const callsDeleted = stmtCalls.run(cutoffTime).changes;
    const eventsDeleted = stmtEvents.run(cutoffTime).changes;

    return { callsDeleted, eventsDeleted };
  }

  exportData() {
    return {
      accounts: this.getAccountStats(),
      models: this.getModelStats(),
      recentCalls: this.getRecentCalls(1000),
      sessionEvents: this.getSessionEvents(1000),
      hourlyStats: this.getHourlyStats(168)
    };
  }

  close() {
    this.db.close();
  }

  getDatabasePath(): string {
    return this.dbPath;
  }
}

let monitorInstance: UsageMonitor | null = null;

export function getMonitor(): UsageMonitor {
  if (!monitorInstance) {
    monitorInstance = new UsageMonitor();
  }
  return monitorInstance;
}
