export interface AgentRequest {
  url: string;
  schema?: string;
}

export interface LogMessage {
  type: 'info' | 'success' | 'error' | 'warning' | 'agent';
  message: string;
  timestamp: string;
}

export interface ToolExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
}

export interface TestExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  testFiles?: string[];
}

export interface AgentResponse {
  success: boolean;
  message?: string;
  testFiles?: string[];
  error?: string;
}

export interface CustomTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
  execute: (args: any) => Promise<ToolExecutionResult>;
}
