/**
 * Schema Migration System
 * Handles database schema versioning and migrations
 */

const path = require('path');
const fs = require('fs');
const SchemaHelpers = require('./schema-helpers.js');

class SchemaMigrations {
  constructor(persistentDB) {
    this.db = persistentDB;
    this.migrationsPath = path.join(__dirname, 'migrations');
    this.currentVersion = '1.3.0'; // Current schema version
    this.helpers = new SchemaHelpers(persistentDB);
  }

  /**
   * Get current schema version from database
   */
  async getCurrentVersion() {
    try {
      await this.db.init();
      return new Promise((resolve, reject) => {
        this.db.db.get(
          `SELECT version FROM schema_versions ORDER BY id DESC LIMIT 1`,
          (err, row) => {
            if (err) {
              // Table doesn't exist yet, return default version
              resolve('1.0.0');
            } else if (row) {
              resolve(row.version || '1.0.0');
            } else {
              resolve('1.0.0');
            }
          }
        );
      });
    } catch (err) {
      console.warn('[MIGRATIONS] Could not get schema version, assuming 1.0.0:', err.message);
      return '1.0.0';
    }
  }

  /**
   * Compare version strings (semver-like)
   */
  compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 < p2) return -1;
      if (p1 > p2) return 1;
    }
    return 0;
  }

  /**
   * Run migrations to bring database to target version
   */
  async migrate(targetVersion = null) {
    const currentVersion = await this.getCurrentVersion();
    const target = targetVersion || this.currentVersion;

    if (this.compareVersions(currentVersion, target) === 0) {
      console.log(`[MIGRATIONS] Schema already at version ${currentVersion}`);
      return { success: true, from: currentVersion, to: target, migrations: [] };
    }

    const migrations = this.getMigrationsBetween(currentVersion, target);

    if (migrations.length === 0) {
      console.log(`[MIGRATIONS] No migrations needed from ${currentVersion} to ${target}`);
      return { success: true, from: currentVersion, to: target, migrations: [] };
    }

    console.log(
      `[MIGRATIONS] Running ${migrations.length} migration(s) from ${currentVersion} to ${target}`
    );

    const results = [];
    for (const migration of migrations) {
      try {
        console.log(`[MIGRATIONS] Running migration: ${migration.name} (${migration.version})`);
        await this.runMigration(migration);
        results.push({ migration: migration.name, version: migration.version, success: true });
      } catch (err) {
        console.error(`[MIGRATIONS] Migration ${migration.name} failed:`, err);
        results.push({
          migration: migration.name,
          version: migration.version,
          success: false,
          error: err.message,
        });
        throw err; // Stop on first failure
      }
    }

    // Update schema version
    await this.updateSchemaVersion(target);

    return {
      success: true,
      from: currentVersion,
      to: target,
      migrations: results,
    };
  }

  /**
   * Get migrations between two versions
   */
  getMigrationsBetween(fromVersion, toVersion) {
    const migrations = this.getAllMigrations();
    const isUpgrade = this.compareVersions(fromVersion, toVersion) < 0;

    return migrations
      .filter((m) => {
        if (isUpgrade) {
          return (
            this.compareVersions(m.version, fromVersion) > 0 &&
            this.compareVersions(m.version, toVersion) <= 0
          );
        } else {
          // Downgrade (rollback) - not typically supported
          return (
            this.compareVersions(m.version, fromVersion) <= 0 &&
            this.compareVersions(m.version, toVersion) > 0
          );
        }
      })
      .sort((a, b) => {
        return isUpgrade
          ? this.compareVersions(a.version, b.version)
          : this.compareVersions(b.version, a.version);
      });
  }

  /**
   * Get all available migrations
   */
  getAllMigrations() {
    // Built-in migrations (can be extended with file-based migrations)
    return [
      {
        version: '1.1.0',
        name: 'add_conversations_table',
        up: async (db) => {
          await db.init();
          return new Promise((resolve, reject) => {
            db.db.run(
              `
              CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                workspace_path TEXT,
                title TEXT,
                status TEXT DEFAULT 'active',
                tags TEXT,
                metadata TEXT,
                created_at TEXT,
                updated_at TEXT,
                last_message_at TEXT,
                message_count INTEGER DEFAULT 0
              )
            `,
              (err) => {
                if (err) reject(err);
                else {
                  db.db.run(
                    `CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace_id)`,
                    () => {}
                  );
                  db.db.run(
                    `CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status)`,
                    () => {}
                  );
                  resolve();
                }
              }
            );
          });
        },
        down: async (db) => {
          await db.init();
          return new Promise((resolve, reject) => {
            db.db.run(`DROP TABLE IF EXISTS conversations`, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        },
      },
      {
        version: '1.2.0',
        name: 'add_conversation_fields_to_prompts',
        up: async (db) => {
          await db.init();
          const helpers = new SchemaHelpers(db);

          // Safely add columns
          await helpers.safeAddColumns(
            'prompts',
            [
              { name: 'conversation_id', type: 'TEXT' },
              { name: 'conversation_index', type: 'INTEGER' },
              { name: 'conversation_title', type: 'TEXT' },
              { name: 'message_role', type: 'TEXT' },
              { name: 'parent_conversation_id', type: 'TEXT' },
            ],
            true
          );

          // Safely create indexes
          await helpers.safeCreateIndex('idx_prompts_conversation', 'prompts', 'conversation_id');
          await helpers.safeCreateIndex('idx_prompts_workspace_conversation', 'prompts', [
            'workspace_id',
            'conversation_id',
          ]);
          await helpers.safeCreateIndex('idx_prompts_message_role', 'prompts', 'message_role');
          await helpers
            .safeCreateIndex('idx_prompts_parent_conversation', 'prompts', 'parent_conversation_id')
            .catch((err) => {
              console.warn(
                '[MIGRATION] Could not create parent_conversation index (column may not exist yet):',
                err.message
              );
            });
        },
        down: async (db) => {
          // Note: SQLite doesn't support DROP COLUMN easily, so this is a no-op
          // Would need to recreate table without these columns
          console.warn(
            '[MIGRATION] Rollback for add_conversation_fields_to_prompts not fully supported'
          );
        },
      },
      {
        version: '1.3.0',
        name: 'add_audit_log_table',
        up: async (db) => {
          await db.init();
          return new Promise((resolve, reject) => {
            db.db.run(
              `
              CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                operation TEXT NOT NULL,
                operation_type TEXT NOT NULL,
                target_type TEXT,
                target_id TEXT,
                workspace_id TEXT,
                user_id TEXT,
                details TEXT,
                status TEXT,
                error_message TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
              )
            `,
              (err) => {
                if (err) reject(err);
                else {
                  db.db.run(
                    `CREATE INDEX IF NOT EXISTS idx_audit_operation ON audit_log(operation_type)`,
                    () => {}
                  );
                  db.db.run(
                    `CREATE INDEX IF NOT EXISTS idx_audit_workspace ON audit_log(workspace_id)`,
                    () => {}
                  );
                  db.db.run(
                    `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)`,
                    () => {}
                  );
                  resolve();
                }
              }
            );
          });
        },
        down: async (db) => {
          await db.init();
          return new Promise((resolve, reject) => {
            db.db.run(`DROP TABLE IF EXISTS audit_log`, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        },
      },
    ];
  }

  /**
   * Run a single migration
   */
  async runMigration(migration) {
    await this.db.init();
    await migration.up(this.db);
  }

  /**
   * Update schema version in database
   */
  async updateSchemaVersion(version) {
    await this.db.init();

    return new Promise((resolve, reject) => {
      // Check if schema_versions table exists
      this.db.db.get(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='schema_versions'`,
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }

          if (!row) {
            // Create schema_versions table
            this.db.db.run(
              `
              CREATE TABLE schema_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                version TEXT NOT NULL,
                applied_at TEXT DEFAULT CURRENT_TIMESTAMP
              )
            `,
              (createErr) => {
                if (createErr) {
                  reject(createErr);
                  return;
                }

                // Insert version
                this.db.db.run(
                  `INSERT INTO schema_versions (version) VALUES (?)`,
                  [version],
                  (insertErr) => {
                    if (insertErr) reject(insertErr);
                    else resolve();
                  }
                );
              }
            );
          } else {
            // Update version
            this.db.db.run(
              `INSERT OR REPLACE INTO schema_versions (id, version) VALUES (1, ?)`,
              [version],
              (updateErr) => {
                if (updateErr) reject(updateErr);
                else resolve();
              }
            );
          }
        }
      );
    });
  }

  /**
   * Normalize data from one schema version to another
   */
  async normalizeData(data, fromVersion, toVersion) {
    // Apply transformations based on version differences
    const migrations = this.getMigrationsBetween(fromVersion, toVersion);

    for (const migration of migrations) {
      if (migration.normalize) {
        data = await migration.normalize(data);
      }
    }

    return data;
  }
}

module.exports = SchemaMigrations;
