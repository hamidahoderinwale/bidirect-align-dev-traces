#!/usr/bin/env node

/**
 * Cursor Telemetry Health Check
 * Verifies that the companion service and dashboard are working correctly
 */

const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'companion.db');
const API_PORT = 43917;
const API_BASE = `http://localhost:${API_PORT}`;

console.log('🔍 Cursor Telemetry Health Check\n');
console.log('='.repeat(60));

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function success(msg) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function error(msg) {
  console.log(`${colors.red}✗${colors.reset} ${msg}`);
}

function warning(msg) {
  console.log(`${colors.yellow}⚠${colors.reset} ${msg}`);
}

function info(msg) {
  console.log(`${colors.blue}ℹ${colors.reset} ${msg}`);
}

function section(title) {
  console.log(`\n${colors.bright}${title}${colors.reset}`);
  console.log('-'.repeat(60));
}

// Check if database exists and has data
async function checkDatabase() {
  section('1. Database Check');

  return new Promise((resolve) => {
    if (!fs.existsSync(DB_PATH)) {
      error(`Database not found at ${DB_PATH}`);
      resolve(false);
      return;
    }

    success('Database file exists');
    const dbSize = fs.statSync(DB_PATH).size / (1024 * 1024);
    info(`  Size: ${dbSize.toFixed(2)} MB`);

    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        error(`Failed to open database: ${err.message}`);
        resolve(false);
        return;
      }

      success('Database opened successfully');

      // Check tables
      db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
        if (err) {
          error(`Failed to query tables: ${err.message}`);
          db.close();
          resolve(false);
          return;
        }

        success(`Found ${tables.length} tables`);

        // Count records in key tables
        const queries = [
          'SELECT COUNT(*) as count FROM entries',
          'SELECT COUNT(*) as count FROM prompts',
          'SELECT COUNT(*) as count FROM events',
          'SELECT COUNT(*) as count FROM terminal_commands',
        ];

        let completed = 0;
        queries.forEach((query, index) => {
          db.get(query, (err, row) => {
            completed++;
            const tableName = query.match(/FROM (\w+)/)[1];

            if (err) {
              warning(`  ${tableName}: Error - ${err.message}`);
            } else {
              const count = row.count;
              if (count > 0) {
                success(`  ${tableName}: ${count.toLocaleString()} records`);
              } else {
                warning(`  ${tableName}: No records (is the service running?)`);
              }
            }

            if (completed === queries.length) {
              db.close();
              resolve(true);
            }
          });
        });
      });
    });
  });
}

// Check if API is running
async function checkAPI() {
  section('2. API Service Check');

  return new Promise((resolve) => {
    const req = http.get(`${API_BASE}/api/health`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode === 200) {
          success(`Service running on port ${API_PORT}`);
          try {
            const health = JSON.parse(data);
            info(`  Status: ${health.status || 'OK'}`);
            info(`  Uptime: ${Math.floor((health.uptime || 0) / 60)} minutes`);
            resolve(true);
          } catch (e) {
            success('Service responding (could not parse health data)');
            resolve(true);
          }
        } else {
          warning(`Service returned status ${res.statusCode}`);
          resolve(false);
        }
      });
    });

    req.on('error', (err) => {
      error(`Service not running: ${err.message}`);
      info(`  Start with: npm start`);
      resolve(false);
    });

    req.setTimeout(2000, () => {
      req.destroy();
      error('Service connection timeout');
      resolve(false);
    });
  });
}

// Check API endpoints
async function checkEndpoints(apiRunning) {
  section('3. API Endpoints Check');

  if (!apiRunning) {
    warning('Skipping endpoint checks (API not running)');
    return false;
  }

  const endpoints = [
    '/api/entries?limit=1',
    '/api/prompts?limit=1',
    '/api/events?limit=1',
    '/api/analytics/productivity',
  ];

  let allPassed = true;

  for (const endpoint of endpoints) {
    await new Promise((resolve) => {
      const req = http.get(`${API_BASE}${endpoint}`, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const json = JSON.parse(data);
              const hasData = Array.isArray(json) ? json.length > 0 : Object.keys(json).length > 0;
              if (hasData) {
                success(`${endpoint}`);
              } else {
                warning(`${endpoint} (no data yet)`);
              }
            } catch (e) {
              warning(`${endpoint} (invalid JSON)`);
            }
          } else {
            error(`${endpoint} (status ${res.statusCode})`);
            allPassed = false;
          }
          resolve();
        });
      });

      req.on('error', () => {
        error(`${endpoint} (connection failed)`);
        allPassed = false;
        resolve();
      });

      req.setTimeout(2000, () => {
        req.destroy();
        error(`${endpoint} (timeout)`);
        allPassed = false;
        resolve();
      });
    });
  }

  return allPassed;
}

// Check dashboard files
async function checkDashboard() {
  section('4. Dashboard Check');

  const publicPath = path.join(__dirname, 'public');
  const dashboardFile = path.join(publicPath, 'dashboard.html');

  if (!fs.existsSync(publicPath)) {
    error('Public directory not found');
    return false;
  }

  success('Public directory exists');

  if (!fs.existsSync(dashboardFile)) {
    error('dashboard.html not found');
    return false;
  }

  success('dashboard.html exists');

  // Count view files
  const viewsPath = path.join(publicPath, 'views');
  if (fs.existsSync(viewsPath)) {
    const viewDirs = fs.readdirSync(viewsPath).filter((f) => {
      return fs.statSync(path.join(viewsPath, f)).isDirectory();
    });
    success(`Found ${viewDirs.length} dashboard views`);
  } else {
    warning('Views directory not found');
  }

  return true;
}

// Check data flow
async function checkDataFlow(apiRunning) {
  section('5. Data Flow Verification');

  if (!apiRunning) {
    warning('Skipping data flow checks (API not running)');
    return false;
  }

  return new Promise((resolve) => {
    // Check if we have recent data
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);

    db.get('SELECT MAX(timestamp) as latest FROM entries', (err, row) => {
      if (err || !row.latest) {
        warning('No entries found - is file watching active?');
        db.close();
        resolve(false);
        return;
      }

      const latestDate = new Date(row.latest);
      const now = new Date();
      const ageMinutes = (now - latestDate) / (1000 * 60);

      if (ageMinutes < 60) {
        success(`Latest file change: ${Math.floor(ageMinutes)} minutes ago`);
      } else if (ageMinutes < 1440) {
        info(`Latest file change: ${Math.floor(ageMinutes / 60)} hours ago`);
      } else {
        warning(`Latest file change: ${Math.floor(ageMinutes / 1440)} days ago`);
      }

      // Check prompts
      db.get('SELECT MAX(timestamp) as latest FROM prompts', (err, row) => {
        if (err || !row.latest) {
          warning('No prompts found - have you used Cursor AI?');
        } else {
          const latestPrompt = new Date(row.latest);
          const promptAge = (now - latestPrompt) / (1000 * 60);

          if (promptAge < 60) {
            success(`Latest AI prompt: ${Math.floor(promptAge)} minutes ago`);
          } else if (promptAge < 1440) {
            info(`Latest AI prompt: ${Math.floor(promptAge / 60)} hours ago`);
          } else {
            info(`Latest AI prompt: ${Math.floor(promptAge / 1440)} days ago`);
          }
        }

        db.close();
        resolve(true);
      });
    });
  });
}

// Summary
function printSummary(results) {
  section('Summary');

  const { database, api, endpoints, dashboard, dataFlow } = results;
  const total = Object.values(results).filter((v) => v === true).length;
  const totalChecks = Object.keys(results).length;

  console.log('');
  if (total === totalChecks) {
    console.log(`${colors.green}${colors.bright}All checks passed! ✨${colors.reset}`);
    console.log('');
    console.log('Your Cursor Telemetry system is working correctly.');
    console.log('');
    if (api) {
      console.log(
        `Dashboard: ${colors.blue}http://localhost:${API_PORT}/dashboard.html${colors.reset}`
      );
      console.log(`API: ${colors.blue}${API_BASE}/api${colors.reset}`);
    } else {
      console.log(`Start service: ${colors.yellow}npm start${colors.reset}`);
      console.log(
        `Then visit: ${colors.blue}http://localhost:${API_PORT}/dashboard.html${colors.reset}`
      );
    }
  } else {
    console.log(`${colors.yellow}${total}/${totalChecks} checks passed${colors.reset}`);
    console.log('');
    console.log('Issues found:');
    if (!database) error('  Database has issues');
    if (!api) error('  Service not running');
    if (!endpoints) warning('  Some API endpoints not responding');
    if (!dashboard) error('  Dashboard files missing');
    if (!dataFlow) warning('  Data collection may not be active');

    console.log('');
    console.log('Troubleshooting:');
    if (!api) {
      console.log(`  1. Start service: ${colors.yellow}npm start${colors.reset}`);
    }
    if (!dataFlow) {
      console.log('  2. Ensure workspace is configured in config.json');
      console.log('  3. Make some file changes to test capture');
    }
  }

  console.log('\n' + '='.repeat(60));
}

// Run all checks
async function main() {
  const results = {
    database: await checkDatabase(),
    api: await checkAPI(),
    endpoints: false,
    dashboard: await checkDashboard(),
    dataFlow: false,
  };

  results.endpoints = await checkEndpoints(results.api);
  results.dataFlow = await checkDataFlow(results.api);

  printSummary(results);
}

main().catch((err) => {
  console.error(`\n${colors.red}Fatal error:${colors.reset}`, err);
  process.exit(1);
});
