/**
 * Database Size Guard
 * Prevents heavy operations on large databases to avoid OOM and startup hangs
 */

const fs = require('fs');
const path = require('path');

const DB_SIZE_THRESHOLD = 2 * 1024 * 1024 * 1024; // 2GB
const SAFE_STARTUP_THRESHOLD = 500 * 1024 * 1024; // 500MB

class DBSizeGuard {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.size = 0;
    this.shouldSkipHeavyOps = false;
    this.shouldUseBatching = false;

    this.checkSize();
  }

  checkSize() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const stats = fs.statSync(this.dbPath);
        this.size = stats.size;

        // Determine operation mode based on size
        if (this.size > DB_SIZE_THRESHOLD) {
          this.shouldSkipHeavyOps = true;
          this.shouldUseBatching = true;
          console.warn(`[DB-GUARD] Large database detected: ${(this.size / 1e9).toFixed(2)}GB`);
          console.warn('[DB-GUARD] Skipping heavy startup operations to prevent OOM');
          console.warn('[DB-GUARD] Heavy operations will run in background with batching');
        } else if (this.size > SAFE_STARTUP_THRESHOLD) {
          this.shouldUseBatching = true;
          console.log(
            `[DB-GUARD] Medium database detected: ${(this.size / 1e6).toFixed(1)}MB - using batched operations`
          );
        } else {
          console.log(
            `[DB-GUARD] Small database detected: ${(this.size / 1e6).toFixed(1)}MB - normal operations`
          );
        }
      } else {
        console.log('[DB-GUARD] New database - normal operations');
      }
    } catch (error) {
      console.warn('[DB-GUARD] Could not check database size:', error.message);
    }
  }

  getSizeHuman() {
    if (this.size > 1e9) {
      return `${(this.size / 1e9).toFixed(2)}GB`;
    } else if (this.size > 1e6) {
      return `${(this.size / 1e6).toFixed(1)}MB`;
    } else if (this.size > 1e3) {
      return `${(this.size / 1e3).toFixed(1)}KB`;
    }
    return `${this.size}B`;
  }

  shouldSkipOperation(operationName) {
    if (this.shouldSkipHeavyOps) {
      console.log(
        `[DB-GUARD] Skipping ${operationName} (database too large: ${this.getSizeHuman()})`
      );
      return true;
    }
    return false;
  }

  shouldBatchOperation(operationName) {
    if (this.shouldUseBatching) {
      console.log(`[DB-GUARD] Using batched mode for ${operationName}`);
      return true;
    }
    return false;
  }

  getRecommendedBatchSize() {
    if (this.size > DB_SIZE_THRESHOLD) {
      return 10000; // 10k rows at a time for huge DBs
    } else if (this.size > SAFE_STARTUP_THRESHOLD) {
      return 50000; // 50k rows for medium DBs
    }
    return 100000; // 100k rows for small DBs
  }
}

module.exports = DBSizeGuard;
