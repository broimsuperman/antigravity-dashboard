import { watch, FSWatcher } from 'chokidar';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { EventEmitter } from 'events';
import type { 
  RawAccountsFile, 
  RawAccountData, 
  LocalAccount, 
  AccountStatus,
  RateLimitInfo,
  DashboardStats,
  AccountDiff 
} from '../types';

const ACCOUNTS_FILE_PATH = join(homedir(), '.config', 'opencode', 'antigravity-accounts.json');
const CONFIG_FILE_PATH = join(homedir(), '.config', 'opencode', 'antigravity.json');

export class AccountsFileService extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private lastData: RawAccountsFile | null = null;
  private processedAccounts: LocalAccount[] = [];
  private updateInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  start(): void {
    this.loadAccountsFile();
    this.setupFileWatcher();
    this.startRateLimitUpdater();
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  private setupFileWatcher(): void {
    if (!existsSync(ACCOUNTS_FILE_PATH)) {
      console.warn(`Accounts file not found: ${ACCOUNTS_FILE_PATH}`);
      return;
    }

    this.watcher = watch(ACCOUNTS_FILE_PATH, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    });

    this.watcher.on('change', () => {
      console.log('[AccountsFileService] File changed, reloading...');
      this.loadAccountsFile();
    });

    this.watcher.on('error', (error) => {
      console.error('[AccountsFileService] Watcher error:', error);
    });
  }

  private startRateLimitUpdater(): void {
    this.updateInterval = setInterval(() => {
      const updated = this.updateRateLimitTimers();
      if (updated) {
        this.emit('rate_limits_updated', this.processedAccounts);
      }
    }, 15000);
  }

  private updateRateLimitTimers(): boolean {
    let hasChanges = false;
    const now = Date.now();

    for (const account of this.processedAccounts) {
      if (account.rateLimits.claude) {
        const newTimeUntilReset = Math.max(0, account.rateLimits.claude.resetTime - now);
        const wasExpired = account.rateLimits.claude.isExpired;
        account.rateLimits.claude.timeUntilReset = newTimeUntilReset;
        account.rateLimits.claude.isExpired = newTimeUntilReset === 0;
        
        if (!wasExpired && account.rateLimits.claude.isExpired) {
          hasChanges = true;
          this.emit('rate_limit_cleared', { email: account.email, family: 'claude' });
        }
      }
      
      if (account.rateLimits.gemini) {
        const newTimeUntilReset = Math.max(0, account.rateLimits.gemini.resetTime - now);
        const wasExpired = account.rateLimits.gemini.isExpired;
        account.rateLimits.gemini.timeUntilReset = newTimeUntilReset;
        account.rateLimits.gemini.isExpired = newTimeUntilReset === 0;
        
        if (!wasExpired && account.rateLimits.gemini.isExpired) {
          hasChanges = true;
          this.emit('rate_limit_cleared', { email: account.email, family: 'gemini' });
        }
      }

      const newStatus = this.calculateAccountStatus(account);
      if (newStatus !== account.status) {
        account.status = newStatus;
        hasChanges = true;
      }
    }

    return hasChanges;
  }

  private loadAccountsFile(): void {
    try {
      if (!existsSync(ACCOUNTS_FILE_PATH)) {
        console.warn('[AccountsFileService] Accounts file does not exist');
        this.processedAccounts = [];
        this.lastData = null;
        this.emit('accounts_loaded', []);
        return;
      }

      const content = readFileSync(ACCOUNTS_FILE_PATH, 'utf-8');
      const data: RawAccountsFile = JSON.parse(content);
      
      const previousAccounts = [...this.processedAccounts];
      this.processedAccounts = this.processAccounts(data);
      this.lastData = data;

      const diffs = this.calculateDiffs(previousAccounts, this.processedAccounts);
      
      if (diffs.length > 0) {
        this.emit('accounts_changed', diffs);
      }
      
      this.emit('accounts_loaded', this.processedAccounts);
      console.log(`[AccountsFileService] Loaded ${this.processedAccounts.length} accounts`);
    } catch (error) {
      console.error('[AccountsFileService] Error loading accounts file:', error);
    }
  }

  private processAccounts(data: RawAccountsFile): LocalAccount[] {
    const now = Date.now();
    
    return data.accounts.map((raw, index) => {
      const claudeResetTime = raw.rateLimitResetTimes?.claude;
      const geminiResetTime = raw.rateLimitResetTimes?.gemini;
      
      const claudeRateLimit: RateLimitInfo | undefined = claudeResetTime ? {
        resetTime: claudeResetTime,
        timeUntilReset: Math.max(0, claudeResetTime - now),
        isExpired: claudeResetTime <= now
      } : undefined;
      
      const geminiRateLimit: RateLimitInfo | undefined = geminiResetTime ? {
        resetTime: geminiResetTime,
        timeUntilReset: Math.max(0, geminiResetTime - now),
        isExpired: geminiResetTime <= now
      } : undefined;

      const account: LocalAccount = {
        email: raw.email,
        projectId: raw.projectId,
        managedProjectId: raw.managedProjectId,
        addedAt: raw.addedAt,
        lastUsed: raw.lastUsed,
        isActive: index === data.activeIndex,
        activeForClaude: index === (data.activeIndexByFamily?.claude ?? data.activeIndex),
        activeForGemini: index === (data.activeIndexByFamily?.gemini ?? data.activeIndex),
        status: 'available',
        rateLimits: {
          claude: claudeRateLimit,
          gemini: geminiRateLimit
        }
      };

      account.status = this.calculateAccountStatus(account);
      return account;
    });
  }

  private calculateAccountStatus(account: LocalAccount): AccountStatus {
    const claudeLimited = account.rateLimits.claude && !account.rateLimits.claude.isExpired;
    const geminiLimited = account.rateLimits.gemini && !account.rateLimits.gemini.isExpired;
    
    if (claudeLimited && geminiLimited) return 'rate_limited_all';
    if (claudeLimited) return 'rate_limited_claude';
    if (geminiLimited) return 'rate_limited_gemini';
    return 'available';
  }

  private calculateDiffs(previous: LocalAccount[], current: LocalAccount[]): AccountDiff[] {
    const diffs: AccountDiff[] = [];
    const prevMap = new Map(previous.map(a => [a.email, a]));
    const currMap = new Map(current.map(a => [a.email, a]));

    for (const [email, account] of currMap) {
      const prev = prevMap.get(email);
      if (!prev) {
        diffs.push({ op: 'add', email, account });
      } else if (JSON.stringify(prev) !== JSON.stringify(account)) {
        diffs.push({ op: 'update', email, changes: account });
      }
    }

    for (const email of prevMap.keys()) {
      if (!currMap.has(email)) {
        diffs.push({ op: 'remove', email });
      }
    }

    return diffs;
  }

  getAccounts(): LocalAccount[] {
    return this.processedAccounts;
  }

  getActiveAccount(): LocalAccount | null {
    return this.processedAccounts.find(a => a.isActive) || null;
  }

  getActiveAccountForFamily(family: 'claude' | 'gemini'): LocalAccount | null {
    if (family === 'claude') {
      return this.processedAccounts.find(a => a.activeForClaude) || null;
    }
    return this.processedAccounts.find(a => a.activeForGemini) || null;
  }

  getRateLimitedAccounts(): LocalAccount[] {
    return this.processedAccounts.filter(a => a.status !== 'available');
  }

  getAvailableAccounts(): LocalAccount[] {
    return this.processedAccounts.filter(a => a.status === 'available');
  }

  getStats(): DashboardStats {
    const active = this.getActiveAccount();
    return {
      totalAccounts: this.processedAccounts.length,
      availableAccounts: this.getAvailableAccounts().length,
      rateLimitedAccounts: this.getRateLimitedAccounts().length,
      activeAccount: active?.email || null,
      lastUpdate: Date.now()
    };
  }

  getFilePath(): string {
    return ACCOUNTS_FILE_PATH;
  }

  fileExists(): boolean {
    return existsSync(ACCOUNTS_FILE_PATH);
  }
}

let serviceInstance: AccountsFileService | null = null;

export function getAccountsService(): AccountsFileService {
  if (!serviceInstance) {
    serviceInstance = new AccountsFileService();
    serviceInstance.start();
  }
  return serviceInstance;
}
