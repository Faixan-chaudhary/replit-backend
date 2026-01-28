import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import OpenAI from 'openai';
import { getCustomTools } from './tools';
import { LogMessage } from './types';
import { getRateLimiter } from './rateLimiter';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

const MAX_ITERATIONS = parseInt(process.env.MAX_ITERATIONS || '50', 10);
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const TOKENS_PER_MINUTE = parseInt(process.env.TOKENS_PER_MINUTE || '25000', 10);
const MAX_TOOL_RESULT_LENGTH = 3000; // Truncate large tool results to save tokens
const MAX_MESSAGES = 25; // Keep only recent messages to prevent token explosion

let mcpClient: Client | null = null;
let mcpTransport: StdioClientTransport | null = null;

/**
 * Truncate tool result to reduce token usage
 */
function truncateToolResult(result: any, toolName: string): string {
  let content = typeof result === 'string' ? result : JSON.stringify(result);
  
  // browser_snapshot returns huge accessibility trees - extract only essentials
  if (toolName === 'browser_snapshot' && typeof result === 'object') {
    try {
      const brief: any = { url: result.url, title: result.title };
      if (result.content && Array.isArray(result.content)) {
        // Extract just text content, limited
        const text = result.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text?.substring(0, 800))
          .join('\n')
          .substring(0, 2000);
        brief.snapshot = text;
      }
      content = JSON.stringify(brief);
    } catch { /* fallback to truncation */ }
  }
  
  if (content.length > MAX_TOOL_RESULT_LENGTH) {
    return content.substring(0, MAX_TOOL_RESULT_LENGTH) + '...[truncated]';
  }
  return content;
}

/**
 * Prune message history to keep token usage manageable
 */
function pruneMessages(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): void {
  // Keep: system (0), initial user (1), and last N messages
  if (messages.length <= MAX_MESSAGES + 2) return;
  
  const system = messages[0];
  const userStart = messages[1];
  const recent = messages.slice(-(MAX_MESSAGES));
  
  messages.length = 0;
  messages.push(system, userStart, ...recent);
  console.log(`📉 Pruned messages to ${messages.length} to save tokens`);
}

/**
 * Initialize MCP client connection to Playwright MCP server
 */
export async function initializeMCPClient(): Promise<void> {
  if (mcpClient) {
    return; // Already initialized
  }

  try {
    // Use runtime dynamic import helper so that TypeScript (compiled as CommonJS)
    // does NOT transform this into require(), which would break on ESM modules.
    const dynamicImport = new Function(
      'specifier',
      'return import(specifier);'
    ) as (specifier: string) => Promise<any>;

    const { Client } = await dynamicImport('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = await dynamicImport('@modelcontextprotocol/sdk/client/stdio.js');
    const isWindows = os.platform() === 'win32';
    let npxCommand = 'npx';
    let npxArgs = ['-y', '@playwright/mcp@latest'];
    
    if (isWindows) {
      // On Windows, we need to handle npm/npx differently
      // First, try to find npx.cmd in node_modules/.bin
      const localNpxPath = path.join(__dirname, '..', 'node_modules', '.bin', 'npx.cmd');
      
      if (fs.existsSync(localNpxPath)) {
        npxCommand = localNpxPath;
        console.log(`✅ Found local npx at: ${localNpxPath}`);
      } else {
        // Try to find npm in the system
        let npmFound = false;
        
        // Method 1: Try to find npm relative to node executable (most reliable)
        try {
          const nodeDir = path.dirname(process.execPath);
          const npmPath = path.join(nodeDir, 'npm.cmd');
          if (fs.existsSync(npmPath)) {
            npxCommand = 'cmd.exe';
            npxArgs = ['/c', npmPath, 'exec', '-y', '@playwright/mcp@latest'];
            console.log(`✅ Using npm from node directory: ${npmPath}`);
            npmFound = true;
          }
        } catch (e) {
          // Continue to next method
        }
        
        // Method 2: Try to find npm using where command
        if (!npmFound) {
          try {
            const npmPath = execSync('where npm.cmd', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
              .trim()
              .split('\n')[0]
              .trim();
            if (npmPath && fs.existsSync(npmPath)) {
              npxCommand = 'cmd.exe';
              npxArgs = ['/c', 'npm.cmd', 'exec', '-y', '@playwright/mcp@latest'];
              console.log(`✅ Found npm via where command: ${npmPath}`);
              npmFound = true;
            }
          } catch (e) {
            // Continue to fallback
          }
        }
        
        // Method 3: Fallback - use cmd.exe with npm.cmd (assumes it's in PATH)
        if (!npmFound) {
          npxCommand = 'cmd.exe';
          npxArgs = ['/c', 'npm.cmd', 'exec', '-y', '@playwright/mcp@latest'];
          console.log(`⚠️  Using npm.cmd via cmd.exe (assuming it's in PATH)`);
        }
      }
    }

    console.log(`🔧 Initializing MCP client with: ${npxCommand} ${npxArgs.join(' ')}`);

    const transport = new StdioClientTransport({
      command: npxCommand,
      args: npxArgs
    });

    const client = new Client({
      name: 'qa-app-host',
      version: '1.0.0'
    }, {
      capabilities: {}
    });

    await client.connect(transport);
    mcpTransport = transport;
    mcpClient = client;
    console.log('MCP client connected successfully');
  } catch (error: any) {
    console.error('Failed to initialize MCP client:', error);
    throw new Error(`MCP initialization failed: ${error.message}`);
  }
}

/**
 * Get all available tools (MCP + custom)
 */
async function getAllTools() {
  if (!mcpClient) {
    throw new Error('MCP client not initialized');
  }

  const mcpTools = await mcpClient.listTools();
  const customTools = getCustomTools();

  // Combine MCP tools with custom tools
  const allTools = [
    ...mcpTools.tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema
      }
    })),
    ...customTools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema
      }
    }))
  ];

  return { allTools, customTools };
}

/**
 * Execute a tool call (either MCP or custom)
 */
async function executeTool(
  toolName: string,
  args: any,
  customTools: ReturnType<typeof getCustomTools>
): Promise<any> {
  // Check if it's a custom tool
  const customTool = customTools.find(t => t.name === toolName);
  if (customTool) {
    return await customTool.execute(args);
  }

  // Otherwise, execute via MCP
  if (!mcpClient) {
    throw new Error('MCP client not initialized');
  }

  try {
    const result = await mcpClient.callTool({
      name: toolName,
      arguments: args
    });

    // Check if MCP returned an error in the result
    if (result && typeof result === 'object') {
      // MCP tools may return errors in content field
      if ('content' in result && Array.isArray(result.content)) {
        for (const item of result.content) {
          if (item.type === 'text' && item.text) {
            // Check if the text contains error indicators
            const text = item.text;
            if (text.includes('Error:') || text.includes('error:') || text.includes('Unknown error')) {
              throw new Error(text);
            }
          }
        }
      }
      // Some MCP tools return errors directly
      if ('isError' in result && result.isError) {
        const resultAny = result as any;
        const errorMsg = (Array.isArray(resultAny.content) && resultAny.content[0]?.text) 
          || resultAny.message 
          || 'Unknown error from MCP tool';
        throw new Error(errorMsg);
      }
    }

    return result;
  } catch (error: any) {
    // Provide more detailed error information
    const errorMessage = error.message || error.toString() || 'Unknown error';
    console.error(`MCP tool execution error for ${toolName}:`, error);
    throw new Error(`MCP tool "${toolName}" failed: ${errorMessage}`);
  }
}

/**
 * Run the agent loop to explore a website and generate tests
 */
export async function runAgent(
  targetUrl: string,
  schema: string | undefined,
  onLog: (log: LogMessage) => void
): Promise<{ success: boolean; message?: string; testFiles?: string[]; error?: string }> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  // Initialize rate limiter
  const rateLimiter = getRateLimiter({
    tokensPerMinute: TOKENS_PER_MINUTE,
    maxRetries: 5,
    initialRetryDelay: 1000,
    maxRetryDelay: 60000
  });

  // Initialize MCP client if not already done
  await initializeMCPClient();

  const { allTools, customTools } = await getAllTools();

  const isSauceDemo = /saucedemo\.com/i.test(targetUrl);

  // Minimal system prompt
  const systemPrompt = `QA automation agent. Explore site → Generate 1 test file → Run tests → Close browser → Return JSON and STOP.

WORKFLOW:
1. browser_navigate to URL, browser_snapshot to see page
2. Explore key flows (login, forms, navigation)
3. saveTestFile with timestamped filename
4. runPlaywrightTests
5. browser_close
6. Return JSON below and STOP (no more actions)
${schema ? `\nAPI Schema:\n${schema}\n` : ''}${isSauceDemo ? `\nSauceDemo creds: standard_user/secret_sauce, locked_out_user. Use data-test selectors.` : ''}

RULES: 1 test file only. Dismiss popups. STOP after tests run.

Final JSON:
{"summary":"...","generatedFiles":[],"results":{"status":"passed|failed","details":"..."}}`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: systemPrompt
    },
    {
      role: 'user',
      content: `Test: ${targetUrl}${isSauceDemo ? ' (SauceDemo - test login + purchase flow)' : ''}`
    }
  ];

  let iterations = 0;
  let consecutiveNavigateBack = 0;
  let consecutiveToolFailures = 0;
  let testsHaveRun = false;
  let iterationsSinceTests = 0;
  const MAX_CONSECUTIVE_FAILURES = 5;

  try {
    while (iterations < MAX_ITERATIONS) {
      iterations++;

      onLog({
        type: 'agent',
        message: `Agent iteration ${iterations}: Thinking...`,
        timestamp: new Date().toISOString()
      });

      // If tests have run, remind agent to finish
      if (testsHaveRun) {
        iterationsSinceTests++;
        if (iterationsSinceTests >= 2) {
          onLog({
            type: 'warning',
            message: 'Tests done. Finishing...',
            timestamp: new Date().toISOString()
          });
          messages.push({
            role: 'user',
            content: 'Tests done. Call browser_close, return JSON, STOP.'
          });
          iterationsSinceTests = 0;
        }
      }

      // Estimate tokens for this request
      const estimatedTokens = estimateRequestTokens(messages, allTools);
      const stats = rateLimiter.getTokenStats();
      
      if (iterations % 5 === 0) {
        onLog({
          type: 'info',
          message: `Token usage: ${stats.current.toLocaleString()}/${stats.limit.toLocaleString()} (${stats.percentage.toFixed(1)}%)`,
          timestamp: new Date().toISOString()
        });
      }

      // Call OpenAI with rate limiting and retry logic
      // The rate limiter will automatically extract and record actual token usage from the response
      const response = await rateLimiter.executeWithRateLimit(
        async () => {
          return await openai.chat.completions.create({
            model: OPENAI_MODEL,
            messages: messages,
            tools: allTools,
            tool_choice: 'auto'
          });
        },
        estimatedTokens,
        1 // Priority
      );

      const assistantMessage = response.choices[0].message;
      messages.push(assistantMessage);

      // Prune old messages to prevent token explosion
      pruneMessages(messages);

      // If no tool calls, agent is done
      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        const rawFinal = assistantMessage.content || 'Agent completed successfully.';

        // Try to parse the model's final JSON for a clean, formatted summary.
        let formattedSummary = rawFinal;
        try {
          const parsed = JSON.parse(rawFinal);
          formattedSummary =
            `Summary: ${parsed.summary}\n` +
            `GeneratedFiles: ${(parsed.generatedFiles || []).join(', ') || 'none'}\n` +
            `CommandsRun: ${(parsed.commandsRun || []).join(', ') || 'none'}\n` +
            `Results: ${parsed.results?.status || 'unknown'} - ${parsed.results?.details || ''}\n` +
            `NextSteps: ${(parsed.nextSteps || []).join(' | ') || 'none'}`;
        } catch {
          // Keep raw text as fallback.
        }

        onLog({
          type: 'success',
          message: `Agent completed:\n${formattedSummary}`,
          timestamp: new Date().toISOString()
        });

        // Get list of test files
        const { listTestFiles: getTestFiles } = await import('./tools');
        const testFilesResult = await getTestFiles();
        const testFiles = testFilesResult.success && testFilesResult.result?.files
          ? testFilesResult.result.files
          : [];

        return {
          success: true,
          message: formattedSummary,
          testFiles: testFiles
        };
      }

      // Execute tool calls
      for (const toolCall of assistantMessage.tool_calls) {
        const toolName = toolCall.function.name;
        let toolArgs: any;
        
        try {
          toolArgs = JSON.parse(toolCall.function.arguments || '{}');
        } catch (e) {
          toolArgs = {};
        }

        onLog({
          type: 'info',
          message: `Executing tool: ${toolName}${toolArgs.filePath ? ` (${toolArgs.filePath})` : ''}`,
          timestamp: new Date().toISOString()
        });

        try {
          // Guard: prevent infinite/invalid back navigation loops (common cause of "history exhausted").
          if (toolName === 'browser_navigate_back') {
            consecutiveNavigateBack += 1;
            if (consecutiveNavigateBack > 2) {
              const msg =
                'Blocked browser_navigate_back: navigation history likely exhausted. ' +
                'Instead, navigate using explicit URLs (browser_navigate) or click links/buttons.';
              onLog({ type: 'warning', message: msg, timestamp: new Date().toISOString() });
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({ success: false, error: msg })
              });
              continue;
            }
          } else {
            consecutiveNavigateBack = 0;
          }

          const toolResult = await executeTool(toolName, toolArgs, customTools);
          
          // Format and truncate result to save tokens
          const resultContent = truncateToolResult(toolResult, toolName);

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: resultContent
          });

          // Reset consecutive failures on success
          consecutiveToolFailures = 0;

          // Log success and track state
          if (toolName === 'saveTestFile' && toolResult.success) {
            onLog({
              type: 'success',
              message: `✓ Test file saved: ${toolArgs.filePath}`,
              timestamp: new Date().toISOString()
            });
          } else if (toolName === 'runPlaywrightTests') {
            testsHaveRun = true;
            iterationsSinceTests = 0;
            onLog({
              type: toolResult.success ? 'success' : 'warning',
              message: `Test execution ${toolResult.success ? 'completed' : 'failed'}`,
              timestamp: new Date().toISOString()
            });
          } else if (toolName === 'browser_close') {
            onLog({
              type: 'info',
              message: '🔒 Browser closed',
              timestamp: new Date().toISOString()
            });
          }
        } catch (error: any) {
          consecutiveToolFailures++;
          const errorMessage = `Tool execution failed: ${error.message}`;
          onLog({
            type: 'error',
            message: errorMessage,
            timestamp: new Date().toISOString()
          });

          // Bail out if too many consecutive failures
          if (consecutiveToolFailures >= MAX_CONSECUTIVE_FAILURES) {
            onLog({
              type: 'warning',
              message: `⚠️  Too many consecutive tool failures (${consecutiveToolFailures}). Aborting exploration and finishing.`,
              timestamp: new Date().toISOString()
            });
            messages.push({
              role: 'user',
              content: 'Too many tool errors. Call browser_close immediately and return final JSON with error summary. STOP.'
            });
            consecutiveToolFailures = 0; // Reset
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: errorMessage })
          });
        }
      }
    }

    // Max iterations reached
    return {
      success: false,
      error: `Agent reached maximum iterations (${MAX_ITERATIONS})`
    };
  } catch (error: any) {
    onLog({
      type: 'error',
      message: `Agent error: ${error.message}`,
      timestamp: new Date().toISOString()
    });

    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Estimate tokens for a request (rough approximation)
 */
function estimateRequestTokens(messages: any[], tools?: any[]): number {
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
 * Cleanup MCP client connection
 */
export async function cleanupMCPClient(): Promise<void> {
  if (mcpTransport) {
    try {
      await mcpTransport.close();
    } catch (error) {
      console.error('Error closing MCP transport:', error);
    }
    mcpTransport = null;
  }
  mcpClient = null;
}

