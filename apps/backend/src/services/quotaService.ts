import { EventEmitter } from 'events';

const ANTIGRAVITY_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const ANTIGRAVITY_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

const ANTIGRAVITY_ENDPOINTS = [
  "https://cloudcode-pa.googleapis.com",
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
];

const ANTIGRAVITY_HEADERS = {
  "User-Agent": "antigravity/1.11.5 windows/amd64",
  "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
  "Client-Metadata": '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}',
};

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

export interface QuotaCache {
  accounts: Map<string, AccountQuota>;
  lastFullFetch: number;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

interface TokenRefreshResponse {
  access_token: string;
  expires_in?: number;
}

interface FetchModelsResponse {
  models?: Record<string, {
    displayName?: string;
    quotaInfo?: {
      remainingFraction?: number;
      resetTime?: string;
    };
  }>;
}

export class QuotaService extends EventEmitter {
  private cache: QuotaCache = {
    accounts: new Map(),
    lastFullFetch: 0,
  };
  private tokenCache: Map<string, TokenCache> = new Map();
  private pollingInterval: NodeJS.Timeout | null = null;
  private pollingMs: number = 120000;

  constructor(pollingMs?: number) {
    super();
    if (pollingMs) {
      this.pollingMs = pollingMs;
    }
  }

  private async refreshAccessToken(refreshToken: string): Promise<string | null> {
    const cached = this.tokenCache.get(refreshToken);
    if (cached && cached.expiresAt > Date.now() + 60000) {
      return cached.accessToken;
    }

    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: ANTIGRAVITY_CLIENT_ID,
          client_secret: ANTIGRAVITY_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[QuotaService] Token refresh failed:', error);
        return null;
      }

      const data = await response.json() as TokenRefreshResponse;
      const accessToken = data.access_token;
      const expiresIn = data.expires_in || 3600;

      this.tokenCache.set(refreshToken, {
        accessToken,
        expiresAt: Date.now() + (expiresIn * 1000),
      });

      return accessToken;
    } catch (error) {
      console.error('[QuotaService] Error refreshing token:', error);
      return null;
    }
  }

  private async fetchAvailableModels(accessToken: string, projectId?: string): Promise<FetchModelsResponse | null> {
    const body = projectId ? { project: projectId } : {};

    for (const endpoint of ANTIGRAVITY_ENDPOINTS) {
      try {
        const response = await fetch(`${endpoint}/v1internal:fetchAvailableModels`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            ...ANTIGRAVITY_HEADERS,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.warn(`[QuotaService] Endpoint ${endpoint} returned ${response.status}: ${errorText}`);
          continue;
        }

        const data = await response.json() as FetchModelsResponse;
        return data;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`[QuotaService] Endpoint ${endpoint} failed:`, message);
        continue;
      }
    }

    return null;
  }

  private parseQuotaResponse(data: FetchModelsResponse): ModelQuotaInfo[] {
    const models: ModelQuotaInfo[] = [];

    if (!data?.models) {
      return models;
    }

    for (const [modelName, modelData] of Object.entries(data.models)) {
      const quotaInfo = modelData.quotaInfo;
      if (!quotaInfo) continue;

      const remainingFraction = quotaInfo.remainingFraction ?? 1.0;
      const resetTime = quotaInfo.resetTime || null;

      models.push({
        modelName,
        displayName: modelData.displayName || modelName,
        remainingFraction,
        remainingPercent: Math.round(remainingFraction * 100),
        resetTime,
        resetTimeMs: resetTime ? new Date(resetTime).getTime() : null,
      });
    }

    return models;
  }

  async fetchQuotaForAccount(
    email: string,
    refreshToken: string,
    projectId?: string
  ): Promise<AccountQuota> {
    const result: AccountQuota = {
      email,
      projectId,
      lastFetched: Date.now(),
      models: [],
      claudeModels: [],
      geminiModels: [],
      claudeQuotaPercent: null,
      geminiQuotaPercent: null,
      claudeResetTime: null,
      geminiResetTime: null,
    };

    const accessToken = await this.refreshAccessToken(refreshToken);
    if (!accessToken) {
      result.fetchError = 'Failed to refresh access token';
      return result;
    }

    const data = await this.fetchAvailableModels(accessToken, projectId);
    if (!data) {
      result.fetchError = 'Failed to fetch models from API';
      return result;
    }

    result.models = this.parseQuotaResponse(data);

    result.claudeModels = result.models.filter(m => 
      m.modelName.toLowerCase().includes('claude') || 
      m.modelName.toLowerCase().includes('anthropic')
    );
    result.geminiModels = result.models.filter(m => 
      m.modelName.toLowerCase().includes('gemini')
    );

    if (result.claudeModels.length > 0) {
      const minClaude = result.claudeModels.reduce((min, m) => 
        m.remainingPercent < min.remainingPercent ? m : min
      );
      result.claudeQuotaPercent = minClaude.remainingPercent;
      result.claudeResetTime = minClaude.resetTimeMs;
    }

    if (result.geminiModels.length > 0) {
      const minGemini = result.geminiModels.reduce((min, m) => 
        m.remainingPercent < min.remainingPercent ? m : min
      );
      result.geminiQuotaPercent = minGemini.remainingPercent;
      result.geminiResetTime = minGemini.resetTimeMs;
    }

    this.cache.accounts.set(email, result);
    
    return result;
  }

  async fetchAllQuotas(accounts: Array<{
    email: string;
    refreshToken: string;
    projectId?: string;
  }>): Promise<AccountQuota[]> {
    console.log(`[QuotaService] Fetching quotas for ${accounts.length} accounts...`);
    
    const results: AccountQuota[] = [];

    for (const account of accounts) {
      try {
        const quota = await this.fetchQuotaForAccount(
          account.email,
          account.refreshToken,
          account.projectId
        );
        results.push(quota);
        
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[QuotaService] Error fetching quota for ${account.email}:`, message);
        results.push({
          email: account.email,
          projectId: account.projectId,
          lastFetched: Date.now(),
          fetchError: message,
          models: [],
          claudeModels: [],
          geminiModels: [],
          claudeQuotaPercent: null,
          geminiQuotaPercent: null,
          claudeResetTime: null,
          geminiResetTime: null,
        });
      }
    }

    this.cache.lastFullFetch = Date.now();
    this.emit('quotas_updated', results);
    
    console.log(`[QuotaService] Fetched quotas for ${results.length} accounts`);
    return results;
  }

  getCachedQuotas(): AccountQuota[] {
    return Array.from(this.cache.accounts.values());
  }

  getCachedQuota(email: string): AccountQuota | null {
    return this.cache.accounts.get(email) || null;
  }

  getCacheAge(): number {
    if (this.cache.lastFullFetch === 0) return Infinity;
    return Date.now() - this.cache.lastFullFetch;
  }

  isCacheStale(): boolean {
    return this.getCacheAge() > this.pollingMs;
  }

  startPolling(getAccounts: () => Array<{
    email: string;
    refreshToken: string;
    projectId?: string;
  }>): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    this.fetchAllQuotas(getAccounts());

    this.pollingInterval = setInterval(async () => {
      const accounts = getAccounts();
      if (accounts.length > 0) {
        await this.fetchAllQuotas(accounts);
      }
    }, this.pollingMs);

    console.log(`[QuotaService] Started polling every ${this.pollingMs / 1000}s`);
  }

  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  async forceRefresh(accounts: Array<{
    email: string;
    refreshToken: string;
    projectId?: string;
  }>): Promise<AccountQuota[]> {
    return this.fetchAllQuotas(accounts);
  }
}

let quotaServiceInstance: QuotaService | null = null;

export function getQuotaService(pollingMs?: number): QuotaService {
  if (!quotaServiceInstance) {
    quotaServiceInstance = new QuotaService(pollingMs);
  }
  return quotaServiceInstance;
}
