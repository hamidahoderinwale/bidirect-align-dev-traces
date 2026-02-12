#!/usr/bin/env node
/**
 * Cursor Telemetry CLI
 * Command-line interface for data export and management
 */

const { program } = require('commander');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Simple fetch replacement using http module
function fetch(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              statusText: res.statusMessage,
              text: () => Promise.resolve(data),
              json: () => Promise.resolve(JSON.parse(data)),
            });
          } catch (e) {
            resolve({
              ok: false,
              status: res.statusCode,
              text: () => Promise.resolve(data),
              json: () => Promise.reject(new Error('Invalid JSON')),
            });
          }
        });
      })
      .on('error', reject);
  });
}

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Get API base URL
const API_BASE = process.env.COMPANION_API || 'http://localhost:43917';

program
  .name('cursor-telemetry')
  .description('CLI tool for Cursor Telemetry data export and management')
  .version('1.0.0');

// Export Command
const exportCmd = program.command('export').description('Export telemetry data');

exportCmd
  .command('json')
  .description('Export data as JSON')
  .option('-l, --limit <number>', 'Number of items to export', '1000')
  .option('-o, --output <file>', 'Output file path', 'export.json')
  .option('-w, --workspace <path>', 'Filter by workspace path')
  .option('--since <date>', 'Export data since date (YYYY-MM-DD)')
  .option('--no-code', 'Exclude code diffs')
  .option('--no-prompts', 'Exclude prompts')
  .action(async (options) => {
    try {
      log(`Exporting JSON to ${options.output}...`, 'cyan');

      const url = new URL(`${API_BASE}/api/export/database`);
      url.searchParams.set('limit', options.limit);
      if (options.workspace) url.searchParams.set('workspace', options.workspace);
      if (options.since) url.searchParams.set('since', options.since);
      if (!options.code) url.searchParams.set('no_code_diffs', 'true');
      if (!options.prompts) url.searchParams.set('exclude_prompts', 'true');

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Export failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      fs.writeFileSync(options.output, JSON.stringify(data, null, 2));

      log(`Exported ${data.data?.entries?.length || 0} entries to ${options.output}`, 'green');
    } catch (err) {
      log(`Export failed: ${err.message}`, 'red');
      process.exit(1);
    }
  });

// Hugging Face Command
const hfCmd = program.command('hf').description('Hugging Face integration');

hfCmd
  .command('export')
  .description('Export data to HF format')
  .option('-r, --rung <level>', 'Privacy rung (clio|module_graph|functions|semantic_edits|tokens)', 'clio')
  .action(async (options) => {
    try {
      log(`Exporting data (rung: ${options.rung})...`, 'cyan');
      const response = await fetch(`${API_BASE}/api/hf/export?rung=${options.rung}`);
      const data = await response.json();
      log(`Export complete: ${data.outputDir}`, 'green');
    } catch (err) {
      log(`Failed: ${err.message}`, 'red');
    }
  });

hfCmd
  .command('upload <directory>')
  .description('Upload to HF Hub')
  .requiredOption('--repo <name>', 'Repo name (username/dataset)')
  .requiredOption('--token <string>', 'HF API token')
  .action(async (directory, options) => {
    try {
      log('Logging in...', 'cyan');
      const loginRes = await fetch(`${API_BASE}/api/hf/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: options.token })
      });
      const loginData = await loginRes.json();
      
      log('Uploading...', 'cyan');
      const uploadRes = await fetch(`${API_BASE}/api/hf/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          sessionId: loginData.sessionId, 
          repoName: options.repo, 
          directory: path.resolve(directory) 
        })
      });
      const uploadData = await uploadRes.json();
      log(`Success! Dataset live at: ${uploadData.repoUrl}`, 'green');
    } catch (err) {
      log(`Upload failed: ${err.message}`, 'red');
    }
  });

// Stats Command
program
  .command('stats')
  .description('Show database statistics')
  .action(async () => {
    try {
      const response = await fetch(`${API_BASE}/health`);
      if (!response.ok) throw new Error(`API returned ${response.status}`);

      const health = await response.json();

      log('\nDatabase Statistics\n', 'bright');
      log(`  Entries:          ${health.entries.toLocaleString()}`, 'green');
      log(`  Prompts:          ${health.prompts.toLocaleString()}`, 'green');
      log(`  Queue Length:     ${health.queue_length}`, 'yellow');
    } catch (err) {
      log(`Failed to get stats: ${err.message}`, 'red');
      process.exit(1);
    }
  });

// Health Command
program
  .command('health')
  .description('Check companion service health')
  .action(async () => {
    try {
      const response = await fetch(`${API_BASE}/health`);
      if (!response.ok) throw new Error(`API returned ${response.status}`);

      const health = await response.json();

      log('Companion service is running.', 'green');
      log(`Status: ${health.status}`, 'cyan');
      log(`Timestamp: ${health.timestamp}`, 'cyan');
    } catch (err) {
      log('Companion service is NOT running', 'red');
      process.exit(1);
    }
  });

// Start Command
program
  .command('start')
  .description('Start companion service')
  .action(() => {
    const { spawn } = require('child_process');
    log('Starting companion service...', 'cyan');
    spawn('node', ['src/index.js'], {
      cwd: __dirname,
      stdio: 'inherit',
    });
  });

program.parse();
