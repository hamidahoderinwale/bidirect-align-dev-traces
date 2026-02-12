/**
 * Automatic Mining Scheduler
 * Triggers historical mining automatically on workspace detection and scheduled intervals
 */

const cron = require('node-cron');

class AutomaticMiningScheduler {
  constructor(historicalMiningService, persistentDB, options = {}) {
    this.historicalMiningService = historicalMiningService;
    this.persistentDB = persistentDB;
    this.options = {
      enableAutoMining: options.enableAutoMining !== false,
      mineOnWorkspaceDetection: options.mineOnWorkspaceDetection !== false,
      scheduleWeeklyBackfill: options.scheduleWeeklyBackfill !== false,
      weeklyBackfillDay: options.weeklyBackfillDay || 0, // Sunday
      weeklyBackfillHour: options.weeklyBackfillHour || 2, // 2 AM
      ...options,
    };

    this.minedWorkspaces = new Set();
    this.scheduledJobs = [];
    this.isInitialized = false;
  }

  /**
   * Initialize automatic mining
   */
  async initialize() {
    if (!this.options.enableAutoMining) {
      console.log('[AUTO-MINING] Automatic mining disabled');
      return;
    }

    console.log('[AUTO-MINING] Initializing automatic mining scheduler');

    // Load already mined workspaces
    await this.loadMinedWorkspaces();

    // Schedule weekly backfill if enabled
    if (this.options.scheduleWeeklyBackfill) {
      this.scheduleWeeklyBackfill();
    }

    this.isInitialized = true;
    console.log('[AUTO-MINING] Automatic mining scheduler initialized');
  }

  /**
   * Load list of already mined workspaces from database
   */
  async loadMinedWorkspaces() {
    try {
      const runs = await this.persistentDB.getMiningRuns({ limit: 1000 });

      runs.forEach((run) => {
        if (run.workspace_path && run.status === 'completed') {
          this.minedWorkspaces.add(run.workspace_path);
        }
      });

      console.log(`[AUTO-MINING] Loaded ${this.minedWorkspaces.size} previously mined workspaces`);
    } catch (error) {
      console.error('[AUTO-MINING] Error loading mined workspaces:', error);
    }
  }

  /**
   * Called when a new workspace is detected
   */
  async onWorkspaceDetected(workspacePath) {
    if (!this.options.mineOnWorkspaceDetection) {
      return;
    }

    // Check if already mined
    if (this.minedWorkspaces.has(workspacePath)) {
      console.log(`[AUTO-MINING] Workspace already mined: ${workspacePath}`);
      return;
    }

    // Check if it's a git repository
    const fs = require('fs');
    const path = require('path');
    const gitDir = path.join(workspacePath, '.git');

    if (!fs.existsSync(gitDir)) {
      console.log(`[AUTO-MINING] Not a git repository, skipping: ${workspacePath}`);
      return;
    }

    console.log(`[AUTO-MINING] New workspace detected, starting mining: ${workspacePath}`);

    // Start mining in background
    this.mineWorkspaceBackground(workspacePath, {
      reason: 'workspace_detection',
      includeGit: true,
      includeShell: false, // Don't mine shell on every workspace
      includeCursorLogs: true,
      includeFileTimeline: false, // Can be slow
      sinceDays: 365,
    });
  }

  /**
   * Mine workspace in background (doesn't block)
   */
  async mineWorkspaceBackground(workspacePath, options = {}) {
    const { reason = 'manual', ...miningOptions } = options;

    // Don't mine if already in progress
    const status = this.historicalMiningService.getStatus();
    if (status.inProgress) {
      console.log('[AUTO-MINING] Mining already in progress, queuing workspace:', workspacePath);
      // Could implement a queue here
      return;
    }

    // Mark as mined (even if it fails, to avoid retry loops)
    this.minedWorkspaces.add(workspacePath);

    try {
      console.log(
        `[AUTO-MINING] Starting background mining for ${workspacePath} (reason: ${reason})`
      );

      const result = await this.historicalMiningService.mineWorkspace(workspacePath, miningOptions);

      console.log(`[AUTO-MINING] Mining completed for ${workspacePath}:`, {
        commits: result.git?.commits || 0,
        commands: result.shell?.commands || 0,
        prompts: result.cursor_logs?.prompts || 0,
        duration_ms: result.duration_ms,
      });
    } catch (error) {
      console.error(`[AUTO-MINING] Mining failed for ${workspacePath}:`, error.message);
      // Remove from mined set so it can be retried
      this.minedWorkspaces.delete(workspacePath);
    }
  }

  /**
   * Schedule weekly backfill mining
   */
  scheduleWeeklyBackfill() {
    const { weeklyBackfillDay, weeklyBackfillHour } = this.options;

    // Cron pattern: minute hour day-of-month month day-of-week
    // Run at specified hour on specified day of week
    const cronPattern = `0 ${weeklyBackfillHour} * * ${weeklyBackfillDay}`;

    const job = cron.schedule(cronPattern, async () => {
      console.log('[AUTO-MINING] Running scheduled weekly backfill');
      await this.runWeeklyBackfill();
    });

    this.scheduledJobs.push(job);

    console.log(`[AUTO-MINING] Scheduled weekly backfill: ${this.getCronDescription(cronPattern)}`);
  }

  /**
   * Run weekly backfill for all known workspaces
   */
  async runWeeklyBackfill() {
    try {
      // Get all workspaces
      const workspaces = await this.getAllWorkspaces();

      console.log(`[AUTO-MINING] Weekly backfill starting for ${workspaces.length} workspaces`);

      for (const workspace of workspaces) {
        // Mine incremental data (only recent commits)
        await this.mineWorkspaceBackground(workspace, {
          reason: 'weekly_backfill',
          includeGit: true,
          includeShell: false,
          includeCursorLogs: true,
          includeFileTimeline: false,
          sinceDays: 14, // Only last 2 weeks for weekly backfill
        });

        // Small delay between workspaces
        await this.sleep(5000);
      }

      console.log('[AUTO-MINING] Weekly backfill completed');
    } catch (error) {
      console.error('[AUTO-MINING] Weekly backfill error:', error);
    }
  }

  /**
   * Get all known workspaces
   */
  async getAllWorkspaces() {
    try {
      // This would need to be implemented to track all workspaces
      // For now, get unique workspaces from mining runs
      const runs = await this.persistentDB.getMiningRuns({ limit: 1000 });
      const workspaces = [...new Set(runs.map((r) => r.workspace_path).filter(Boolean))];
      return workspaces;
    } catch (error) {
      console.error('[AUTO-MINING] Error getting workspaces:', error);
      return [];
    }
  }

  /**
   * Manually trigger mining for a workspace
   */
  async triggerManualMining(workspacePath, options = {}) {
    return this.mineWorkspaceBackground(workspacePath, {
      reason: 'manual',
      ...options,
    });
  }

  /**
   * Stop all scheduled jobs
   */
  stop() {
    this.scheduledJobs.forEach((job) => {
      if (job && job.stop) {
        job.stop();
      }
    });
    this.scheduledJobs = [];
    console.log('[AUTO-MINING] Scheduler stopped');
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      enabled: this.options.enableAutoMining,
      mineOnDetection: this.options.mineOnWorkspaceDetection,
      weeklyBackfill: this.options.scheduleWeeklyBackfill,
      minedWorkspaces: this.minedWorkspaces.size,
      scheduledJobs: this.scheduledJobs.length,
      isInitialized: this.isInitialized,
    };
  }

  /**
   * Get human-readable cron description
   */
  getCronDescription(pattern) {
    const parts = pattern.split(' ');
    const hour = parts[1];
    const dayOfWeek = parts[4];

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = days[parseInt(dayOfWeek)] || 'Unknown';

    return `Every ${dayName} at ${hour}:00`;
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = AutomaticMiningScheduler;
