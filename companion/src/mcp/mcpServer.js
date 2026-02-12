import { spawn } from 'child_process';
import { queue } from './queue.js';
import { idleDetector } from './idleDetector.js';

class MCPServer {
  constructor() {
    this.process = null;
    this.isRunning = false;
    this.sessionId = null;
    this.sessionName = null;
  }

  start() {
    if (this.isRunning) {
      console.log('�MCP server already running');
      return;
    }

    console.log(' Starting MCP server...');

    // Start the MCP server process
    this.process = spawn('node', ['src/mcp-handler.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
    });

    this.process.stdout.on('data', (data) => {
      const lines = data
        .toString()
        .split('\n')
        .filter((line) => line.trim());
      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          this.handleMCPMessage(message);
        } catch (error) {
          console.error(' Failed to parse MCP message:', error.message);
        }
      }
    });

    this.process.stderr.on('data', (data) => {
      console.error('MCP stderr:', data.toString());
    });

    this.process.on('close', (code) => {
      console.log(` MCP server process exited with code ${code}`);
      this.isRunning = false;
    });

    this.isRunning = true;
    console.log(' MCP server started');
  }

  stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this.isRunning = false;
      console.log(' MCP server stopped');
    }
  }

  handleMCPMessage(message) {
    const { method, params, id } = message;

    console.log(` MCP message: ${method}`);

    switch (method) {
      case 'logPromptResponse':
        this.handleLogPromptResponse(params);
        break;
      case 'logCodeChange':
        this.handleLogCodeChange(params);
        break;
      case 'logEvent':
        this.handleLogEvent(params);
        break;
      case 'getSessionInfo':
        this.handleGetSessionInfo(id);
        break;
      case 'setConfig':
        this.handleSetConfig(params, id);
        break;
      default:
        console.warn(`�Unknown MCP method: ${method}`);
    }
  }

  handleLogPromptResponse(params) {
    const { session_id, timestamp, file_path, prompt, response } = params;

    // Update session info if provided
    if (session_id) {
      this.sessionId = session_id;
    }

    // Update activity
    idleDetector.onUserActivity();

    // Add to queue
    queue.addEntry({
      source: 'mcp',
      session_id: this.sessionId,
      file_path: file_path || '',
      prompt: prompt || '',
      response: response || '',
      notes: 'Logged via MCP',
    });
  }

  handleLogCodeChange(params) {
    const { session_id, timestamp, file_path, before_code, after_code } = params;

    // Update session info if provided
    if (session_id) {
      this.sessionId = session_id;
    }

    // Update activity
    idleDetector.onUserActivity();

    // Add to queue
    queue.addEntry({
      source: 'mcp',
      session_id: this.sessionId,
      file_path: file_path || '',
      before_code: before_code || '',
      after_code: after_code || '',
      notes: 'Code change logged via MCP',
    });
  }

  handleLogEvent(params) {
    const { session_id, timestamp, type, details } = params;

    // Update session info if provided
    if (session_id) {
      this.sessionId = session_id;
    }

    // Update activity
    idleDetector.onUserActivity();

    // Add to queue
    queue.addEvent({
      session_id: this.sessionId,
      type: type || 'unknown',
      details: details || {},
    });
  }

  handleGetSessionInfo(id) {
    const response = {
      jsonrpc: '2.0',
      id,
      result: {
        session_id: this.sessionId,
        name: this.sessionName || 'Unknown Session',
        created_at: new Date().toISOString(),
      },
    };

    console.log(JSON.stringify(response));
  }

  handleSetConfig(params, id) {
    const { root_dir, ignore, diff_threshold } = params;

    // Update configuration (this would need to be implemented)
    console.log(' MCP config update:', params);

    const response = {
      jsonrpc: '2.0',
      id,
      result: { success: true },
    };

    console.log(JSON.stringify(response));
  }

  getStatus() {
    return {
      is_running: this.isRunning,
      session_id: this.sessionId,
      session_name: this.sessionName,
    };
  }
}

export const mcpServer = new MCPServer();
