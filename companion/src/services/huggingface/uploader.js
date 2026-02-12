/**
 * Hugging Face Upload Service
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

class HuggingFaceUploader {
  constructor() {
    this.tokens = new Map();
    this.hfApiBase = 'https://huggingface.co/api';
  }

  async login(token, sessionId = null) {
    const response = await fetch(`${this.hfApiBase}/whoami`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) throw new Error(`Invalid token: ${response.status}`);
    const userInfo = await response.json();
    const finalSessionId = sessionId || `hf-${Date.now()}`;

    this.tokens.set(finalSessionId, {
      token,
      username: userInfo.name || userInfo.username,
      userId: userInfo.id,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    return { success: true, sessionId: finalSessionId, username: userInfo.username };
  }

  async uploadDataset(sessionId, repoName, directory, options = {}) {
    const session = this.tokens.get(sessionId);
    if (!session) throw new Error('Not authenticated.');

    const files = fs.readdirSync(directory).filter(f => fs.statSync(path.join(directory, f)).isFile());
    for (const file of files) {
      const content = fs.readFileSync(path.join(directory, file));
      await fetch(`${this.hfApiBase}/datasets/${repoName}/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          path: file,
          content: content.toString('base64'),
          encoding: 'base64',
          commit_message: options.commitMessage || 'Upload from Cursor Telemetry'
        }),
      });
    }

    return { success: true, repoUrl: `https://huggingface.co/datasets/${repoName}` };
  }
}

module.exports = HuggingFaceUploader;

