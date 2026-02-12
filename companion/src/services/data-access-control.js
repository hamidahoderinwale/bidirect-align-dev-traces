/**
 * Data Access Control Service
 * Controls which data sources and workspaces are accessible via API
 */

class DataAccessControl {
  constructor(config) {
    this.config = config || {};
    this.accessControl = this.config.data_access_control || {
      enabled: false,
      allowed_data_sources: [
        'cursor_db',
        'file_watcher',
        'terminal',
        'clipboard',
        'system_resources',
        'ide_state',
        'context_snapshots',
      ],
      allowed_workspaces: null, // null = all workspaces
      workspace_filtering: {
        enabled: false,
        default_scope: 'all',
      },
    };
  }

  /**
   * Check if a data source is allowed
   */
  isDataSourceAllowed(source) {
    // If access control is disabled, allow all sources
    if (!this.accessControl.enabled) {
      return true;
    }

    const allowedSources = this.accessControl.allowed_data_sources || [];
    return allowedSources.includes(source);
  }

  /**
   * Check if a workspace is allowed
   */
  isWorkspaceAllowed(workspacePath) {
    // If access control is disabled, allow all workspaces
    if (!this.accessControl.enabled) {
      return true;
    }

    const allowedWorkspaces = this.accessControl.allowed_workspaces;

    // null or empty array means all workspaces are allowed
    if (!allowedWorkspaces || allowedWorkspaces.length === 0) {
      return true;
    }

    // Check if workspace path matches any allowed workspace
    return allowedWorkspaces.some((allowed) => {
      if (typeof allowed === 'string') {
        return workspacePath.includes(allowed) || allowed.includes(workspacePath);
      }
      return false;
    });
  }

  /**
   * Filter items by workspace if workspace filtering is enabled
   */
  filterByWorkspace(items, requestedWorkspace = null) {
    // If no workspace filtering, return all items
    if (!this.accessControl.workspace_filtering?.enabled) {
      // If a specific workspace is requested, filter to that workspace
      if (requestedWorkspace && requestedWorkspace !== 'all') {
        return items.filter((item) => {
          const itemWorkspace =
            item.workspace_path || item.workspacePath || item.workspace || item.workspace_id || '';
          return (
            itemWorkspace.includes(requestedWorkspace) ||
            requestedWorkspace.includes(itemWorkspace) ||
            itemWorkspace === requestedWorkspace
          );
        });
      }
      return items;
    }

    // Workspace filtering is enabled
    const defaultScope = this.accessControl.workspace_filtering.default_scope || 'all';
    const workspaceToFilter = requestedWorkspace || defaultScope;

    if (workspaceToFilter === 'all') {
      // Check each item against allowed workspaces
      return items.filter((item) => {
        const itemWorkspace =
          item.workspace_path || item.workspacePath || item.workspace || item.workspace_id || '';
        return this.isWorkspaceAllowed(itemWorkspace);
      });
    }

    // Filter to specific workspace
    return items.filter((item) => {
      const itemWorkspace =
        item.workspace_path || item.workspacePath || item.workspace || item.workspace_id || '';
      return (
        (itemWorkspace.includes(workspaceToFilter) ||
          workspaceToFilter.includes(itemWorkspace) ||
          itemWorkspace === workspaceToFilter) &&
        this.isWorkspaceAllowed(itemWorkspace)
      );
    });
  }

  /**
   * Filter items by data source
   */
  filterByDataSource(items, source) {
    if (!this.accessControl.enabled) {
      return items;
    }

    if (this.isDataSourceAllowed(source)) {
      return items;
    }

    // Data source not allowed, return empty array
    return [];
  }

  /**
   * Determine data source from item type
   */
  getDataSourceFromItem(item) {
    // Check for explicit source field
    if (item.source) {
      if (item.source === 'cursor' || item.source === 'cursor_db') {
        return 'cursor_db';
      }
      if (item.source === 'file_watcher' || item.source === 'watcher') {
        return 'file_watcher';
      }
      if (item.source === 'terminal' || item.source === 'terminal_monitor') {
        return 'terminal';
      }
      if (item.source === 'clipboard') {
        return 'clipboard';
      }
      if (item.source === 'ide_state') {
        return 'ide_state';
      }
      if (item.source === 'context') {
        return 'context_snapshots';
      }
    }

    // Infer from item type
    if (item.type === 'terminal_command' || item.command) {
      return 'terminal';
    }
    if (item.type === 'file_change' || item.file_path) {
      // Could be from file_watcher or cursor_db
      // Default to file_watcher if it's a file change
      return 'file_watcher';
    }
    if (item.prompt_id || item.text || item.prompt) {
      return 'cursor_db';
    }
    if (item.context_files || item.context_file_count !== undefined) {
      return 'context_snapshots';
    }

    // Default to cursor_db for unknown types
    return 'cursor_db';
  }

  /**
   * Apply all filters to items
   */
  applyFilters(items, options = {}) {
    // Guard against null/undefined items
    if (!items || !Array.isArray(items)) {
      return [];
    }
    let filtered = [...items];

    // Filter by workspace if requested
    if (options.workspace) {
      filtered = this.filterByWorkspace(filtered, options.workspace);
    }

    // Filter by data source if enabled
    if (this.accessControl.enabled) {
      filtered = filtered.filter((item) => {
        const source = this.getDataSourceFromItem(item);
        return this.isDataSourceAllowed(source);
      });
    }

    return filtered;
  }

  /**
   * Get access control status
   */
  getStatus() {
    return {
      enabled: this.accessControl.enabled,
      allowed_data_sources: this.accessControl.allowed_data_sources,
      allowed_workspaces: this.accessControl.allowed_workspaces,
      workspace_filtering: this.accessControl.workspace_filtering,
    };
  }
}

module.exports = DataAccessControl;
