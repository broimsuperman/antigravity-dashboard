import { useEffect, useState } from 'react';
import { useDashboardStore } from './stores/useDashboardStore';
import { useWebSocket } from './hooks/useWebSocket';
import { useQuota, getQuotaForAccount, getQuotaColor, formatResetTime } from './hooks/useQuota';
import type { LocalAccount, AccountQuota } from './types';
import { RefreshCw, Activity, Zap, Clock, ShieldCheck, Mail } from 'lucide-react';

// Helper for burn rate
function formatBurnRate(tokens: number | undefined) {
  if (!tokens) return '0 T/h';
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M T/h`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K T/h`;
  return `${tokens} T/h`;
}

function QuotaBar({ percent, label }: { percent: number | null; label: string }) {
  const color = getQuotaColor(percent);
  const displayPercent = percent ?? 100;
  
  return (
    <div className="flex-1">
      <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-wider mb-1.5">
        <span className="text-text-secondary">{label}</span>
        <span className={`${percent !== null ? 'text-text-primary' : 'text-text-muted'}`}>
          {percent !== null ? `${percent}%` : 'N/A'}
        </span>
      </div>
      <div className="progress-track">
        <div 
          className={`progress-fill ${color}`}
          style={{ width: `${displayPercent}%` }}
        />
      </div>
    </div>
  );
}

function AccountRow({ 
  account, 
  quota, 
  index 
}: { 
  account: LocalAccount; 
  quota: AccountQuota | null;
  index: number;
}) {
  const isActive = account.isActive;
  
  let statusClass = 'ok';
  let statusText = 'Active';
  
  if (account.status === 'rate_limited_all') {
    statusClass = 'error';
    statusText = 'Limited';
  } else if (account.status.startsWith('rate_limited')) {
    statusClass = 'warn';
    statusText = 'Partial';
  }

  return (
    <div className="glass-card account-grid-row mb-3 last:mb-0 group">
      {/* Account Info */}
      <div className="flex items-center gap-4 min-w-[200px]">
        <div className={`p-2 rounded-full ${isActive ? 'bg-blue-500/10 text-blue-400' : 'bg-white/5 text-text-muted'}`}>
          <Mail size={16} />
        </div>
        <div className="overflow-hidden">
          <div className="text-text-primary text-sm font-semibold flex items-center gap-2 truncate" title={account.email}>
            {account.email}
            {isActive && (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 font-bold uppercase tracking-wider flex-shrink-0">
                Current
              </span>
            )}
          </div>
        </div>
      </div>
      
      {/* Burn Rate */}
      <div className="text-right pr-6">
         <div className="text-sm font-mono text-text-primary">{formatBurnRate(account.burnRate1h)}</div>
         <div className="text-[10px] text-text-secondary uppercase tracking-wider">Burn Rate</div>
      </div>

      {/* Status */}
      <div>
        <span className={`status-pill ${statusClass}`}>
          {statusText}
        </span>
      </div>
      
      {/* Quotas */}
      <div className="pr-4">
        <QuotaBar percent={quota?.claudeQuotaPercent ?? null} label="Claude" />
      </div>
      <div className="pr-4">
        <QuotaBar percent={quota?.geminiQuotaPercent ?? null} label="Gemini" />
      </div>
      
      {/* Reset */}
      <div className="text-right">
        <div className="font-mono text-xs text-text-secondary group-hover:text-white transition-colors">
          {formatResetTime(quota?.claudeResetTime || quota?.geminiResetTime || null)}
        </div>
      </div>
    </div>
  );
}

function StatsCard({ 
  label, 
  value, 
  subtext,
  icon: Icon,
  trend 
}: { 
  label: string; 
  value: string | number; 
  subtext?: string;
  icon: any;
  trend?: 'up' | 'down' | 'neutral';
}) {
  return (
    <div className="glass-card p-5 relative overflow-hidden">
      <div className="absolute top-0 right-0 p-3 opacity-5">
        <Icon size={48} />
      </div>
      <div className="flex items-start justify-between mb-4">
        <div className="text-label flex items-center gap-2">
          <Icon size={14} className="opacity-70" />
          {label}
        </div>
      </div>
      <div className="text-value mb-1">{value}</div>
      {subtext && <div className="text-xs text-text-muted font-medium">{subtext}</div>}
    </div>
  );
}

function App() {
  const { 
    localAccounts,
    wsConnected,
    setLocalAccounts,
  } = useDashboardStore();

  const { quotas, loading: quotaLoading, refresh: refreshQuotas } = useQuota(120000);
  const [refreshing, setRefreshing] = useState(false);
  
  const [sortBy, setSortBy] = useState<'claudeQuota' | 'geminiQuota' | 'burnRate' | 'email'>('burnRate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const sortedAccounts = [...localAccounts].sort((a, b) => {
    let valA: string | number = 0;
    let valB: string | number = 0;
    
    if (sortBy === 'email') {
       valA = a.email; valB = b.email;
    } else if (sortBy === 'burnRate') {
       valA = a.burnRate1h || 0; valB = b.burnRate1h || 0;
    } else {
       const quotaA = getQuotaForAccount(quotas, a.email);
       const quotaB = getQuotaForAccount(quotas, b.email);
       if (sortBy === 'claudeQuota') {
         valA = quotaA?.claudeQuotaPercent ?? -1;
         valB = quotaB?.claudeQuotaPercent ?? -1;
       } else {
         valA = quotaA?.geminiQuotaPercent ?? -1;
         valB = quotaB?.geminiQuotaPercent ?? -1;
       }
    }

    if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
    if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  useWebSocket({ autoConnect: true });

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    try {
      const response = await fetch('/api/accounts/local');
      const data = await response.json();
      if (data.success && data.data) {
        setLocalAccounts(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch accounts:', error);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchAccounts(), refreshQuotas()]);
    setRefreshing(false);
  };

  const availableCount = localAccounts.filter(a => a.status === 'available').length;
  const limitedCount = localAccounts.filter(a => a.status !== 'available').length;

  const avgClaudeQuota = quotas.length > 0 
    ? Math.round(quotas.reduce((sum, q) => sum + (q.claudeQuotaPercent ?? 100), 0) / quotas.length)
    : null;
  const avgGeminiQuota = quotas.length > 0
    ? Math.round(quotas.reduce((sum, q) => sum + (q.geminiQuotaPercent ?? 100), 0) / quotas.length)
    : null;

  if (localAccounts.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <div className="animate-pulse">
            <Activity className="w-12 h-12 text-accent-blue mx-auto mb-4" />
          </div>
          <div className="text-xl font-bold text-text-primary mb-2">Initializing Dashboard</div>
          <div className="text-text-muted text-sm">Waiting for backend connection...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-12">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl border-b border-white/5 bg-black/20">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Zap size={18} className="text-white" />
             </div>
             <div>
               <h1 className="text-lg font-bold text-white tracking-tight leading-none bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
                 Antigravity
               </h1>
               <p className="text-[10px] font-bold text-blue-400 tracking-widest uppercase mt-0.5">Live Monitor</p>
             </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${wsConnected ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]' : 'bg-red-400'}`} />
              <span className="text-xs font-bold uppercase tracking-wide">{wsConnected ? 'System Online' : 'Disconnected'}</span>
            </div>
            
            <button 
              onClick={handleRefresh}
              disabled={refreshing}
              className="btn-icon transition-transform active:scale-95"
              title="Refresh Data"
            >
              <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
          <StatsCard 
            label="Total Accounts" 
            value={localAccounts.length}
            subtext={`${availableCount} operational`}
            icon={ShieldCheck}
          />
          <StatsCard 
            label="Rate Limited" 
            value={limitedCount}
            subtext={limitedCount > 0 ? 'Action required' : 'Systems nominal'}
            icon={Activity}
          />
          <StatsCard 
            label="Avg Claude Quota" 
            value={avgClaudeQuota !== null ? `${avgClaudeQuota}%` : '-'}
            subtext="Global average"
            icon={Zap}
          />
          <StatsCard 
            label="Avg Gemini Quota" 
            value={avgGeminiQuota !== null ? `${avgGeminiQuota}%` : '-'}
            subtext="Global average"
            icon={Zap}
          />
        </div>

        {/* Account List Header */}
        <div className="account-grid-header text-label select-none">
          <div onClick={() => handleSort('email')} className="cursor-pointer hover:text-white flex items-center gap-1">
            Account Details {sortBy === 'email' && (sortOrder === 'asc' ? '↑' : '↓')}
          </div>
          <div onClick={() => handleSort('burnRate')} className="cursor-pointer hover:text-white flex items-center justify-end gap-1 pr-6 text-right">
            Burn Rate {sortBy === 'burnRate' && (sortOrder === 'asc' ? '↑' : '↓')}
          </div>
          <div>Status</div>
          <div onClick={() => handleSort('claudeQuota')} className="cursor-pointer hover:text-white flex items-center gap-1">
            Claude Load {sortBy === 'claudeQuota' && (sortOrder === 'asc' ? '↑' : '↓')}
          </div>
          <div onClick={() => handleSort('geminiQuota')} className="cursor-pointer hover:text-white flex items-center gap-1">
            Gemini Load {sortBy === 'geminiQuota' && (sortOrder === 'asc' ? '↑' : '↓')}
          </div>
          <div className="text-right flex items-center justify-end gap-1">
            <Clock size={12} />
            Reset
          </div>
        </div>

        {/* Floating Rows */}
        <div className="space-y-1">
          {sortedAccounts.map((account, index) => (
            <AccountRow 
              key={account.email}
              account={account}
              quota={getQuotaForAccount(quotas, account.email)}
              index={index}
            />
          ))}
        </div>

        {quotas.some(q => q.fetchError) && (
          <div className="mt-8 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm flex items-center justify-center gap-2">
            <Activity size={16} />
            Some data streams are experiencing latency. Retrying automatically.
          </div>
        )}
      </main>
      
      <div className="fixed bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-bg-primary to-transparent pointer-events-none" />
    </div>
  );
}

export default App;
