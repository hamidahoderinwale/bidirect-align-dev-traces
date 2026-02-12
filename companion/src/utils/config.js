const { readFileSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');

const CONFIG_FILE = join(__dirname, '..', 'config.json');

const DEFAULT_CONFIG = {
  root_dir: process.cwd(),
  ignore: ['node_modules/**', 'dist/**', 'build/**', '.git/**', '*.log', '*.tmp', '.DS_Store'],
  diff_threshold: 12,
  enable_clipboard: false,
  enable_preload: false,
  strict_auth: true,
  companion_token: null,
  enable_mcp: false, // MCP endpoints disabled by default (optional/future feature)
};

let currentConfig = { ...DEFAULT_CONFIG };

// Load config from file if it exists
if (existsSync(CONFIG_FILE)) {
  try {
    const fileConfig = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    currentConfig = { ...DEFAULT_CONFIG, ...fileConfig };
  } catch (error) {
    console.warn('�Failed to load config file, using defaults:', error.message);
  }
}

const config = {
  get() {
    return { ...currentConfig };
  },

  update(newConfig) {
    currentConfig = { ...currentConfig, ...newConfig };

    // Save to file
    try {
      writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2));
    } catch (error) {
      console.error('Failed to save config:', error.message);
    }

    return currentConfig;
  },

  reset() {
    currentConfig = { ...DEFAULT_CONFIG };
    try {
      writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2));
    } catch (error) {
      console.error('Failed to reset config:', error.message);
    }
    return currentConfig;
  },
};

module.exports = { config };
