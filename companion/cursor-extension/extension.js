const vscode = require('vscode');
const https = require('http');

let isMonitoring = true;
let currentConversationId = null;
let currentConversationTitle = null;

/**
 * Capture a prompt and send to telemetry API
 */
async function capturePrompt(text, options = {}) {
  const config = vscode.workspace.getConfiguration('cursorTelemetry');
  const apiEndpoint = config.get('apiEndpoint', 'http://localhost:43917');

  if (!isMonitoring) {
    console.log('[Telemetry] Monitoring disabled, skipping capture');
    return;
  }

  const promptData = {
    text: text,
    conversationTitle: options.conversationTitle || currentConversationTitle,
    conversationId: options.conversationId || currentConversationId,
    messageRole: options.messageRole || 'user',
    hasAttachments: options.hasAttachments || false,
    attachments: options.attachments || [],
    timestamp: Date.now(),
  };

  try {
    const url = new URL('/api/prompts/manual', apiEndpoint);
    const data = JSON.stringify(promptData);

    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
      },
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log('[Telemetry] Prompt captured successfully');
            resolve(JSON.parse(responseData));
          } else {
            reject(new Error(`API returned ${res.statusCode}: ${responseData}`));
          }
        });
      });

      req.on('error', (error) => {
        console.error('[Telemetry] Error capturing prompt:', error);
        reject(error);
      });

      req.write(data);
      req.end();
    });
  } catch (error) {
    console.error('[Telemetry] Failed to capture prompt:', error);
    vscode.window.showErrorMessage(`Cursor Telemetry: ${error.message}`);
  }
}

/**
 * Monitor clipboard for prompt captures
 */
let clipboardMonitor = null;

function startClipboardMonitoring() {
  if (clipboardMonitor) return;

  let lastClipboard = '';

  clipboardMonitor = setInterval(async () => {
    try {
      const clipboard = await vscode.env.clipboard.readText();

      // Check if this looks like a prompt (basic heuristic)
      if (
        clipboard &&
        clipboard !== lastClipboard &&
        clipboard.length > 10 &&
        clipboard.length < 10000 &&
        !clipboard.startsWith('http://') &&
        !clipboard.startsWith('https://')
      ) {
        // Likely a prompt, capture it
        await capturePrompt(clipboard, {
          conversationTitle: 'From clipboard',
          messageRole: 'user',
        });

        lastClipboard = clipboard;
      }
    } catch (error) {
      // Silent fail for clipboard monitoring
    }
  }, 5000); // Check every 5 seconds
}

function stopClipboardMonitoring() {
  if (clipboardMonitor) {
    clearInterval(clipboardMonitor);
    clipboardMonitor = null;
  }
}

/**
 * Extension activation
 */
function activate(context) {
  console.log('[Telemetry] Cursor Telemetry Extension activated');

  // Command: Manually capture current selection or prompt
  let captureCommand = vscode.commands.registerCommand(
    'cursorTelemetry.capturePrompt',
    async () => {
      const editor = vscode.window.activeTextEditor;

      if (editor) {
        const selection = editor.selection;
        const text = editor.document.getText(selection) || editor.document.getText();

        if (text) {
          const title = await vscode.window.showInputBox({
            prompt: 'Enter conversation title (optional)',
            placeHolder: 'Conversation title',
          });

          await capturePrompt(text, {
            conversationTitle: title || 'Manual capture',
            messageRole: 'user',
          });

          vscode.window.showInformationMessage('Prompt captured successfully!');
        } else {
          vscode.window.showWarningMessage('No text to capture');
        }
      }
    }
  );

  // Command: Toggle monitoring
  let toggleCommand = vscode.commands.registerCommand('cursorTelemetry.toggleMonitoring', () => {
    isMonitoring = !isMonitoring;
    const status = isMonitoring ? 'enabled' : 'disabled';
    vscode.window.showInformationMessage(`Cursor Telemetry monitoring ${status}`);

    if (isMonitoring) {
      startClipboardMonitoring();
    } else {
      stopClipboardMonitoring();
    }
  });

  context.subscriptions.push(captureCommand);
  context.subscriptions.push(toggleCommand);

  // Start clipboard monitoring if auto-capture is enabled
  const config = vscode.workspace.getConfiguration('cursorTelemetry');
  if (config.get('autoCapture', true)) {
    startClipboardMonitoring();
    console.log('[Telemetry] Clipboard monitoring started');
  }

  // Show activation message
  vscode.window.showInformationMessage('Cursor Telemetry Extension is now active!');
}

/**
 * Extension deactivation
 */
function deactivate() {
  stopClipboardMonitoring();
  console.log('[Telemetry] Cursor Telemetry Extension deactivated');
}

module.exports = {
  activate,
  deactivate,
};
