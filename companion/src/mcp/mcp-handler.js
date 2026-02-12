#!/usr/bin/env node

import { readFileSync } from 'fs';
import { stdin, stdout } from 'process';

// MCP Protocol Handler
// This script handles JSON-RPC communication with Cursor via stdio

class MCPHandler {
  constructor() {
    this.sessionId = null;
    this.sessionName = null;
    this.setupStdin();
  }

  setupStdin() {
    let buffer = '';

    stdin.on('data', (data) => {
      buffer += data.toString();

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          this.handleMessage(line.trim());
        }
      }
    });
  }

  handleMessage(line) {
    try {
      const message = JSON.parse(line);
      this.processMessage(message);
    } catch (error) {
      console.error(' Failed to parse message:', error.message);
    }
  }

  processMessage(message) {
    const { method, params, id } = message;

    switch (method) {
      case 'initialize':
        this.handleInitialize(id);
        break;
      case 'logPromptResponse':
        this.handleLogPromptResponse(params, id);
        break;
      case 'logCodeChange':
        this.handleLogCodeChange(params, id);
        break;
      case 'logEvent':
        this.handleLogEvent(params, id);
        break;
      case 'getSessionInfo':
        this.handleGetSessionInfo(id);
        break;
      case 'setConfig':
        this.handleSetConfig(params, id);
        break;
      default:
        this.sendError(id, -32601, `Method not found: ${method}`);
    }
  }

  handleInitialize(id) {
    const response = {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          logging: {
            promptResponse: true,
            codeChange: true,
            events: true,
          },
        },
        serverInfo: {
          name: 'cursor-companion',
          version: '1.0.0',
        },
      },
    };

    this.sendResponse(response);
  }

  handleLogPromptResponse(params, id) {
    const { session_id, timestamp, file_path, prompt, response } = params;

    // Update session info
    if (session_id) {
      this.sessionId = session_id;
    }

    // Send to companion service via HTTP
    this.sendToCompanion('POST', '/mcp/log-prompt-response', {
      session_id: this.sessionId,
      timestamp: timestamp || new Date().toISOString(),
      file_path: file_path || '',
      prompt: prompt || '',
      response: response || '',
    });

    this.sendResponse({
      jsonrpc: '2.0',
      id,
      result: { success: true },
    });
  }

  handleLogCodeChange(params, id) {
    const { session_id, timestamp, file_path, before_code, after_code } = params;

    // Update session info
    if (session_id) {
      this.sessionId = session_id;
    }

    // Send to companion service via HTTP
    this.sendToCompanion('POST', '/mcp/log-code-change', {
      session_id: this.sessionId,
      timestamp: timestamp || new Date().toISOString(),
      file_path: file_path || '',
      before_code: before_code || '',
      after_code: after_code || '',
    });

    this.sendResponse({
      jsonrpc: '2.0',
      id,
      result: { success: true },
    });
  }

  handleLogEvent(params, id) {
    const { session_id, timestamp, type, details } = params;

    // Update session info
    if (session_id) {
      this.sessionId = session_id;
    }

    // Send to companion service via HTTP
    this.sendToCompanion('POST', '/mcp/log-event', {
      session_id: this.sessionId,
      timestamp: timestamp || new Date().toISOString(),
      type: type || 'unknown',
      details: details || {},
    });

    this.sendResponse({
      jsonrpc: '2.0',
      id,
      result: { success: true },
    });
  }

  handleGetSessionInfo(id) {
    this.sendResponse({
      jsonrpc: '2.0',
      id,
      result: {
        session_id: this.sessionId,
        name: this.sessionName || 'Unknown Session',
        created_at: new Date().toISOString(),
      },
    });
  }

  handleSetConfig(params, id) {
    // Send to companion service via HTTP
    this.sendToCompanion('POST', '/config', params);

    this.sendResponse({
      jsonrpc: '2.0',
      id,
      result: { success: true },
    });
  }

  async sendToCompanion(method, path, data) {
    try {
      // Import fetch dynamically for Node.js compatibility
      const { default: fetch } = await import('node-fetch');

      const response = await fetch(`http://127.0.0.1:43917${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        console.error(` Companion API error: ${response.status}`);
      } else {
        console.log(` Sent to companion: ${method} ${path}`);
      }
    } catch (error) {
      console.error(' Failed to send to companion:', error.message);
    }
  }

  sendResponse(response) {
    stdout.write(JSON.stringify(response) + '\n');
  }

  sendError(id, code, message) {
    this.sendResponse({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    });
  }
}

// Start the MCP handler
new MCPHandler();
