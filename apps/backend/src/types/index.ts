// Shared types for Antigravity Dashboard

// Structure from antigravity-accounts.json
export interface RawAccountData {
  email: string;
  refreshToken: string;
  projectId?: string;
  managedProjectId?: string;
  addedAt: number;
  lastUsed: number;
  rateLimitResetTimes?: {
    claude?: number;
    gemini?: number;
  };
}

export interface RawAccountsFile {
  version: number;
  accounts: RawAccountData[];
  activeIndex: number;
  activeIndexByFamily?: {
    claude?: number;
    gemini?: number;
  };
}

// Processed account data for frontend
export interface LocalAccount {
  email: string;
  projectId?: string;
  managedProjectId?: string;
  addedAt: number;
  lastUsed: number;
  isActive: boolean;
  activeForClaude: boolean;
  activeForGemini: boolean;
  status: AccountStatus;
  rateLimits: {
    claude?: RateLimitInfo;
    gemini?: RateLimitInfo;
  };
}

export type AccountStatus = 
  | 'available'
  | 'rate_limited_claude'
  | 'rate_limited_gemini'
  | 'rate_limited_all';

export interface RateLimitInfo {
  resetTime: number;
  timeUntilReset: number;
  isExpired: boolean;
}

// WebSocket message types
export type WSMessageType = 
  | 'initial'
  | 'accounts_update'
  | 'rate_limit_change'
  | 'stats_update'
  | 'new_call'
  | 'heartbeat'
  | 'config_update';

export interface WSMessage {
  type: WSMessageType;
  data: any;
  timestamp: number;
  seq?: number;
}

export interface AccountDiff {
  op: 'add' | 'update' | 'remove';
  email: string;
  changes?: Partial<LocalAccount>;
  account?: LocalAccount;
}

// Dashboard statistics
export interface DashboardStats {
  totalAccounts: number;
  availableAccounts: number;
  rateLimitedAccounts: number;
  activeAccount: string | null;
  lastUpdate: number;
}

// API Call log
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

// User preferences (stored in localStorage)
export interface UserPreferences {
  activeTab: string;
  accountsSortBy: string;
  accountsSortOrder: 'asc' | 'desc';
  accountsFilter: string;
  notificationsEnabled: boolean;
  notifyOnRateLimit: boolean;
  notifyOnRateLimitClear: boolean;
  theme: 'dark' | 'light' | 'system';
  refreshInterval: number;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  activeTab: 'overview',
  accountsSortBy: 'lastUsed',
  accountsSortOrder: 'desc',
  accountsFilter: 'all',
  notificationsEnabled: true,
  notifyOnRateLimit: true,
  notifyOnRateLimitClear: true,
  theme: 'dark',
  refreshInterval: 15000,
};

// Notification types
export interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
}
