#!/usr/bin/env node
/**
 * Cursor Telemetry CLI
 * Command-line interface for data export, Hugging Face integration, and more
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
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            statusText: res.statusMessage,
            text: () => Promise.resolve(data),
            json: () => Promise.resolve(JSON.parse(data)),
          });
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

function success(message) {
  log(`✅ ${message}`, 'green');
}

function error(message) {
  log(`❌ ${message}`, 'red');
}

function info(message) {
  log(`ℹ️  ${message}`, 'cyan');
}

function warn(message) {
  log(`⚠️  ${message}`, 'yellow');
}

// Get API base URL
const API_BASE = process.env.COMPANION_API || 'http://localhost:43917';

program
  .name('cursor-telemetry')
  .description('CLI tool for Cursor Telemetry data export and management')
  .version('1.0.0');

// ============================================
// EXPORT COMMANDS
// ============================================

const exportCmd = program.command('export').description('Export telemetry data in various formats');

exportCmd
  .command('json')
  .description('Export data as JSON')
  .option('-l, --limit <number>', 'Number of items to export', '1000')
  .option('-o, --output <file>', 'Output file path', 'export.json')
  .option('-w, --workspace <path>', 'Filter by workspace path')
  .option('--since <date>', 'Export data since date (YYYY-MM-DD)')
  .option('--until <date>', 'Export data until date (YYYY-MM-DD)')
  .option('--no-code', 'Exclude code diffs')
  .option('--no-prompts', 'Exclude prompts')
  .option('--full', 'Include all fields')
  .action(async (options) => {
    try {
      info(`Exporting JSON to ${options.output}...`);

      const url = new URL(`${API_BASE}/api/export/database`);
      url.searchParams.set('limit', options.limit);
      if (options.full) url.searchParams.set('full', 'true');
      if (options.workspace) url.searchParams.set('workspace', options.workspace);
      if (options.since) url.searchParams.set('since', options.since);
      if (options.until) url.searchParams.set('until', options.until);
      if (!options.code) url.searchParams.set('no_code_diffs', 'true');
      if (!options.prompts) url.searchParams.set('exclude_prompts', 'true');

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Export failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      fs.writeFileSync(options.output, JSON.stringify(data, null, 2));

      success(`Exported ${data.data?.entries?.length || 0} entries to ${options.output}`);
      info(`File size: ${(fs.statSync(options.output).size / 1024 / 1024).toFixed(2)} MB`);
    } catch (err) {
      error(`Export failed: ${err.message}`);
      process.exit(1);
    }
  });

exportCmd
  .command('csv')
  .description('Export data as CSV')
  .option('-o, --output <file>', 'Output file path', 'export.csv')
  .option('-l, --limit <number>', 'Number of items to export', '1000')
  .action(async (options) => {
    try {
      info(`Exporting CSV to ${options.output}...`);

      const response = await fetch(`${API_BASE}/api/export/csv?limit=${options.limit}`);
      if (!response.ok) {
        throw new Error(`Export failed: ${response.status}`);
      }

      const csv = await response.text();
      fs.writeFileSync(options.output, csv);

      success(`Exported to ${options.output}`);
      const lines = csv.split('\n').length - 1;
      info(`${lines} rows exported`);
    } catch (err) {
      error(`Export failed: ${err.message}`);
      process.exit(1);
    }
  });

// ============================================
// HUGGING FACE COMMANDS
// ============================================

const hfCmd = program
  .command('huggingface')
  .alias('hf')
  .description('Hugging Face dataset export and upload');

hfCmd
  .command('export')
  .description('Export data in Hugging Face dataset format')
  .option(
    '-p, --privacy <level>',
    'Privacy level (raw|tokens|semantic_edits|functions|module_graph|clio)',
    'clio'
  )
  .option('-o, --output <dir>', 'Output directory', `./hf-export-${Date.now()}`)
  .option('-m, --max <number>', 'Maximum samples', '10000')
  .option('--no-anonymize', 'Disable anonymization')
  .option('--no-prompts', 'Exclude prompts')
  .option('--no-code', 'Exclude code diffs')
  .action(async (options) => {
    try {
      info(`Exporting to Hugging Face format (privacy: ${options.privacy})...`);

      const url = new URL(`${API_BASE}/api/huggingface/export`);
      url.searchParams.set('privacy_level', options.privacy);
      url.searchParams.set('max_samples', options.max);
      url.searchParams.set('output_dir', path.resolve(options.output));
      url.searchParams.set('anonymize', options.anonymize ? 'true' : 'false');
      url.searchParams.set('include_prompts', options.prompts ? 'true' : 'false');
      url.searchParams.set('include_code', options.code ? 'true' : 'false');

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Export failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success) {
        success(`Export completed!`);
        info(`Output directory: ${result.result.outputDir}`);
        info(`Total samples: ${result.result.totalSamples}`);
        info(`Privacy level: ${result.result.privacyLevel}`);
        info(`Anonymized: ${result.result.anonymized}`);

        console.log('\n' + colors.bright + '📦 Files created:' + colors.reset);
        result.result.files.forEach((file) => {
          console.log(`   - ${path.basename(file)}`);
        });

        console.log('\n' + colors.bright + '🚀 Next steps:' + colors.reset);
        console.log(
          '   1. Install HF CLI: ' + colors.cyan + 'pip install huggingface_hub' + colors.reset
        );
        console.log('   2. Login: ' + colors.cyan + 'huggingface-cli login' + colors.reset);
        console.log(
          '   3. Upload: ' +
            colors.cyan +
            `cursor-telemetry hf upload ${options.output}` +
            colors.reset
        );
      } else {
        error(`Export failed: ${result.error}`);
        process.exit(1);
      }
    } catch (err) {
      error(`Export failed: ${err.message}`);
      if (err.message.includes('ECONNREFUSED')) {
        warn('Companion service not running. Start it with: node src/index.js');
      }
      process.exit(1);
    }
  });

hfCmd
  .command('upload <directory>')
  .description('Upload exported dataset to Hugging Face Hub')
  .option('-r, --repo <name>', 'Repository name (username/dataset-name)')
  .option('--private', 'Make dataset private')
  .action(async (directory, options) => {
    const { execSync } = require('child_process');

    try {
      // Check if directory exists
      if (!fs.existsSync(directory)) {
        throw new Error(`Directory not found: ${directory}`);
      }

      // Check for required files
      const requiredFiles = ['train.jsonl', 'validation.jsonl', 'README.md'];
      const missing = requiredFiles.filter((f) => !fs.existsSync(path.join(directory, f)));

      if (missing.length > 0) {
        throw new Error(`Missing required files: ${missing.join(', ')}`);
      }

      if (!options.repo) {
        error('Repository name required. Use: --repo username/dataset-name');
        process.exit(1);
      }

      info('Checking Hugging Face CLI...');

      try {
        execSync('huggingface-cli --version', { stdio: 'ignore' });
      } catch (err) {
        error('Hugging Face CLI not found. Install with: pip install huggingface_hub');
        process.exit(1);
      }

      info(`Creating repository: ${options.repo}...`);

      // Create repo
      try {
        const visibility = options.private ? '--private' : '';
        execSync(`huggingface-cli repo create ${options.repo} --type dataset ${visibility}`, {
          stdio: 'inherit',
        });
        success('Repository created!');
      } catch (err) {
        warn('Repository might already exist, continuing...');
      }

      info('Uploading files...');

      // Upload files
      const uploadCmd = `cd ${directory} && huggingface-cli upload ${options.repo} . .`;
      execSync(uploadCmd, { stdio: 'inherit' });

      success(`Dataset uploaded successfully!`);
      console.log('\n' + colors.bright + '🎉 Your dataset is live!' + colors.reset);
      console.log(`   https://huggingface.co/datasets/${options.repo}`);

      console.log('\n' + colors.bright + '📖 Usage:' + colors.reset);
      console.log(colors.cyan + `   from datasets import load_dataset` + colors.reset);
      console.log(colors.cyan + `   dataset = load_dataset("${options.repo}")` + colors.reset);
    } catch (err) {
      error(`Upload failed: ${err.message}`);
      process.exit(1);
    }
  });

hfCmd
  .command('quick-upload')
  .description('Export and upload to HuggingFace in one command')
  .requiredOption('-r, --repo <name>', 'Repository name (username/dataset-name)')
  .option('-p, --privacy <level>', 'Privacy level', 'clio')
  .option('-m, --max <number>', 'Maximum samples', '10000')
  .option('--private', 'Make dataset private')
  .option('--no-anonymize', 'Disable anonymization')
  .action(async (options) => {
    try {
      const outputDir = `./hf-export-${Date.now()}`;

      // Step 1: Export
      log('\n📦 Step 1: Exporting data...', 'bright');
      const url = new URL(`${API_BASE}/api/huggingface/export`);
      url.searchParams.set('privacy_level', options.privacy);
      url.searchParams.set('max_samples', options.max);
      url.searchParams.set('output_dir', path.resolve(outputDir));
      url.searchParams.set('anonymize', options.anonymize ? 'true' : 'false');

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Export failed: ${response.status}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error);
      }

      success(`Exported ${result.result.totalSamples} samples`);

      // Step 2: Upload
      log('\n🚀 Step 2: Uploading to Hugging Face...', 'bright');
      const { execSync } = require('child_process');

      // Check HF CLI
      try {
        execSync('huggingface-cli --version', { stdio: 'ignore' });
      } catch (err) {
        error('Hugging Face CLI not found. Install with: pip install huggingface_hub');
        info(`Your data is exported to: ${result.result.outputDir}`);
        info('Upload manually later with: cursor-telemetry hf upload <directory> --repo <name>');
        process.exit(0);
      }

      // Create repo
      try {
        const visibility = options.private ? '--private' : '';
        execSync(`huggingface-cli repo create ${options.repo} --type dataset ${visibility}`, {
          stdio: 'pipe',
        });
        success('Repository created!');
      } catch (err) {
        warn('Repository might already exist, continuing...');
      }

      // Upload
      const uploadCmd = `cd ${result.result.outputDir} && huggingface-cli upload ${options.repo} . .`;
      execSync(uploadCmd, { stdio: 'inherit' });

      success('Upload complete!');
      console.log('\n' + colors.bright + '🎉 Your dataset is live!' + colors.reset);
      console.log(`   https://huggingface.co/datasets/${options.repo}`);

      // Cleanup option
      console.log('\n' + colors.yellow + 'Cleanup local files?' + colors.reset);
      console.log(`   rm -rf ${result.result.outputDir}`);
    } catch (err) {
      error(`Failed: ${err.message}`);
      if (err.message.includes('ECONNREFUSED')) {
        warn('Companion service not running. Start it with: npm start');
      }
      process.exit(1);
    }
  });

hfCmd
  .command('info')
  .description('Show Hugging Face export information')
  .action(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/huggingface/info`);
      if (!response.ok) throw new Error(`API returned ${response.status}`);

      const info = await response.json();

      console.log('\n' + colors.bright + '🤗 Hugging Face Export Service' + colors.reset + '\n');

      console.log(colors.bright + 'Privacy Levels:' + colors.reset);
      Object.entries(info.privacyLevels).forEach(([level, desc]) => {
        console.log(`  ${colors.cyan}${level.padEnd(15)}${colors.reset} ${desc}`);
      });

      console.log('\n' + colors.bright + 'Options:' + colors.reset);
      Object.entries(info.options).forEach(([opt, desc]) => {
        console.log(`  ${colors.cyan}--${opt.padEnd(15)}${colors.reset} ${desc}`);
      });

      console.log('\n' + colors.bright + 'Examples:' + colors.reset);
      info.examples.forEach((ex) => {
        console.log(`  ${colors.green}${ex}${colors.reset}`);
      });
    } catch (err) {
      error(`Failed to get info: ${err.message}`);
      process.exit(1);
    }
  });

// ============================================
// DATA COMMANDS
// ============================================

program
  .command('stats')
  .description('Show database statistics')
  .action(async () => {
    try {
      const response = await fetch(`${API_BASE}/health`);
      if (!response.ok) throw new Error(`API returned ${response.status}`);

      const health = await response.json();

      console.log('\n' + colors.bright + '📊 Database Statistics' + colors.reset + '\n');
      console.log(
        `  Entries:          ${colors.green}${health.entries.toLocaleString()}${colors.reset}`
      );
      console.log(
        `  Prompts:          ${colors.green}${health.prompts.toLocaleString()}${colors.reset}`
      );
      console.log(`  Queue Length:     ${colors.yellow}${health.queue_length}${colors.reset}`);

      if (health.raw_data_stats) {
        console.log('\n' + colors.bright + '📈 Raw Data:' + colors.reset);
        console.log(`  System Resources: ${health.raw_data_stats.systemResources}`);
        console.log(`  Git Data:         ${health.raw_data_stats.gitData}`);
        console.log(`  Cursor DB:        ${health.raw_data_stats.cursorDatabase}`);
      }

      if (health.cache_stats) {
        console.log('\n' + colors.bright + '💾 Cache:' + colors.reset);
        console.log(`  Cached Keys:      ${health.cache_stats.keys}`);
        console.log(`  Hit Rate:         ${(health.cache_stats.hitRate * 100).toFixed(1)}%`);
      }
    } catch (err) {
      error(`Failed to get stats: ${err.message}`);
      if (err.message.includes('ECONNREFUSED')) {
        warn('Companion service not running. Start it with: npm start');
      }
      process.exit(1);
    }
  });

program
  .command('health')
  .description('Check companion service health')
  .action(async () => {
    try {
      const response = await fetch(`${API_BASE}/health`);
      if (!response.ok) throw new Error(`API returned ${response.status}`);

      const health = await response.json();

      success('Companion service is running!');
      info(`Status: ${health.status}`);
      info(`Timestamp: ${health.timestamp}`);
      info(`Entries: ${health.entries}, Prompts: ${health.prompts}`);
    } catch (err) {
      error('Companion service is NOT running');
      warn(`Could not connect to ${API_BASE}`);
      info('Start with: cd components/activity-logger/companion && npm start');
      process.exit(1);
    }
  });

// ============================================
// PRIVACY RUNGS COMMANDS
// ============================================

const rungsCmd = program.command('rungs').description('Export data at different privacy levels');

rungsCmd
  .command('export')
  .description('Export data at specified privacy rung')
  .argument('<level>', 'Privacy level (clio|module_graph|functions|semantic_edits|tokens)')
  .option('-o, --output <file>', 'Output file')
  .option('-l, --limit <number>', 'Number of items', '5000')
  .action(async (level, options) => {
    const validLevels = ['clio', 'module_graph', 'functions', 'semantic_edits', 'tokens'];
    if (!validLevels.includes(level)) {
      error(`Invalid level. Must be one of: ${validLevels.join(', ')}`);
      process.exit(1);
    }

    try {
      const outputFile = options.output || `export-${level}-${Date.now()}.json`;
      info(`Exporting ${level} data to ${outputFile}...`);

      const url = `${API_BASE}/api/export/data?rung=${level}&limit=${options.limit}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Export failed: ${response.status}`);
      }

      const data = await response.json();
      fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));

      success(`Exported ${level} data to ${outputFile}`);
      info(`Privacy level: ${level.toUpperCase()}`);

      // Show privacy info
      const privacyInfo = {
        clio: 'Workflow patterns only (highest privacy)',
        module_graph: 'File dependencies',
        functions: 'Function-level changes',
        semantic_edits: 'Semantic edit operations',
        tokens: 'Tokens with PII redaction',
      };
      info(`Description: ${privacyInfo[level]}`);
    } catch (err) {
      error(`Export failed: ${err.message}`);
      process.exit(1);
    }
  });

rungsCmd
  .command('list')
  .description('List available privacy rungs')
  .action(() => {
    console.log('\n' + colors.bright + '🔐 Privacy Abstraction Levels' + colors.reset + '\n');

    const levels = [
      { name: 'clio', privacy: '⭐⭐⭐⭐⭐', desc: 'Workflow patterns only (safest to share)' },
      { name: 'module_graph', privacy: '⭐⭐⭐⭐', desc: 'File dependencies' },
      { name: 'functions', privacy: '⭐⭐⭐', desc: 'Function-level changes' },
      { name: 'semantic_edits', privacy: '⭐⭐', desc: 'Semantic edit operations' },
      { name: 'tokens', privacy: '⭐', desc: 'Tokens with PII redaction' },
    ];

    levels.forEach((level) => {
      console.log(
        `  ${colors.cyan}${level.name.padEnd(15)}${colors.reset} ${level.privacy} ${level.desc}`
      );
    });

    console.log('\n' + colors.bright + 'Export at any level:' + colors.reset);
    console.log(`  ${colors.green}cursor-telemetry rungs export clio${colors.reset}`);
  });

// ============================================
// UTILITY COMMANDS
// ============================================

program
  .command('config')
  .description('Show current configuration')
  .action(() => {
    const configPath = path.join(__dirname, 'config.json');

    if (!fs.existsSync(configPath)) {
      error('config.json not found');
      process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    console.log('\n' + colors.bright + '⚙️  Configuration' + colors.reset + '\n');
    console.log(`  API Base:         ${colors.cyan}${API_BASE}${colors.reset}`);
    console.log(`  Root Dir:         ${config.root_dir || 'Not set'}`);
    console.log(`  Workspace Roots:  ${config.workspace_roots?.length || 0}`);
    console.log(`  Auto Detect:      ${config.auto_detect_workspaces ? '✅' : '❌'}`);
    console.log(`  Port:             ${config.port || 43917}`);
    console.log(`  Diff Threshold:   ${config.diff_threshold || 10} chars`);

    if (config.workspace_roots && config.workspace_roots.length > 0) {
      console.log('\n' + colors.bright + '📁 Monitored Workspaces:' + colors.reset);
      config.workspace_roots.forEach((ws) => {
        console.log(`  - ${ws}`);
      });
    }
  });

program
  .command('open')
  .description('Open dashboard in browser')
  .option('-p, --port <number>', 'Dashboard port', '8080')
  .action((options) => {
    const { execSync } = require('child_process');
    const url = `http://localhost:${options.port}/dashboard.html`;

    info(`Opening ${url}...`);

    try {
      if (process.platform === 'darwin') {
        execSync(`open ${url}`);
      } else if (process.platform === 'win32') {
        execSync(`start ${url}`);
      } else {
        execSync(`xdg-open ${url}`);
      }
      success('Dashboard opened!');
    } catch (err) {
      error('Could not open browser automatically');
      info(`Please open manually: ${url}`);
    }
  });

// ============================================
// QUICK START COMMANDS
// ============================================

program
  .command('start')
  .description('Start companion service')
  .action(() => {
    const { spawn } = require('child_process');

    info('Starting companion service...');

    const proc = spawn('node', ['src/index.js'], {
      cwd: __dirname,
      stdio: 'inherit',
    });

    proc.on('error', (err) => {
      error(`Failed to start: ${err.message}`);
    });
  });

program
  .command('quickstart')
  .description('Build, run, and open dashboard')
  .action(() => {
    const { execSync } = require('child_script');
    const scriptPath = path.join(__dirname, '../rebuild-run-open.sh');

    try {
      info('Running quickstart script...');
      execSync(`bash ${scriptPath}`, { stdio: 'inherit' });
    } catch (err) {
      error('Quickstart failed');
      info('Try running manually: ./rebuild-run-open.sh');
    }
  });

// ============================================
// EXAMPLES
// ============================================

program
  .command('examples')
  .description('Show usage examples')
  .action(() => {
    console.log('\n' + colors.bright + '📚 Cursor Telemetry CLI - Examples' + colors.reset + '\n');

    const examples = [
      {
        title: 'Check service health',
        cmd: 'cursor-telemetry health',
      },
      {
        title: 'View database stats',
        cmd: 'cursor-telemetry stats',
      },
      {
        title: 'Export as JSON (1000 items)',
        cmd: 'cursor-telemetry export json --limit 1000 -o mydata.json',
      },
      {
        title: 'Export as CSV',
        cmd: 'cursor-telemetry export csv -o data.csv',
      },
      {
        title: 'Export to Hugging Face (high privacy)',
        cmd: 'cursor-telemetry hf export --privacy clio --max 10000',
      },
      {
        title: 'Quick export & upload to HF',
        cmd: 'cursor-telemetry hf quick-upload --repo username/my-dataset --privacy clio',
      },
      {
        title: 'Export specific privacy rung',
        cmd: 'cursor-telemetry rungs export functions -o functions.json',
      },
      {
        title: 'List privacy levels',
        cmd: 'cursor-telemetry rungs list',
      },
      {
        title: 'Open dashboard',
        cmd: 'cursor-telemetry open',
      },
    ];

    examples.forEach(({ title, cmd }) => {
      console.log(colors.bright + title + colors.reset);
      console.log(`  ${colors.green}${cmd}${colors.reset}\n`);
    });
  });

// Parse arguments
program.parse();
