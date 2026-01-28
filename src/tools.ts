import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { CustomTool, ToolExecutionResult, TestExecutionResult } from './types';

const execAsync = promisify(exec);
const TESTS_DIR = path.join(__dirname, '..', 'tests');

// Ensure tests directory exists
if (!fs.existsSync(TESTS_DIR)) {
  fs.mkdirSync(TESTS_DIR, { recursive: true });
}

/**
 * Sanitize file path to prevent directory traversal attacks
 */
function sanitizePath(filePath: string): string {
  // Remove any path traversal attempts
  const normalized = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
  // Ensure it stays within tests directory
  const fullPath = path.join(TESTS_DIR, normalized);
  const relativePath = path.relative(TESTS_DIR, fullPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Invalid file path: directory traversal detected');
  }
  return fullPath;
}

/**
 * Save a test file to the tests directory
 */
export async function saveTestFile(filePath: string, content: string): Promise<ToolExecutionResult> {
  try {
    const safePath = sanitizePath(filePath);
    const dir = path.dirname(safePath);
    
    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(safePath, content, 'utf-8');
    
    return {
      success: true,
      result: {
        filePath: safePath,
        message: `Test file saved successfully: ${filePath}`
      }
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to save test file: ${error.message}`
    };
  }
}

/**
 * Run Playwright tests
 */
export async function runPlaywrightTests(testFile?: string): Promise<ToolExecutionResult> {
  try {
    const cmd = testFile
      ? `npx playwright test ${testFile}`
      : 'npx playwright test';

    const { stdout, stderr } = await execAsync(cmd, {
      cwd: path.join(__dirname, '..'),
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    });
    
    return {
      success: true,
      result: {
        output: stdout,
        error: stderr || undefined
      }
    };
  } catch (error: any) {
    // Playwright test failures still return error code, so we need to check
    const output = error.stdout || '';
    const errorOutput = error.stderr || '';
    
    return {
      success: false,
      error: `Test execution failed: ${error.message}`,
      result: {
        output: output + errorOutput
      }
    };
  }
}

/**
 * List all test files in the tests directory
 */
export async function listTestFiles(): Promise<ToolExecutionResult> {
  try {
    const entries = fs.readdirSync(TESTS_DIR, { recursive: true });
    const files = entries
      .filter((entry): entry is string => typeof entry === 'string')
      .filter((file) => file.endsWith('.spec.ts') || file.endsWith('.spec.js'))
      .map((file) => path.join(TESTS_DIR, file));
    
    return {
      success: true,
      result: {
        files: files,
        count: files.length
      }
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to list test files: ${error.message}`
    };
  }
}

/**
 * Get custom tools that can be exposed to the LLM
 */
export function getCustomTools(): CustomTool[] {
  return [
    {
      name: 'saveTestFile',
      description: 'Save a Playwright test file to the tests directory. The filePath should be relative to the tests directory (e.g., "login.spec.ts"). The content should be valid TypeScript/JavaScript Playwright test code.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Relative path to the test file (e.g., "login.spec.ts" or "auth/login.spec.ts")'
          },
          content: {
            type: 'string',
            description: 'The complete test file content as a string'
          }
        },
        required: ['filePath', 'content']
      },
      execute: async (args: { filePath: string; content: string }) => {
        return await saveTestFile(args.filePath, args.content);
      }
    },
    {
      name: 'runPlaywrightTests',
      description: 'Execute Playwright tests. Optionally provide a single testFile (relative to server/, e.g. "tests/login.spec.ts") to avoid running unrelated failing suites.',
      inputSchema: {
        type: 'object',
        properties: {
          testFile: {
            type: 'string',
            description: 'Optional single test file path relative to server/ (e.g., "tests/login.spec.ts")'
          }
        },
        required: []
      },
      execute: async (args: { testFile?: string }) => {
        return await runPlaywrightTests(args?.testFile);
      }
    },
    {
      name: 'listTestFiles',
      description: 'List all test files that have been generated in the tests directory.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      },
      execute: async () => {
        return await listTestFiles();
      }
    }
  ];
}
