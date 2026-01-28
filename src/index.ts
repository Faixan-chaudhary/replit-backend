import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { runAgent, cleanupMCPClient } from './agent';
import { AgentRequest, LogMessage } from './types';

dotenv.config();

const app = express();
// Backend should run on 3001, frontend on 3000
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

// Debug: Log which port we're trying to use
if (process.env.PORT) {
  console.log(`📌 Using PORT from environment: ${process.env.PORT}`);
} else {
  console.log(`📌 Using default PORT: ${PORT}`);
}

// Middleware
app.use(cors());
app.use(express.json());

// Validate environment variables
if (!process.env.OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY environment variable is not set');
  console.error('Please create a .env file with your OpenAI API key');
  process.exit(1);
} else {
  // Confirm API key is loaded (show first 8 chars for verification)
  const keyPreview = process.env.OPENAI_API_KEY.substring(0, 8) + '...';
  console.log(`✅ OpenAI API key loaded: ${keyPreview}`);
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start test generation endpoint with SSE
app.post('/api/start-test', async (req, res) => {
  const { url, schema }: AgentRequest = req.body;

  // Validate URL
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required and must be a string' });
  }

  // Basic URL validation
  try {
    new URL(url);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Connected to agent stream' })}\n\n`);

  // Keep-alive heartbeat (prevents connection timeout during long waits)
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 10000);

  // Log callback function
  const sendLog = (log: LogMessage) => {
    try {
      res.write(`data: ${JSON.stringify(log)}\n\n`);
    } catch (error) {
      console.error('Error sending log:', error);
    }
  };

  try {
    sendLog({
      type: 'info',
      message: `Starting test generation for URL: ${url}`,
      timestamp: new Date().toISOString()
    });

    const result = await runAgent(url, schema, sendLog);
    clearInterval(heartbeat);

    // Send final result
    res.write(`data: ${JSON.stringify({ type: 'complete', ...result })}\n\n`);
    res.end();
  } catch (error: any) {
    clearInterval(heartbeat);
    sendLog({
      type: 'error',
      message: `Fatal error: ${error.message}`,
      timestamp: new Date().toISOString()
    });

    res.write(`data: ${JSON.stringify({ 
      type: 'error', 
      error: error.message 
    })}\n\n`);
    res.end();
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  await cleanupMCPClient();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down gracefully...');
  await cleanupMCPClient();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 QA_APP Server running on http://localhost:${PORT}`);
  console.log(`📝 Health check: http://localhost:${PORT}/health`);
}).on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ ERROR: Port ${PORT} is already in use!`);
    console.error(`   This usually means:`);
    console.error(`   1. Another instance of the server is already running`);
    console.error(`   2. Another application is using port ${PORT}`);
    console.error(`\n   Solutions:`);
    console.error(`   - Stop the other process using port ${PORT}`);
    console.error(`   - Or set a different PORT in your .env file`);
    console.error(`   - Or kill the process: npx kill-port ${PORT}`);
    process.exit(1);
  } else {
    console.error('Server error:', err);
    process.exit(1);
  }
});
