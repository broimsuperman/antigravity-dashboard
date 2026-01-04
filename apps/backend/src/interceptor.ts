import { getMonitor } from './monitor';

export interface RequestMetadata {
  account_email: string;
  model: string;
  endpoint: string;
  startTime: number;
}

interface WsManager {
  broadcastNow(message: { type: string; data: unknown; timestamp: number }): void;
}

let wsManagerRef: WsManager | null = null;

export function setWsManager(manager: WsManager) {
  wsManagerRef = manager;
}

function safeBroadcast(message: unknown) {
  if (wsManagerRef) {
    try {
      wsManagerRef.broadcastNow({
        type: 'new_call',
        data: message,
        timestamp: Date.now()
      });
    } catch (error) {
      // Broadcast failures are non-critical, log for debugging
      console.debug('[WS] Broadcast failed:', error);
    }
  }
}

export class AntigravityInterceptor {
  private monitor = getMonitor();
  private activeRequests = new Map<string, RequestMetadata>();

  onRequestStart(requestId: string, metadata: RequestMetadata) {
    this.activeRequests.set(requestId, {
      ...metadata,
      startTime: Date.now()
    });
  }

  onRequestComplete(
    requestId: string,
    response: {
      success: boolean;
      tokens?: {
        prompt?: number;
        completion?: number;
        total?: number;
      };
      error?: string;
      httpStatus?: number;
    }
  ) {
    const metadata = this.activeRequests.get(requestId);
    if (!metadata) {
      console.warn(`No metadata found for request ${requestId}`);
      return;
    }

    const duration = Date.now() - metadata.startTime;
    const status = response.success
      ? 'success'
      : response.httpStatus === 429
      ? 'rate_limited'
      : 'error';

    this.monitor.logApiCall({
      timestamp: metadata.startTime,
      account_email: metadata.account_email,
      model: metadata.model,
      endpoint: metadata.endpoint,
      request_tokens: response.tokens?.prompt,
      response_tokens: response.tokens?.completion,
      total_tokens: response.tokens?.total,
      duration_ms: duration,
      status,
      error_message: response.error,
      http_status: response.httpStatus
    });

    if (status === 'rate_limited') {
      const retryMatch = response.error?.match(/(\d+)s/);
      const retryAfter = retryMatch ? parseInt(retryMatch[1]) * 1000 : undefined;
      
      this.monitor.updateAccountStatus(
        metadata.account_email,
        true,
        retryAfter ? Date.now() + retryAfter : undefined,
        response.error
      );
    } else if (status === 'success') {
      this.monitor.updateAccountStatus(metadata.account_email, false);
    }

    safeBroadcast({
      type: 'api_call',
      call: {
        timestamp: metadata.startTime,
        account: metadata.account_email,
        model: metadata.model,
        status,
        duration
      }
    });

    this.activeRequests.delete(requestId);
  }

  onAccountRotation(fromAccount: string, toAccount: string, reason: string) {
    this.monitor.logSessionEvent('account_rotation', toAccount, {
      from: fromAccount,
      reason
    });

    safeBroadcast({
      type: 'account_rotation',
      from: fromAccount,
      to: toAccount,
      reason
    });
  }

  onSessionRecovery(account: string, details: any) {
    this.monitor.logSessionEvent('session_recovery', account, details);

    safeBroadcast({
      type: 'session_recovery',
      account,
      details
    });
  }

  logEvent(eventType: string, account?: string, details?: any) {
    this.monitor.logSessionEvent(eventType, account, details);
  }
}

let interceptorInstance: AntigravityInterceptor | null = null;

export function getInterceptor(): AntigravityInterceptor {
  if (!interceptorInstance) {
    interceptorInstance = new AntigravityInterceptor();
  }
  return interceptorInstance;
}

export function patchAntigravityPlugin() {
  const interceptor = getInterceptor();
  
  console.log('Antigravity monitoring patch applied');
  
  return {
    onRequestStart: interceptor.onRequestStart.bind(interceptor),
    onRequestComplete: interceptor.onRequestComplete.bind(interceptor),
    onAccountRotation: interceptor.onAccountRotation.bind(interceptor),
    onSessionRecovery: interceptor.onSessionRecovery.bind(interceptor),
    logEvent: interceptor.logEvent.bind(interceptor)
  };
}
