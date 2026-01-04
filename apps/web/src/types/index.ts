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
  burnRate1h?: number;
}

export interface ModelQuotaInfo {
  modelName: string;
  displayName?: string;
  remainingFraction: number;
  remainingPercent: number;
  resetTime: string | null;
  resetTimeMs: number | null;
}

export interface AccountQuota {
  email: string;
  projectId?: string;
  lastFetched: number;
  fetchError?: string;
  models: ModelQuotaInfo[];
  claudeModels: ModelQuotaInfo[];
  geminiModels: ModelQuotaInfo[];
  claudeQuotaPercent: number | null;
  geminiQuotaPercent: number | null;
  claudeResetTime: number | null;
  geminiResetTime: number | null;
}

export interface DashboardStats {
  totalAccounts: number;
  availableAccounts: number;
  rateLimitedAccounts: number;
  activeAccount: string | null;
  lastUpdate: number;
}

export interface AccountDiff {
  op: 'add' | 'update' | 'remove';
  email: string;
  changes?: Partial<LocalAccount>;
  account?: LocalAccount;
}

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

export interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
}

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
