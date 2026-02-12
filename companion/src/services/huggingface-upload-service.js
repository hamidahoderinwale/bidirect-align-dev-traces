/**
 * Hugging Face Upload Service
 * Modular service for managing HF authentication and dataset uploads
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

class HuggingFaceUploadService {
  constructor() {
    // In-memory token storage (should be moved to database for production)
    this.tokens = new Map(); // sessionId -> { token, username, expiresAt }
    this.hfApiBase = 'https://huggingface.co/api';
  }

  /**
   * Login with Hugging Face token
   * @param {string} token - HF API token
   * @param {string} sessionId - Optional session ID
   * @returns {Promise<Object>} User info and session
   */
  async login(token, sessionId = null) {
    try {
      // Validate token by fetching user info
      const response = await fetch(`${this.hfApiBase}/whoami`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Invalid token: ${response.status} ${response.statusText}`);
      }

      const userInfo = await response.json();

      // Generate session ID if not provided
      const finalSessionId =
        sessionId || `hf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Store token (in production, store in database)
      this.tokens.set(finalSessionId, {
        token,
        username: userInfo.name || userInfo.username,
        userId: userInfo.id,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      return {
        success: true,
        sessionId: finalSessionId,
        user: {
          username: userInfo.name || userInfo.username,
          id: userInfo.id,
          email: userInfo.email,
          avatar: userInfo.avatar_url,
        },
      };
    } catch (error) {
      console.error('[HF-UPLOAD] Login error:', error);
      throw error;
    }
  }

  /**
   * Get login status
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>} Status info
   */
  async getStatus(sessionId) {
    const session = this.tokens.get(sessionId);

    if (!session) {
      return {
        success: false,
        loggedIn: false,
        message: 'Not logged in',
      };
    }

    // Check if expired
    if (session.expiresAt < Date.now()) {
      this.tokens.delete(sessionId);
      return {
        success: false,
        loggedIn: false,
        message: 'Session expired',
      };
    }

    return {
      success: true,
      loggedIn: true,
      user: {
        username: session.username,
        userId: session.userId,
      },
    };
  }

  /**
   * Logout
   * @param {string} sessionId - Session ID
   */
  async logout(sessionId) {
    this.tokens.delete(sessionId);
    return { success: true };
  }

  /**
   * Get token for session
   * @param {string} sessionId - Session ID
   * @returns {string|null} Token or null
   */
  getToken(sessionId) {
    const session = this.tokens.get(sessionId);
    if (!session || session.expiresAt < Date.now()) {
      return null;
    }
    return session.token;
  }

  /**
   * Upload dataset to Hugging Face Hub
   * @param {string} sessionId - Session ID
   * @param {string} repoName - Repository name (username/dataset-name)
   * @param {string} directory - Directory containing dataset files
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} Upload result
   */
  async uploadDataset(sessionId, repoName, directory, options = {}) {
    const token = this.getToken(sessionId);
    if (!token) {
      throw new Error('Not authenticated. Please login first.');
    }

    const { private: isPrivate = false, commitMessage = 'Upload dataset from Cursor Telemetry' } =
      options;

    try {
      // Validate directory exists
      if (!fs.existsSync(directory)) {
        throw new Error(`Directory not found: ${directory}`);
      }

      // Check for required files
      const requiredFiles = ['train.jsonl', 'validation.jsonl', 'README.md'];
      const missing = requiredFiles.filter((f) => !fs.existsSync(path.join(directory, f)));

      if (missing.length > 0) {
        throw new Error(`Missing required files: ${missing.join(', ')}`);
      }

      // Create repository if it doesn't exist
      await this.createRepository(token, repoName, isPrivate);

      // Upload files
      const files = fs
        .readdirSync(directory)
        .filter((f) => fs.statSync(path.join(directory, f)).isFile());

      const uploadResults = [];
      for (const file of files) {
        const filePath = path.join(directory, file);
        const fileContent = fs.readFileSync(filePath);

        const uploadResult = await this.uploadFile(
          token,
          repoName,
          file,
          fileContent,
          commitMessage
        );

        uploadResults.push({
          file,
          success: uploadResult.success,
          url: uploadResult.url,
        });
      }

      return {
        success: true,
        repoName,
        repoUrl: `https://huggingface.co/datasets/${repoName}`,
        filesUploaded: uploadResults.length,
        files: uploadResults,
      };
    } catch (error) {
      console.error('[HF-UPLOAD] Upload error:', error);
      throw error;
    }
  }

  /**
   * Create repository on Hugging Face Hub
   * @param {string} token - HF API token
   * @param {string} repoName - Repository name
   * @param {boolean} isPrivate - Whether repository is private
   */
  async createRepository(token, repoName, isPrivate = false) {
    try {
      const response = await fetch(`${this.hfApiBase}/datasets/create`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: repoName.split('/')[1], // Extract dataset name
          organization: repoName.split('/')[0], // Extract username/org
          private: isPrivate,
          type: 'dataset',
        }),
      });

      if (response.status === 409) {
        // Repository already exists, that's fine
        console.log(`[HF-UPLOAD] Repository ${repoName} already exists`);
        return { success: true, exists: true };
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create repository: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      return { success: true, repo: result };
    } catch (error) {
      // If it's a 409, repository exists, continue
      if (error.message.includes('409') || error.message.includes('already exists')) {
        return { success: true, exists: true };
      }
      throw error;
    }
  }

  /**
   * Upload a single file to Hugging Face Hub
   * @param {string} token - HF API token
   * @param {string} repoName - Repository name
   * @param {string} fileName - File name
   * @param {Buffer} fileContent - File content
   * @param {string} commitMessage - Commit message
   */
  async uploadFile(token, repoName, fileName, fileContent, commitMessage = 'Upload file') {
    try {
      // Use HF API to upload file (using base64 encoding for binary files)
      const base64Content = fileContent.toString('base64');

      const response = await fetch(`${this.hfApiBase}/datasets/${repoName}/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: fileName,
          content: base64Content,
          encoding: 'base64',
          commit_message: commitMessage,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to upload ${fileName}: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      return {
        success: true,
        url: `https://huggingface.co/datasets/${repoName}/blob/main/${fileName}`,
      };
    } catch (error) {
      console.error(`[HF-UPLOAD] File upload error for ${fileName}:`, error);
      throw error;
    }
  }

  /**
   * List datasets for a user
   * @param {string} sessionId - Session ID
   * @returns {Promise<Array>} List of datasets
   */
  async listDatasets(sessionId) {
    const token = this.getToken(sessionId);
    if (!token) {
      throw new Error('Not authenticated. Please login first.');
    }

    try {
      const response = await fetch(`${this.hfApiBase}/datasets`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to list datasets: ${response.status}`);
      }

      const datasets = await response.json();
      return {
        success: true,
        datasets: datasets.map((ds) => ({
          id: ds.id,
          name: ds.name,
          author: ds.author,
          private: ds.private,
          downloads: ds.downloads,
          likes: ds.likes,
          url: `https://huggingface.co/datasets/${ds.id}`,
        })),
      };
    } catch (error) {
      console.error('[HF-UPLOAD] List datasets error:', error);
      throw error;
    }
  }

  /**
   * Delete a dataset
   * @param {string} sessionId - Session ID
   * @param {string} repoName - Repository name
   * @returns {Promise<Object>} Deletion result
   */
  async deleteDataset(sessionId, repoName) {
    const token = this.getToken(sessionId);
    if (!token) {
      throw new Error('Not authenticated. Please login first.');
    }

    try {
      const response = await fetch(`${this.hfApiBase}/datasets/${repoName}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to delete dataset: ${response.status} ${errorText}`);
      }

      return { success: true, message: `Dataset ${repoName} deleted` };
    } catch (error) {
      console.error('[HF-UPLOAD] Delete dataset error:', error);
      throw error;
    }
  }
}

module.exports = HuggingFaceUploadService;
