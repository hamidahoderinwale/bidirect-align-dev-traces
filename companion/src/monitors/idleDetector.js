import cron from 'node-cron';
import { queue } from '../utils/queue.js';

class IdleDetector {
  constructor() {
    this.isRunning = false;
    this.lastActivity = Date.now();
    this.idleThreshold = 5 * 60 * 1000; // 5 minutes
    this.isIdle = false;
    this.cronJob = null;
  }

  start() {
    if (this.isRunning) {
      console.log('�Idle detector already running');
      return;
    }

    this.isRunning = true;
    this.lastActivity = Date.now();

    // Check for idle every 30 seconds
    this.cronJob = cron.schedule('*/30 * * * * *', () => {
      this.checkIdleStatus();
    });

    console.log('[WEB] Idle detector started');
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.destroy();
      this.cronJob = null;
    }
    this.isRunning = false;
    console.log(' Idle detector stopped');
  }

  updateActivity() {
    this.lastActivity = Date.now();

    // If we were idle and now have activity, resume logging
    if (this.isIdle) {
      this.isIdle = false;
      console.log('[WEB]Activity resumed - logging enabled');

      queue.addEvent({
        type: 'resume_logging',
        details: {
          reason: 'user_activity',
          idle_duration: Date.now() - this.lastActivity,
        },
      });
    }
  }

  checkIdleStatus() {
    const now = Date.now();
    const timeSinceActivity = now - this.lastActivity;

    if (timeSinceActivity >= this.idleThreshold && !this.isIdle) {
      this.isIdle = true;
      console.log('[WEB]User idle - pausing logging');

      queue.addEvent({
        type: 'pause_logging',
        details: {
          reason: 'user_idle',
          idle_threshold: this.idleThreshold,
          idle_duration: timeSinceActivity,
        },
      });
    }
  }

  // Method to be called by file watcher when files change
  onFileActivity() {
    this.updateActivity();
  }

  // Method to be called by MCP when user interacts
  onUserActivity() {
    this.updateActivity();
  }

  getStatus() {
    return {
      is_running: this.isRunning,
      is_idle: this.isIdle,
      last_activity: new Date(this.lastActivity).toISOString(),
      time_since_activity: Date.now() - this.lastActivity,
      idle_threshold: this.idleThreshold,
    };
  }
}

export const idleDetector = new IdleDetector();
