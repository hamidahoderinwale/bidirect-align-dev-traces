#!/usr/bin/env node

/**
 * shrink-companion-db.js
 *
 * Utility script to VACUUM and shrink a large companion SQLite database.
 *
 * Usage:
 *   node scripts/shrink-companion-db.js path/to/companion.db
 *
 * Notes:
 *   - This will run VACUUM in-place on the specified file.
 *   - For very large databases (tens of GB), this can take many minutes.
 *   - Run while the companion service is STOPPED.
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

function formatSize(bytes) {
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(2)} MB`;
  if (bytes > 1e3) return `${(bytes / 1e3).toFixed(2)} KB`;
  return `${bytes} B`;
}

async function main() {
  const dbPath = process.argv[2];
  if (!dbPath) {
    console.error('Usage: node scripts/shrink-companion-db.js path/to/companion.db');
    process.exit(1);
  }

  const resolvedPath = path.resolve(dbPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: file does not exist: ${resolvedPath}`);
    process.exit(1);
  }

  const beforeStats = fs.statSync(resolvedPath);
  console.log(`[SHRINK] Target database: ${resolvedPath}`);
  console.log(`[SHRINK] Current size: ${formatSize(beforeStats.size)}`);
  console.log(
    '[SHRINK] IMPORTANT: make sure the companion service is stopped before running this.'
  );

  await new Promise((resolve, reject) => {
    const db = new sqlite3.Database(resolvedPath, (err) => {
      if (err) {
        reject(err);
        return;
      }

      console.log('[SHRINK] Connected to database. Running VACUUM... (this may take a while)');
      db.exec('VACUUM;', (vacErr) => {
        if (vacErr) {
          reject(vacErr);
        } else {
          console.log('[SHRINK] VACUUM completed successfully.');
          resolve();
        }
        db.close();
      });
    });
  }).catch((err) => {
    console.error('[SHRINK] Error during VACUUM:', err.message);
    process.exit(1);
  });

  const afterStats = fs.statSync(resolvedPath);
  console.log(`[SHRINK] New size: ${formatSize(afterStats.size)}`);
  console.log('[SHRINK] Done.');
}

main();
