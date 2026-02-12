#!/usr/bin/env node

/**
 * Status Message Tracker
 * Captures Cursor's UI status messages like "Read X file", "Planning next moves", etc.
 * and links them to context changes
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const EventEmitter = require('events');

const execAsync = promisify(exec);

class StatusMessageTracker extends EventEmitter {
  constructor(persistentDB = null) {
    super();
    this.persistentDB = persistentDB;
    this.statusHistory = [];
    this.lastStatus = null;
    this.monitorInterval = null;
    this.isActive = false;
  }

  /**
   * Start monitoring Cursor status messages
   */
  start(intervalMs = 2000) {
    if (this.isActive) return;

    this.isActive = true;
    this.monitorInterval = setInterval(async () => {
      try {
        await this.captureStatusMessage();
      } catch (error) {
        console.warn('Error capturing status message:', error.message);
      }
    }, intervalMs);

    console.log('[STATUS] Status message tracker started');
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      this.isActive = false;
      console.log('[STATUS] Status message tracker stopped');
    }
  }

  /**
   * Capture current status message from Cursor UI
   */
  async captureStatusMessage() {
    try {
      // Try to get status message from Cursor UI via AppleScript
      const statusText = await this.getCursorStatusText();

      if (!statusText || statusText === this.lastStatus) {
        return; // No change
      }

      // Parse the status message
      const parsed = this.parseStatusMessage(statusText);

      if (parsed) {
        const statusRecord = {
          id: `status-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          timestamp: Date.now(),
          message: statusText,
          type: parsed.type,
          action: parsed.action,
          filePath: parsed.filePath,
          fileName: parsed.fileName,
          metadata: parsed.metadata,
        };

        // Store in memory
        this.statusHistory.push(statusRecord);
        if (this.statusHistory.length > 1000) {
          this.statusHistory = this.statusHistory.slice(-1000);
        }

        // Persist to database
        if (this.persistentDB) {
          try {
            await this.persistentDB.saveStatusMessage(statusRecord);
          } catch (error) {
            console.error('Error saving status message:', error);
          }
        }

        // Emit event
        this.emit('statusMessage', statusRecord);

        // Link to context changes if applicable
        if (parsed.type === 'file_read' && parsed.filePath) {
          this.emit('fileRead', {
            filePath: parsed.filePath,
            timestamp: statusRecord.timestamp,
            statusId: statusRecord.id,
          });
        }

        this.lastStatus = statusText;
        console.log(`[STATUS] Captured: ${statusText}`);
      }
    } catch (error) {
      // Silently handle errors (AppleScript may not work in all environments)
      if (!error.message.includes('AppleScript') && !error.message.includes('permission')) {
        console.warn('Error in status message capture:', error.message);
      }
    }
  }

  /**
   * Get status text from Cursor UI using AppleScript
   */
  async getCursorStatusText() {
    try {
      const script = `
        tell application "System Events"
          tell process "Cursor"
            try
              -- Try to find status bar or notification area
              set statusText to ""
              
              -- Method 1: Check status bar
              try
                set statusBar to group 1 of window 1
                set statusText to value of static text of statusBar
              end try
              
              -- Method 2: Check notification/status area
              try
                set notifications to UI elements of window 1 whose description contains "status" or description contains "notification"
                if (count of notifications) > 0 then
                  set statusText to value of item 1 of notifications
                end if
              end try
              
              -- Method 3: Check for text containing common status patterns
              try
                set allTexts to static texts of window 1
                repeat with aText in allTexts
                  set textValue to value of aText
                  if textValue contains "Read" or textValue contains "Planning" or textValue contains "Analyzing" or textValue contains "Processing" then
                    set statusText to textValue
                    exit repeat
                  end if
                end repeat
              end try
              
              return statusText
            on error
              return ""
            end try
          end tell
        end tell
      `;

      const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
      return stdout.trim();
    } catch (error) {
      // Return null if AppleScript fails (expected in many environments)
      return null;
    }
  }

  /**
   * Parse status message to extract structured information
   */
  parseStatusMessage(message) {
    if (!message || typeof message !== 'string') return null;

    const lowerMessage = message.toLowerCase();

    // Pattern: "Read X file" or "Reading file"
    const readFileMatch = message.match(
      /(?:read|reading)\s+(?:(\d+)\s+)?(?:file|files)?\s*(?:[:]?\s*)?([^\s]+(?:\.[a-zA-Z0-9]+)?)/i
    );
    if (readFileMatch) {
      return {
        type: 'file_read',
        action: 'read_file',
        fileCount: readFileMatch[1] ? parseInt(readFileMatch[1]) : 1,
        fileName: readFileMatch[2] || null,
        filePath: readFileMatch[2] || null,
        metadata: {
          originalMessage: message,
        },
      };
    }

    // Pattern: "Planning next moves" or "Planning"
    if (lowerMessage.includes('planning') || lowerMessage.includes('plan next')) {
      return {
        type: 'planning',
        action: 'planning',
        metadata: {
          originalMessage: message,
        },
      };
    }

    // Pattern: "Analyzing code" or "Analyzing"
    if (lowerMessage.includes('analyzing')) {
      return {
        type: 'analysis',
        action: 'analyzing',
        metadata: {
          originalMessage: message,
          analysisType: lowerMessage.includes('code') ? 'code' : 'general',
        },
      };
    }

    // Pattern: "Processing" or "Processing request"
    if (lowerMessage.includes('processing')) {
      return {
        type: 'processing',
        action: 'processing',
        metadata: {
          originalMessage: message,
        },
      };
    }

    // Pattern: "Thinking" or "Thinking..."
    if (lowerMessage.includes('thinking')) {
      return {
        type: 'thinking',
        action: 'thinking',
        metadata: {
          originalMessage: message,
        },
      };
    }

    // Pattern: "Generating code" or "Generating"
    if (lowerMessage.includes('generating')) {
      return {
        type: 'generating',
        action: 'generating_code',
        metadata: {
          originalMessage: message,
        },
      };
    }

    // Pattern: "Searching" or "Searching for"
    if (lowerMessage.includes('searching')) {
      const searchMatch = message.match(/searching\s+(?:for\s+)?(.+)/i);
      return {
        type: 'searching',
        action: 'searching',
        metadata: {
          originalMessage: message,
          searchQuery: searchMatch ? searchMatch[1] : null,
        },
      };
    }

    // Generic status message
    return {
      type: 'status',
      action: 'unknown',
      metadata: {
        originalMessage: message,
      },
    };
  }

  /**
   * Get status messages for a time range
   */
  getStatusMessages(startTime, endTime) {
    return this.statusHistory.filter(
      (status) => status.timestamp >= startTime && status.timestamp <= endTime
    );
  }

  /**
   * Get status messages for a specific prompt/event
   */
  getStatusMessagesForPrompt(promptId, timeWindow = 30000) {
    // This would need prompt timestamp - would need to be called with context
    return this.statusHistory; // Placeholder
  }

  /**
   * Link status message to context change
   */
  linkStatusToContextChange(statusId, contextChangeId) {
    // Store relationship in database
    if (this.persistentDB) {
      this.persistentDB.linkStatusToContextChange(statusId, contextChangeId);
    }
  }
}

module.exports = StatusMessageTracker;
