#!/usr/bin/env node

/**
 * Enhanced MCP Handler with Conversation Streaming
 * Supports comprehensive data capture matching database mode capabilities
 */

import { readFileSync } from 'fs';
import { stdin, stdout } from 'process';

class EnhancedMCPHandler {
  constructor() {
    this.sessionId = null;
    this.sessionName = null;
    this.conversations = new Map(); // Track conversation threads
    this.companionUrl = process.env.COMPANION_URL || 'http://127.0.0.1:43917';
    this.setupStdin();
  }

  setupStdin() {
    let buffer = '';

    stdin.on('data', (data) => {
      buffer += data.toString();

      const lines = buffer.split('\n');
      buffer = lines.pop();

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
      console.error('[MCP] Failed to parse message:', error.message);
    }
  }

  processMessage(message) {
    const { method, params, id } = message;

    switch (method) {
      case 'initialize':
        this.handleInitialize(id);
        break;
      case 'logConversation':
        this.handleLogConversation(params, id);
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
      case 'streamConversation':
        this.handleStreamConversation(params, id);
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
            conversation: true,
            promptResponse: true,
            codeChange: true,
            events: true,
            streaming: true,
          },
          metadata: {
            contextUsage: true,
            linesChanged: true,
            aiMode: true,
            conversationThreading: true,
          },
        },
        serverInfo: {
          name: 'cursor-companion-enhanced',
          version: '2.0.0',
        },
      },
    };

    this.sendResponse(response);
  }

  /**
   * Enhanced conversation logging with full metadata
   */
  async handleLogConversation(params, id) {
    const {
      conversation_id,
      conversation_title,
      session_id,
      workspace_path,
      workspace_name,
      messages,
      metadata = {},
    } = params;

    if (session_id) {
      this.sessionId = session_id;
    }

    // Track conversation thread
    if (conversation_id) {
      this.conversations.set(conversation_id, {
        id: conversation_id,
        title: conversation_title,
        messages: messages || [],
        metadata,
        lastUpdate: Date.now(),
      });
    }

    // Send to companion service
    await this.sendToCompanion('POST', '/mcp/log-conversation', {
      conversation_id,
      conversation_title,
      session_id: this.sessionId,
      workspace_path,
      workspace_name,
      messages,
      metadata: {
        ...metadata,
        contextUsage: metadata.contextUsage || metadata.context_usage,
        linesAdded: metadata.linesAdded || metadata.lines_added,
        linesRemoved: metadata.linesRemoved || metadata.lines_removed,
        aiMode: metadata.aiMode || metadata.ai_mode || 'chat',
        model: metadata.model,
        finishReason: metadata.finishReason || metadata.finish_reason,
        thinkingTimeSeconds: metadata.thinkingTimeSeconds || metadata.thinking_time_seconds,
        contextFiles: metadata.contextFiles || metadata.context_files || [],
        atFiles: metadata.atFiles || metadata.at_files || [],
      },
    });

    this.sendResponse({
      jsonrpc: '2.0',
      id,
      result: { success: true, conversation_id },
    });
  }

  /**
   * Enhanced prompt/response logging with comprehensive metadata
   */
  async handleLogPromptResponse(params, id) {
    const {
      session_id,
      conversation_id,
      conversation_title,
      message_id,
      timestamp,
      file_path,
      workspace_path,
      workspace_name,
      prompt,
      response,
      message_role = 'user',
      metadata = {},
    } = params;

    if (session_id) {
      this.sessionId = session_id;
    }

    // Update conversation thread
    if (conversation_id) {
      const conv = this.conversations.get(conversation_id) || {
        id: conversation_id,
        title: conversation_title,
        messages: [],
        metadata: {},
        lastUpdate: Date.now(),
      };

      conv.messages.push({
        id: message_id,
        role: message_role,
        text: message_role === 'user' ? prompt : response,
        timestamp: timestamp || new Date().toISOString(),
        metadata,
      });

      if (conversation_title) conv.title = conversation_title;
      conv.lastUpdate = Date.now();
      this.conversations.set(conversation_id, conv);
    }

    // Send to companion service with enhanced metadata
    await this.sendToCompanion('POST', '/mcp/log-prompt-response', {
      session_id: this.sessionId,
      conversation_id,
      conversation_title,
      message_id,
      timestamp: timestamp || new Date().toISOString(),
      file_path: file_path || '',
      workspace_path,
      workspace_name,
      prompt: prompt || '',
      response: response || '',
      message_role,
      metadata: {
        ...metadata,
        contextUsage: metadata.contextUsage || metadata.context_usage,
        linesAdded: metadata.linesAdded || metadata.lines_added,
        linesRemoved: metadata.linesRemoved || metadata.lines_removed,
        aiMode: metadata.aiMode || metadata.ai_mode || 'chat',
        model: metadata.model,
        finishReason: metadata.finishReason || metadata.finish_reason,
        thinkingTimeSeconds: metadata.thinkingTimeSeconds || metadata.thinking_time_seconds,
        contextFiles: metadata.contextFiles || metadata.context_files || [],
        atFiles: metadata.atFiles || metadata.at_files || [],
        commandType: metadata.commandType || metadata.command_type,
        generationUUID: metadata.generationUUID || metadata.generation_uuid,
      },
    });

    this.sendResponse({
      jsonrpc: '2.0',
      id,
      result: { success: true, message_id },
    });
  }

  /**
   * Code change logging with diff metadata
   */
  async handleLogCodeChange(params, id) {
    const {
      session_id,
      conversation_id,
      timestamp,
      file_path,
      workspace_path,
      before_code,
      after_code,
      metadata = {},
    } = params;

    if (session_id) {
      this.sessionId = session_id;
    }

    // Calculate diff metrics
    const linesAdded =
      (after_code || '').split('\n').length - (before_code || '').split('\n').length;
    const linesRemoved = Math.max(0, -linesAdded);
    const actualLinesAdded = Math.max(0, linesAdded);

    await this.sendToCompanion('POST', '/mcp/log-code-change', {
      session_id: this.sessionId,
      conversation_id,
      timestamp: timestamp || new Date().toISOString(),
      file_path: file_path || '',
      workspace_path,
      before_code: before_code || '',
      after_code: after_code || '',
      metadata: {
        ...metadata,
        linesAdded: metadata.linesAdded || actualLinesAdded,
        linesRemoved: metadata.linesRemoved || linesRemoved,
        diffSize: metadata.diffSize || (after_code || '').length - (before_code || '').length,
      },
    });

    this.sendResponse({
      jsonrpc: '2.0',
      id,
      result: { success: true },
    });
  }

  /**
   * Event logging
   */
  async handleLogEvent(params, id) {
    const { session_id, type, details, file_path, timestamp } = params;

    if (session_id) {
      this.sessionId = session_id;
    }

    await this.sendToCompanion('POST', '/mcp/log-event', {
      session_id: this.sessionId,
      timestamp: timestamp || new Date().toISOString(),
      type: type || 'unknown',
      details: details || {},
      file_path,
    });

    this.sendResponse({
      jsonrpc: '2.0',
      id,
      result: { success: true },
    });
  }

  /**
   * Conversation streaming support
   */
  handleStreamConversation(params, id) {
    const { conversation_id, enable = true } = params;

    if (enable && conversation_id) {
      // Notify companion service to start streaming this conversation
      this.sendToCompanion('POST', '/mcp/stream-conversation', {
        conversation_id,
        enable: true,
      }).catch((err) => {
        console.error('[MCP] Failed to enable streaming:', err.message);
      });
    }

    this.sendResponse({
      jsonrpc: '2.0',
      id,
      result: { success: true, streaming: enable },
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
        active_conversations: Array.from(this.conversations.keys()),
      },
    });
  }

  handleSetConfig(params, id) {
    this.sendToCompanion('POST', '/config', params).catch((err) => {
      console.error('[MCP] Failed to update config:', err.message);
    });

    this.sendResponse({
      jsonrpc: '2.0',
      id,
      result: { success: true },
    });
  }

  async sendToCompanion(method, path, data) {
    try {
      const { default: fetch } = await import('node-fetch');

      const response = await fetch(`${this.companionUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[MCP] Companion API error: ${response.status} - ${errorText}`);
      } else {
        console.log(`[MCP] Sent to companion: ${method} ${path}`);
      }
    } catch (error) {
      console.error('[MCP] Failed to send to companion:', error.message);
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

// Start the enhanced MCP handler
new EnhancedMCPHandler();
