# Rate Limiting and Token Usage Optimization Guide

## Overview

This application includes a comprehensive rate limiting system to prevent hitting OpenAI API rate limits (429 errors). The system automatically manages token usage, queues requests, and handles retries with exponential backoff.

## Features

### 1. **Automatic Rate Limiting**
- Tracks token usage per minute
- Prevents exceeding your configured limit
- Automatically waits when approaching limits

### 2. **Request Queuing**
- Queues requests when at capacity
- Processes requests in priority order
- Prevents overwhelming the API

### 3. **Exponential Backoff**
- Automatically retries on 429 errors
- Increases wait time between retries
- Respects `retry-after` headers from API

### 4. **Token Usage Tracking**
- Monitors actual token consumption
- Provides real-time usage statistics
- Logs usage every 5 iterations

### 5. **Optimized Prompts**
- Reduced system prompt size (~60% reduction)
- Maintains functionality while using fewer tokens

## Configuration

### Environment Variables

Add these to your `.env` file:

```env
# Rate Limiting Configuration
TOKENS_PER_MINUTE=25000  # Set below your OpenAI limit (default: 30000)
MAX_ITERATIONS=50        # Maximum agent iterations
OPENAI_MODEL=gpt-4o      # Model to use
```

### Recommended Settings

- **TOKENS_PER_MINUTE**: Set to 80-85% of your actual limit
  - If limit is 30,000 → use 25,000
  - This leaves buffer for bursts and prevents hitting the limit

### Adjusting for Different Limits

If you upgrade your OpenAI plan and get higher limits:

1. Check your new limit at: https://platform.openai.com/account/rate-limits
2. Update `TOKENS_PER_MINUTE` in `.env` (use 80-85% of limit)
3. Restart the server

## How It Works

### Token Tracking

1. **Estimation**: Before each request, estimates token usage
2. **Capacity Check**: Verifies available token capacity
3. **Reservation**: Reserves estimated tokens
4. **Execution**: Makes API call
5. **Adjustment**: Updates with actual token usage from response

### Rate Limit Handling

When a 429 error occurs:

1. Extracts `retry-after` from error (if available)
2. Waits for specified time
3. Retries with exponential backoff
4. Logs retry attempts

### Request Queuing

When token capacity is low:

1. New requests are queued
2. Queue is sorted by priority
3. Requests execute as capacity becomes available
4. Prevents simultaneous requests that would exceed limits

## Monitoring

The system logs token usage every 5 iterations:

```
Token usage: 15,234/25,000 (60.9%)
```

Watch for:
- **> 80%**: Approaching limit, requests may queue
- **> 90%**: Very close to limit, expect delays
- **100%**: At limit, all requests will queue

## Troubleshooting

### Still Getting 429 Errors?

1. **Check your actual limit**: Visit https://platform.openai.com/account/rate-limits
2. **Reduce TOKENS_PER_MINUTE**: Lower it further (try 20,000)
3. **Check for multiple instances**: Ensure only one server instance is running
4. **Review token usage logs**: Look for spikes in usage

### Requests Taking Too Long?

1. **Increase TOKENS_PER_MINUTE**: If you have headroom, increase it
2. **Check queue size**: Large queues indicate capacity issues
3. **Reduce MAX_ITERATIONS**: Limit how many iterations the agent runs

### Token Usage Higher Than Expected?

1. **Review system prompt**: Already optimized, but check for unnecessary additions
2. **Check tool responses**: Large tool results increase token usage
3. **Monitor message history**: Long conversations use more tokens

## Best Practices

1. **Set conservative limits**: Use 80-85% of your actual limit
2. **Monitor usage**: Watch logs for patterns
3. **Upgrade if needed**: If consistently hitting limits, consider upgrading plan
4. **Optimize prompts**: Keep custom additions to system prompt minimal
5. **Batch operations**: The system already queues, but avoid rapid-fire requests

## Advanced Configuration

For fine-tuning, you can modify `rateLimiter.ts`:

```typescript
const rateLimiter = getRateLimiter({
  tokensPerMinute: 25000,
  requestsPerMinute: 50,      // Optional: limit request count
  maxRetries: 5,               // Max retries on 429
  initialRetryDelay: 1000,     // Initial wait (ms)
  maxRetryDelay: 60000,        // Max wait (ms)
  backoffMultiplier: 2         // Exponential backoff factor
});
```

## Upgrading Your OpenAI Plan

If you need higher limits:

1. **Upgrade at**: https://platform.openai.com/account/billing
2. **Check new limits**: https://platform.openai.com/account/rate-limits
3. **Update .env**: Set `TOKENS_PER_MINUTE` to 80-85% of new limit
4. **Restart server**: Changes take effect immediately

## Support

If you continue experiencing issues:

1. Check OpenAI status: https://status.openai.com/
2. Review error messages for specific details
3. Check server logs for rate limiter messages
4. Verify API key is valid and has proper permissions
