#!/usr/bin/env node

/**
 * Error & Bug Tracker
 * Tracks linter errors, test failures, terminal errors, and rollbacks
 */

class ErrorTracker {
  constructor() {
    this.linterErrors = [];
    this.testFailures = [];
    this.terminalErrors = [];
    this.rollbacks = [];
    this.linterStateCache = new Map(); // file -> diagnostics
    this.errorPatterns = this.initializeErrorPatterns();
  }

  /**
   * Initialize error detection patterns
   */
  initializeErrorPatterns() {
    return {
      syntax: /SyntaxError|Unexpected token|Unexpected identifier/i,
      type: /TypeError|Cannot read property|undefined is not/i,
      reference: /ReferenceError|is not defined|Cannot find/i,
      npm: /npm ERR!|yarn error|pnpm ERR!/i,
      typescript: /error TS\d+/i,
      eslint: /\d+:\d+\s+error/i,
      test: /FAIL|Test failed|AssertionError/i,
      fileNotFound: /ENOENT|no such file/i,
      permission: /EACCES|Permission denied/i,
    };
  }

  /**
   * Track linter errors after code change
   */
  async trackLinterError(fileChange, diagnostics) {
    try {
      const filePath = fileChange.file_path;
      const previousDiagnostics = this.linterStateCache.get(filePath) || [];

      // Find new errors
      const newErrors = diagnostics.filter(
        (d) =>
          !previousDiagnostics.some((prev) => prev.message === d.message && prev.line === d.line)
      );

      if (newErrors.length > 0 && fileChange.source) {
        const errorRecord = {
          id: `lint_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          codeChangeId: fileChange.id,
          promptId: fileChange.linkedPromptId || fileChange.prompt_id,
          filePath: filePath,
          errors: newErrors.map((e) => ({
            severity: e.severity, // 0=Error, 1=Warning, 2=Info
            message: e.message,
            line: e.line,
            column: e.column,
            rule: e.ruleId,
            source: e.source, // eslint, typescript, etc.
          })),
          errorCount: newErrors.length,
          timestamp: Date.now(),
          resolved: false,
        };

        this.linterErrors.push(errorRecord);

        // Keep only last 500 errors
        if (this.linterErrors.length > 500) {
          this.linterErrors = this.linterErrors.slice(-500);
        }

        console.log(`🚨 Tracked ${newErrors.length} new linter errors in ${filePath}`);
        return errorRecord;
      }

      // Update cache
      this.linterStateCache.set(filePath, diagnostics);
      return null;
    } catch (error) {
      console.error('Error tracking linter errors:', error);
      return null;
    }
  }

  /**
   * Track test failure
   */
  trackTestFailure(testOutput, recentChanges) {
    const testRecord = {
      id: `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      command: testOutput.command,
      failedTests: testOutput.failures || [],
      totalTests: testOutput.total || 0,
      failedCount: testOutput.failed || 0,
      passedCount: testOutput.passed || 0,
      failureRate: testOutput.total > 0 ? (testOutput.failed / testOutput.total) * 100 : 0,
      relatedChanges: recentChanges.map((c) => c.id),
      output: testOutput.output ? testOutput.output.slice(0, 1000) : '',
      timestamp: Date.now(),
    };

    this.testFailures.push(testRecord);

    // Keep only last 200 test failures
    if (this.testFailures.length > 200) {
      this.testFailures = this.testFailures.slice(-200);
    }

    console.log(`Tracked test failure: ${testRecord.failedCount}/${testRecord.totalTests} failed`);
    return testRecord;
  }

  /**
   * Track terminal error
   */
  trackTerminalError(command, output, exitCode) {
    const errorType = this.classifyError(output);

    const errorRecord = {
      id: `term_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      command: command,
      exitCode: exitCode,
      errorType: errorType,
      output: output.slice(0, 500),
      timestamp: Date.now(),
    };

    this.terminalErrors.push(errorRecord);

    // Keep only last 300 terminal errors
    if (this.terminalErrors.length > 300) {
      this.terminalErrors = this.terminalErrors.slice(-300);
    }

    console.log(`Tracked terminal error: ${errorType}`);
    return errorRecord;
  }

  /**
   * Classify error type from output
   */
  classifyError(output) {
    for (const [type, pattern] of Object.entries(this.errorPatterns)) {
      if (pattern.test(output)) {
        return type;
      }
    }
    return 'unknown';
  }

  /**
   * Track rollback/revert
   */
  trackRollback(gitCommand, affectedFiles, rolledBackChanges) {
    const rollbackRecord = {
      id: `rollback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      gitCommand: gitCommand,
      affectedFiles: affectedFiles,
      rolledBackChanges: rolledBackChanges.map((c) => c.id),
      timestamp: Date.now(),
      reason: 'git_revert',
    };

    this.rollbacks.push(rollbackRecord);

    // Keep only last 100 rollbacks
    if (this.rollbacks.length > 100) {
      this.rollbacks = this.rollbacks.slice(-100);
    }

    console.log(`[SYNC] Tracked rollback: ${affectedFiles.length} files affected`);
    return rollbackRecord;
  }

  /**
   * Parse test runner output
   */
  parseTestOutput(output) {
    const result = {
      total: 0,
      passed: 0,
      failed: 0,
      failures: [],
      output: output,
    };

    // Jest/Vitest patterns
    const jestPattern = /Tests:\s+(\d+)\s+failed.*?(\d+)\s+passed.*?(\d+)\s+total/i;
    const vitestPattern = /Test Files\s+(\d+)\s+failed.*?(\d+)\s+passed.*?(\d+)\s+total/i;

    let match = output.match(jestPattern) || output.match(vitestPattern);

    if (match) {
      result.failed = parseInt(match[1]);
      result.passed = parseInt(match[2]);
      result.total = parseInt(match[3]);
      result.failures = this.extractFailedTestNames(output);
    }

    return result;
  }

  /**
   * Extract failed test names from output
   */
  extractFailedTestNames(output) {
    const failures = [];
    const lines = output.split('\n');

    lines.forEach((line, index) => {
      if (line.includes('FAIL') || line.includes('✕') || line.includes('×')) {
        // Extract test name (usually after the failure marker)
        const testName = line.replace(/.*?(FAIL|✕|×)\s+/, '').trim();
        if (testName.length > 5 && testName.length < 200) {
          failures.push(testName);
        }
      }
    });

    return failures;
  }

  /**
   * Get error statistics
   */
  getErrorStats() {
    const now = Date.now();
    const last24h = now - 24 * 60 * 60 * 1000;
    const last7d = now - 7 * 24 * 60 * 60 * 1000;

    const recentLinterErrors = this.linterErrors.filter((e) => e.timestamp > last24h);
    const recentTestFailures = this.testFailures.filter((t) => t.timestamp > last24h);
    const recentTerminalErrors = this.terminalErrors.filter((e) => e.timestamp > last24h);

    return {
      linter: {
        total: this.linterErrors.length,
        last24h: recentLinterErrors.length,
        last7d: this.linterErrors.filter((e) => e.timestamp > last7d).length,
        unresolved: this.linterErrors.filter((e) => !e.resolved).length,
        byFile: this.groupErrorsByFile(this.linterErrors),
      },
      tests: {
        total: this.testFailures.length,
        last24h: recentTestFailures.length,
        avgFailureRate: this.calculateAvgFailureRate(this.testFailures),
        mostFailedTests: this.getMostFailedTests(),
      },
      terminal: {
        total: this.terminalErrors.length,
        last24h: recentTerminalErrors.length,
        byType: this.groupErrorsByType(this.terminalErrors),
      },
      rollbacks: {
        total: this.rollbacks.length,
        last24h: this.rollbacks.filter((r) => r.timestamp > last24h).length,
      },
    };
  }

  /**
   * Group errors by file
   */
  groupErrorsByFile(errors) {
    const grouped = new Map();

    errors.forEach((error) => {
      const file = error.filePath;
      if (!grouped.has(file)) {
        grouped.set(file, { file, count: 0, errors: [] });
      }
      const group = grouped.get(file);
      group.count += error.errorCount;
      group.errors.push(error);
    });

    return Array.from(grouped.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  /**
   * Group errors by type
   */
  groupErrorsByType(errors) {
    const grouped = {};

    errors.forEach((error) => {
      const type = error.errorType;
      grouped[type] = (grouped[type] || 0) + 1;
    });

    return grouped;
  }

  /**
   * Calculate average failure rate
   */
  calculateAvgFailureRate(failures) {
    if (failures.length === 0) return 0;
    const totalRate = failures.reduce((sum, f) => sum + f.failureRate, 0);
    return totalRate / failures.length;
  }

  /**
   * Get most frequently failed tests
   */
  getMostFailedTests() {
    const testCounts = new Map();

    this.testFailures.forEach((failure) => {
      failure.failedTests.forEach((testName) => {
        testCounts.set(testName, (testCounts.get(testName) || 0) + 1);
      });
    });

    return Array.from(testCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));
  }

  /**
   * Get recent errors
   */
  getRecentErrors(limit = 20) {
    const allErrors = [
      ...this.linterErrors.map((e) => ({ ...e, type: 'linter' })),
      ...this.testFailures.map((e) => ({ ...e, type: 'test' })),
      ...this.terminalErrors.map((e) => ({ ...e, type: 'terminal' })),
      ...this.rollbacks.map((e) => ({ ...e, type: 'rollback' })),
    ];

    return allErrors.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  /**
   * Mark error as resolved
   */
  resolveError(errorId) {
    const error = this.linterErrors.find((e) => e.id === errorId);
    if (error) {
      error.resolved = true;
      error.resolutionTime = Date.now() - error.timestamp;
      console.log(`[SUCCESS] Resolved error ${errorId} in ${error.resolutionTime}ms`);
    }
  }

  /**
   * Cleanup old data
   */
  cleanup() {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days

    this.linterErrors = this.linterErrors.filter((e) => e.timestamp > cutoff);
    this.testFailures = this.testFailures.filter((t) => t.timestamp > cutoff);
    this.terminalErrors = this.terminalErrors.filter((e) => e.timestamp > cutoff);
    this.rollbacks = this.rollbacks.filter((r) => r.timestamp > cutoff);
  }
}

module.exports = ErrorTracker;
