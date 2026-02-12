/**
 * Permission Checker Service
 * Detects macOS permission status and provides deep-links to System Settings
 */

const { exec, execSync } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execAsync = promisify(exec);

// Try to load native module for faster permission checks
let nativeModule = null;
try {
  nativeModule = require('../../native');
  console.log('[PERMISSIONS] Native module loaded for fast permission checking');
} catch (error) {
  console.log('[PERMISSIONS] Native module not available, using fallback methods');
}

class PermissionChecker {
  constructor() {
    this.cache = {
      lastCheck: null,
      results: null,
      ttl: 5000, // Cache for 5 seconds
    };

    // Track which permissions have failed during runtime
    this.runtimeFailures = {
      fullDiskAccess: false,
      accessibility: false,
      automation: false,
      systemResources: false,
      screenRecording: false,
    };

    // Use native module if available
    this.useNative = nativeModule !== null && os.platform() === 'darwin';
  }

  /**
   * Record a runtime permission failure
   */
  recordFailure(permissionType) {
    if (this.runtimeFailures.hasOwnProperty(permissionType)) {
      this.runtimeFailures[permissionType] = true;
    }
  }

  /**
   * Check if we have Full Disk Access
   * Tests by trying to read a protected directory
   */
  async checkFullDiskAccess() {
    // If we've had runtime failures, return false
    if (this.runtimeFailures.fullDiskAccess) {
      return { granted: false, reason: 'Runtime file access denied' };
    }

    // Use native check if available (faster)
    if (this.useNative && nativeModule) {
      try {
        const granted = nativeModule.checkFullDiskAccess();
        return { granted, method: 'native' };
      } catch (error) {
        console.warn('[PERMISSIONS] Native check failed, falling back:', error.message);
      }
    }

    const testPaths = [
      path.join(os.homedir(), 'Library/Mail'),
      path.join(os.homedir(), 'Library/Safari'),
      '/Library/Application Support',
    ];

    for (const testPath of testPaths) {
      try {
        fs.accessSync(testPath, fs.constants.R_OK);
        return { granted: true };
      } catch (e) {
        // Continue to next path
      }
    }

    // Try to read Cursor's own data as a softer check
    const cursorPath = path.join(os.homedir(), 'Library/Application Support/Cursor');
    try {
      fs.accessSync(cursorPath, fs.constants.R_OK);
      return { granted: true, partial: true, reason: 'Partial access (Cursor data readable)' };
    } catch (e) {
      return { granted: false, reason: 'Cannot read protected directories' };
    }
  }

  /**
   * Check if we have Accessibility access
   * Tests by trying to run an AppleScript that requires accessibility
   */
  async checkAccessibility() {
    // If we've had runtime failures, return false
    if (this.runtimeFailures.accessibility) {
      return { granted: false, reason: 'Runtime AppleScript failures' };
    }

    // Use native check if available (faster)
    if (this.useNative && nativeModule) {
      try {
        const granted = nativeModule.checkAccessibilityPermission();
        return { granted, method: 'native' };
      } catch (error) {
        console.warn(
          '[PERMISSIONS] Native accessibility check failed, falling back:',
          error.message
        );
      }
    }

    try {
      // Simple AppleScript that requires accessibility permission
      const script = `
        tell application "System Events"
          return name of first process whose frontmost is true
        end tell
      `;
      await execAsync(`osascript -e '${script}'`, { timeout: 3000 });
      return { granted: true };
    } catch (error) {
      if (
        error.message.includes('not allowed') ||
        error.message.includes('assistive access') ||
        error.message.includes('System Events')
      ) {
        return { granted: false, reason: 'Accessibility permission not granted' };
      }
      return { granted: false, reason: error.message };
    }
  }

  /**
   * Check if we have Automation permission for System Events
   */
  async checkAutomation() {
    // If we've had runtime failures, return false
    if (this.runtimeFailures.automation) {
      return { granted: false, reason: 'Runtime automation failures' };
    }

    try {
      // Try to get list of processes - requires automation permission
      const script = `
        tell application "System Events"
          return count of processes
        end tell
      `;
      const { stdout } = await execAsync(`osascript -e '${script}'`, { timeout: 3000 });
      const count = parseInt(stdout.trim());
      if (count > 0) {
        return { granted: true };
      }
      return { granted: false, reason: 'Unexpected response' };
    } catch (error) {
      return { granted: false, reason: 'Automation permission not granted' };
    }
  }

  /**
   * Check if we have Screen Recording permission
   */
  async checkScreenRecording() {
    // If we've had runtime failures, return false
    if (this.runtimeFailures.screenRecording) {
      return { granted: false, reason: 'Runtime screen capture failures' };
    }

    // Use native check if available (faster)
    if (this.useNative && nativeModule) {
      try {
        const granted = nativeModule.checkScreenRecordingPermission();
        return { granted, method: 'native' };
      } catch (error) {
        console.warn(
          '[PERMISSIONS] Native screen recording check failed, falling back:',
          error.message
        );
      }
    }

    try {
      // Try to capture a tiny screenshot
      await execAsync('screencapture -x -t png -R 0,0,1,1 /tmp/cursor_perm_test.png', {
        timeout: 2000,
      });
      fs.unlinkSync('/tmp/cursor_perm_test.png');
      return { granted: true };
    } catch (error) {
      return { granted: false, reason: 'Screen recording permission not granted' };
    }
  }

  /**
   * Check if system resource monitoring works
   */
  async checkSystemResources() {
    // If we've had runtime failures, return false
    if (this.runtimeFailures.systemResources) {
      return { granted: false, reason: 'Runtime EPERM errors on os.uptime()' };
    }

    try {
      // These calls can fail in sandbox mode
      os.uptime();
      os.loadavg();
      os.freemem();

      // Try ps command
      await execAsync('ps aux | head -1', { timeout: 2000 });
      return { granted: true };
    } catch (error) {
      if (
        error.code === 'EPERM' ||
        error.message.includes('EPERM') ||
        error.message.includes('Operation not permitted')
      ) {
        return { granted: false, reason: 'Sandboxed - system calls blocked' };
      }
      return { granted: false, reason: error.message };
    }
  }

  /**
   * Check all permissions at once using native module (if available)
   */
  async checkAllNative() {
    if (!this.useNative || !nativeModule) {
      return null;
    }

    try {
      const status = nativeModule.checkAllPermissions();
      return {
        fullDiskAccess: { granted: status.fullDiskAccess, method: 'native' },
        accessibility: { granted: status.accessibility, method: 'native' },
        screenRecording:
          status.screenRecording !== null
            ? { granted: status.screenRecording, method: 'native' }
            : null,
        automation: null, // Cannot check without triggering prompt
      };
    } catch (error) {
      console.warn('[PERMISSIONS] Native bulk check failed:', error.message);
      return null;
    }
  }

  /**
   * Check all permissions
   */
  async checkAll() {
    // Return cached results if fresh
    if (
      this.cache.lastCheck &&
      Date.now() - this.cache.lastCheck < this.cache.ttl &&
      this.cache.results
    ) {
      return this.cache.results;
    }

    // Try native bulk check first (faster)
    const nativeResults = await this.checkAllNative();

    let fullDiskAccess, accessibility, screenRecording;

    if (nativeResults) {
      fullDiskAccess = nativeResults.fullDiskAccess;
      accessibility = nativeResults.accessibility;
      screenRecording = nativeResults.screenRecording || (await this.checkScreenRecording());
    } else {
      // Fallback to individual checks
      [fullDiskAccess, accessibility, screenRecording] = await Promise.all([
        this.checkFullDiskAccess(),
        this.checkAccessibility(),
        this.checkScreenRecording(),
      ]);
    }

    // Always check these individually (no native equivalent)
    const [automation, systemResources] = await Promise.all([
      this.checkAutomation(),
      this.checkSystemResources(),
    ]);

    const results = {
      timestamp: new Date().toISOString(),
      platform: os.platform(),
      usingNative: this.useNative,
      allGranted:
        fullDiskAccess.granted &&
        accessibility.granted &&
        automation.granted &&
        systemResources.granted,
      permissions: {
        fullDiskAccess: {
          ...fullDiskAccess,
          name: 'Full Disk Access',
          description: 'Required to read Cursor databases and log files',
          settingsUrl: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
          priority: 'high',
        },
        accessibility: {
          ...accessibility,
          name: 'Accessibility',
          description: 'Required for AppleScript integration and UI state capture',
          settingsUrl:
            'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
          priority: 'high',
        },
        automation: {
          ...automation,
          name: 'Automation',
          description: 'Required to control System Events for state monitoring',
          settingsUrl: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
          priority: 'medium',
        },
        screenRecording: {
          ...screenRecording,
          name: 'Screen Recording',
          description: 'Optional - enables screenshot capture features',
          settingsUrl:
            'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
          priority: 'low',
        },
        systemResources: {
          ...systemResources,
          name: 'System Resources',
          description: 'Required for CPU, memory, and process monitoring',
          settingsUrl: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
          priority: 'low',
        },
      },
      runtimeFailures: this.runtimeFailures,
    };

    // Cache results
    this.cache.lastCheck = Date.now();
    this.cache.results = results;

    return results;
  }

  /**
   * Open System Settings to a specific permission pane
   */
  async openSettings(permissionType) {
    // Try native method first (more reliable)
    if (this.useNative && nativeModule) {
      try {
        const success = nativeModule.openPermissionSettings(permissionType);
        if (success) {
          return { success: true, opened: permissionType, method: 'native' };
        }
      } catch (error) {
        console.warn('[PERMISSIONS] Native open settings failed, falling back:', error.message);
      }
    }

    // Fallback to URL-based opening
    const urls = {
      fullDiskAccess: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
      full_disk_access: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
      accessibility:
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
      screenRecording:
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      screen_recording:
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      general: 'x-apple.systempreferences:com.apple.preference.security',
    };

    const url = urls[permissionType] || urls.general;

    try {
      await execAsync(`open "${url}"`);
      return { success: true, opened: permissionType, url };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Request automation permission (triggers system dialog)
   */
  async requestAutomationPermission() {
    // Use native method if available
    if (this.useNative && nativeModule) {
      try {
        const success = nativeModule.requestAutomationPermission();
        return { success, method: 'native' };
      } catch (error) {
        console.warn(
          '[PERMISSIONS] Native automation request failed, falling back:',
          error.message
        );
      }
    }

    // Fallback: trigger AppleScript that will prompt for permission
    try {
      const script = `
        tell application "System Events"
          display dialog "Cursor Telemetry needs Automation permission." buttons {"OK"} default button 1 with icon note giving up after 5
        end tell
      `;
      await execAsync(`osascript -e '${script}'`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get instructions for fixing permissions
   */
  getInstructions() {
    return {
      title: 'Fix Permission Issues',
      steps: [
        {
          step: 1,
          title: 'Open System Settings',
          description: 'Click Apple menu () → System Settings → Privacy & Security',
        },
        {
          step: 2,
          title: 'Grant Full Disk Access',
          description:
            'Click "Full Disk Access" → Click + → Add Cursor.app (and Terminal.app if running from terminal)',
        },
        {
          step: 3,
          title: 'Grant Accessibility',
          description: 'Click "Accessibility" → Click + → Add Cursor.app',
        },
        {
          step: 4,
          title: 'Grant Automation',
          description: 'Click "Automation" → Find Cursor → Enable "System Events"',
        },
        {
          step: 5,
          title: 'Restart',
          description: 'Quit and reopen Cursor IDE for changes to take effect',
        },
      ],
      note: 'You may need to unlock the settings with your password by clicking the lock icon.',
    };
  }
}

module.exports = PermissionChecker;
