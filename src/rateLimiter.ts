/**
 * Rate Limiter and Token Usage Tracker for OpenAI API
 * 
 * This module provides:
 * - Token usage tracking per minute
 * - Automatic rate limiting with exponential backoff
 * - Request queuing to prevent exceeding limits
 * - Graceful handling of 429 errors
 */

interface RateLimitConfig {
  tokensPerMinute: number;
  requestsPerMinute?: number;
  maxRetries: number;
  initialRetryDelay: number;
  maxRetryDelay: number;
  backoffMultiplier: number;
}

interface TokenUsage {
  tokens: number;
  timestamp: number;
}

interface QueuedRequest {
  resolve: (value: any) => void;
  reject: (error: any) => void;
  execute: () => Promise<any>;
  priority: number;
}

export class RateLimiter {
  private config: RateLimitConfig;
  private tokenUsageHistory: TokenUsage[] = [];
  private requestQueue: QueuedRequest[] = [];
  private isProcessingQueue: boolean = false;
  private currentTokens: number = 0;
  private lastResetTime: number = Date.now();

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = {
      tokensPerMinute: config.tokensPerMinute || 25000, // Conservative limit (below 30k)
      requestsPerMinute: config.requestsPerMinute || 50,
      maxRetries: config.maxRetries || 5,
      initialRetryDelay: config.initialRetryDelay || 1000,
      maxRetryDelay: config.maxRetryDelay || 60000,
      backoffMultiplier: config.backoffMultiplier || 2
    };
  }

  /**
   * Clean up old token usage records (older than 1 minute)
   */
  private cleanupTokenHistory(): void {
    const oneMinuteAgo = Date.now() - 60000;
    this.tokenUsageHistory = this.tokenUsageHistory.filter(
      usage => usage.timestamp > oneMinuteAgo
    );
    this.currentTokens = this.tokenUsageHistory.reduce(
      (sum, usage) => sum + usage.tokens, 0
    );
  }

  /**
   * Estimate tokens for a request (rough approximation)
   */
  private estimateTokens(messages: any[], tools?: any[]): number {
    let tokens = 0;
    
    // Count message tokens (rough estimate: 1 token ≈ 4 characters)
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        tokens += Math.ceil(msg.content.length / 4);
      } else if (Array.isArray(msg.content)) {
        for (const item of msg.content) {
          if (item.type === 'text' && item.text) {
            tokens += Math.ceil(item.text.length / 4);
          }
        }
      }
    }

    // Add tool definitions (rough estimate)
    if (tools && tools.length > 0) {
      tokens += tools.length * 100; // ~100 tokens per tool definition
    }

    // Add overhead for API structure
    tokens += 50;

    return tokens;
  }

  /**
   * Wait until we have enough token capacity
   */
  private async waitForTokenCapacity(requiredTokens: number): Promise<void> {
    this.cleanupTokenHistory();

    const availableTokens = this.config.tokensPerMinute - this.currentTokens;
    
    if (availableTokens >= requiredTokens) {
      return; // We have capacity
    }

    // Calculate wait time based on oldest token usage
    if (this.tokenUsageHistory.length > 0) {
      const oldestUsage = this.tokenUsageHistory[0];
      const age = Date.now() - oldestUsage.timestamp;
      const waitTime = Math.max(0, 60000 - age + 100); // Wait until oldest expires + buffer
      
      if (waitTime > 0) {
        console.log(`⏳ Rate limiter: Waiting ${Math.ceil(waitTime / 1000)}s for token capacity...`);
        await this.sleep(waitTime);
        this.cleanupTokenHistory();
      }
    }
  }

  /**
   * Record token usage
   */
  public recordTokenUsage(tokens: number): void {
    this.tokenUsageHistory.push({
      tokens,
      timestamp: Date.now()
    });
    this.currentTokens += tokens;
    this.cleanupTokenHistory();
  }

  /**
   * Get current token usage stats
   */
  public getTokenStats(): { current: number; limit: number; available: number; percentage: number } {
    this.cleanupTokenHistory();
    return {
      current: this.currentTokens,
      limit: this.config.tokensPerMinute,
      available: this.config.tokensPerMinute - this.currentTokens,
      percentage: (this.currentTokens / this.config.tokensPerMinute) * 100
    };
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute a request with rate limiting and retry logic
   */
  public async executeWithRateLimit<T>(
    requestFn: () => Promise<T>,
    estimatedTokens?: number,
    priority: number = 0
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        try {
          // Estimate tokens if not provided
          let tokens = estimatedTokens;
          if (!tokens) {
            // We can't estimate without seeing the request, so use a conservative default
            tokens = 2000; // Default estimate
          }

          // Reserve capacity (wait if needed, but don't record yet)
          await this.waitForTokenCapacity(tokens);
          
          // Temporarily reserve the estimated tokens to prevent other requests from using them
          this.recordTokenUsage(tokens);

          // Execute with retry logic
          let lastError: any;
          let retryDelay = this.config.initialRetryDelay;
          let actualTokensUsed = tokens; // Default to estimate

          for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
            try {
              const result = await requestFn();
              
              // If result has usage info, extract it (for OpenAI responses)
              if (result && typeof result === 'object' && 'usage' in result) {
                const usage = (result as any).usage;
                if (usage && typeof usage.total_tokens === 'number') {
                  actualTokensUsed = usage.total_tokens;
                }
              }
              
              // Adjust token usage: remove estimate, add actual
              if (actualTokensUsed !== tokens) {
                this.recordTokenUsage(actualTokensUsed - tokens);
              }
              
              return result;
            } catch (error: any) {
              lastError = error;

              // Check if it's a rate limit error
              if (error.status === 429 || error.message?.includes('429') || error.message?.includes('rate limit')) {
                const retryAfter = this.extractRetryAfter(error);
                const waitTime = retryAfter || retryDelay;

                console.log(`⚠️  Rate limit hit (attempt ${attempt + 1}/${this.config.maxRetries + 1}). Waiting ${Math.ceil(waitTime / 1000)}s...`);
                
                if (attempt < this.config.maxRetries) {
                  await this.sleep(waitTime);
                  retryDelay = Math.min(
                    retryDelay * this.config.backoffMultiplier,
                    this.config.maxRetryDelay
                  );
                  continue;
                }
              } else {
                // Non-rate-limit error, don't retry
                throw error;
              }
            }
          }

          throw lastError;
        } catch (error) {
          reject(error);
        }
      };

      // Add to queue or execute immediately
      if (this.isProcessingQueue) {
        this.requestQueue.push({ resolve, reject, execute, priority });
        // Sort queue by priority (higher priority first)
        this.requestQueue.sort((a, b) => b.priority - a.priority);
      } else {
        this.processRequest(execute, resolve, reject);
      }
    });
  }

  /**
   * Process a request and handle queue
   */
  private async processRequest(
    execute: () => Promise<any>,
    resolve: (value: any) => void,
    reject: (error: any) => void
  ): Promise<void> {
    this.isProcessingQueue = true;

    try {
      const result = await execute();
      resolve(result);
    } catch (error) {
      reject(error);
    }

    // Process next item in queue
    if (this.requestQueue.length > 0) {
      const next = this.requestQueue.shift()!;
      setImmediate(() => this.processRequest(next.execute, next.resolve, next.reject));
    } else {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Extract retry-after from error response
   */
  private extractRetryAfter(error: any): number | null {
    // Check headers
    if (error.headers?.['retry-after']) {
      return parseInt(error.headers['retry-after'], 10) * 1000;
    }

    // Check error message for retry-after info
    const message = error.message || '';
    const retryMatch = message.match(/try again in (\d+)ms/i);
    if (retryMatch) {
      return parseInt(retryMatch[1], 10);
    }

    return null;
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Reset token usage (for testing or manual reset)
   */
  public reset(): void {
    this.tokenUsageHistory = [];
    this.currentTokens = 0;
    this.lastResetTime = Date.now();
  }
}

// Singleton instance
let rateLimiterInstance: RateLimiter | null = null;

/**
 * Get or create the rate limiter instance
 */
export function getRateLimiter(config?: Partial<RateLimitConfig>): RateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new RateLimiter(config);
  }
  return rateLimiterInstance;
}
