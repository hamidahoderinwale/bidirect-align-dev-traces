/**
 * Schema Helper Utilities
 * Safe database schema modification functions with existence checking
 */

class SchemaHelpers {
  constructor(db) {
    this.db = db;
  }

  /**
   * Check if a column exists in a table
   * @param {string} tableName - Name of the table
   * @param {string} columnName - Name of the column
   * @returns {Promise<boolean>} - True if column exists
   */
  async columnExists(tableName, columnName) {
    await this.db.init();

    return new Promise((resolve, reject) => {
      this.db.db.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
        if (err) {
          // Table doesn't exist
          resolve(false);
          return;
        }

        const exists = rows.some((row) => row.name === columnName);
        resolve(exists);
      });
    });
  }

  /**
   * Check if a table exists
   * @param {string} tableName - Name of the table
   * @returns {Promise<boolean>} - True if table exists
   */
  async tableExists(tableName) {
    await this.db.init();

    return new Promise((resolve, reject) => {
      this.db.db.get(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
        [tableName],
        (err, row) => {
          if (err) {
            resolve(false);
            return;
          }
          resolve(!!row);
        }
      );
    });
  }

  /**
   * Safely add a column to a table (checks existence first)
   * @param {string} tableName - Name of the table
   * @param {string} columnName - Name of the column
   * @param {string} columnType - SQLite column type (e.g., 'TEXT', 'INTEGER', 'REAL')
   * @param {Object} options - Additional options
   * @param {boolean} options.notNull - Whether column is NOT NULL
   * @param {any} options.defaultValue - Default value for the column
   * @param {boolean} options.silent - If true, don't log success messages
   * @returns {Promise<{success: boolean, existed: boolean, table: string, column: string}>}
   */
  async safeAddColumn(tableName, columnName, columnType, options = {}) {
    const { notNull = false, defaultValue = null, silent = false } = options;

    await this.db.init();

    // Check if column already exists
    const exists = await this.columnExists(tableName, columnName);
    if (exists) {
      if (!silent) {
        console.log(`[SCHEMA] Column ${tableName}.${columnName} already exists, skipping`);
      }
      return {
        success: true,
        existed: true,
        table: tableName,
        column: columnName,
      };
    }

    // Check if table exists
    const tableExists = await this.tableExists(tableName);
    if (!tableExists) {
      throw new Error(`Table ${tableName} does not exist. Cannot add column ${columnName}`);
    }

    // Build ALTER TABLE statement
    let sql = `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`;

    if (notNull) {
      sql += ' NOT NULL';
    }

    if (defaultValue !== null) {
      if (typeof defaultValue === 'string') {
        sql += ` DEFAULT '${defaultValue.replace(/'/g, "''")}'`;
      } else {
        sql += ` DEFAULT ${defaultValue}`;
      }
    }

    return new Promise((resolve, reject) => {
      this.db.db.run(sql, (err) => {
        if (err) {
          console.error(`[SCHEMA] Error adding column ${tableName}.${columnName}:`, err.message);
          reject(err);
        } else {
          if (!silent) {
            console.log(`[SCHEMA] Successfully added column ${tableName}.${columnName}`);
          }
          resolve({
            success: true,
            existed: false,
            table: tableName,
            column: columnName,
          });
        }
      });
    });
  }

  /**
   * Safely add multiple columns to a table
   * @param {string} tableName - Name of the table
   * @param {Array<{name: string, type: string, notNull?: boolean, defaultValue?: any}>} columns - Array of column definitions
   * @param {boolean} silent - If true, don't log success messages
   * @returns {Promise<Array>} - Results for each column
   */
  async safeAddColumns(tableName, columns, silent = false) {
    const results = [];

    for (const col of columns) {
      try {
        const result = await this.safeAddColumn(tableName, col.name, col.type, {
          notNull: col.notNull || false,
          defaultValue: col.defaultValue !== undefined ? col.defaultValue : null,
          silent,
        });
        results.push(result);
      } catch (err) {
        console.error(`[SCHEMA] Failed to add column ${tableName}.${col.name}:`, err.message);
        results.push({
          success: false,
          existed: false,
          table: tableName,
          column: col.name,
          error: err.message,
        });
      }
    }

    return results;
  }

  /**
   * Safely create an index (checks existence first)
   * @param {string} indexName - Name of the index
   * @param {string} tableName - Name of the table
   * @param {string|Array<string>} columns - Column name(s) to index
   * @param {boolean} unique - Whether index is unique
   * @returns {Promise<{success: boolean, existed: boolean, index: string}>}
   */
  async safeCreateIndex(indexName, tableName, columns, unique = false) {
    await this.db.init();

    // Check if index exists
    return new Promise((resolve, reject) => {
      this.db.db.get(
        `SELECT name FROM sqlite_master WHERE type='index' AND name=?`,
        [indexName],
        async (err, row) => {
          if (err) {
            reject(err);
            return;
          }

          if (row) {
            console.log(`[SCHEMA] Index ${indexName} already exists, skipping`);
            resolve({
              success: true,
              existed: true,
              index: indexName,
            });
            return;
          }

          // Build CREATE INDEX statement
          const columnList = Array.isArray(columns) ? columns.join(', ') : columns;
          const uniqueClause = unique ? 'UNIQUE' : '';
          const sql = `CREATE ${uniqueClause} INDEX IF NOT EXISTS ${indexName} ON ${tableName}(${columnList})`;

          this.db.db.run(sql, (createErr) => {
            if (createErr) {
              console.error(`[SCHEMA] Error creating index ${indexName}:`, createErr.message);
              reject(createErr);
            } else {
              console.log(`[SCHEMA] Successfully created index ${indexName}`);
              resolve({
                success: true,
                existed: false,
                index: indexName,
              });
            }
          });
        }
      );
    });
  }

  /**
   * Get all columns for a table
   * @param {string} tableName - Name of the table
   * @returns {Promise<Array<{name: string, type: string, notnull: boolean, dflt_value: any}>>}
   */
  async getTableColumns(tableName) {
    await this.db.init();

    return new Promise((resolve, reject) => {
      this.db.db.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows || []);
      });
    });
  }

  /**
   * Get schema information for a table
   * @param {string} tableName - Name of the table
   * @returns {Promise<Object>} - Schema information
   */
  async getTableSchema(tableName) {
    const columns = await this.getTableColumns(tableName);
    const indexes = await this.getTableIndexes(tableName);

    return {
      table: tableName,
      columns,
      indexes,
    };
  }

  /**
   * Get all indexes for a table
   * @param {string} tableName - Name of the table
   * @returns {Promise<Array<{name: string, unique: boolean, columns: Array<string>}>>}
   */
  async getTableIndexes(tableName) {
    await this.db.init();

    return new Promise((resolve, reject) => {
      this.db.db.all(
        `SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=?`,
        [tableName],
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }

          const indexes = (rows || []).map((row) => ({
            name: row.name,
            unique: row.sql && row.sql.toUpperCase().includes('UNIQUE'),
            sql: row.sql,
          }));

          resolve(indexes);
        }
      );
    });
  }
}

module.exports = SchemaHelpers;
