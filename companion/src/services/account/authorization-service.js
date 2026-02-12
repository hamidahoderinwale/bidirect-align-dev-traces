/**
 * Authorization Service
 * Manages user permissions and tool access control
 */

class AuthorizationService {
  constructor(persistentDB, options = {}) {
    this.db = persistentDB;
    this.options = options;

    // Define available tools and their required permissions
    this.tools = {
      'file-contents': { permission: 'read_files', description: 'Read file contents' },
      'file-relationships': { permission: 'read_files', description: 'View file relationships' },
      analytics: { permission: 'read_analytics', description: 'Access analytics data' },
      export: { permission: 'export_data', description: 'Export data' },
      sync: { permission: 'sync_data', description: 'Sync data to cloud' },
      admin: { permission: 'admin', description: 'Administrative access' },
    };

    // Initialize authorization tables
    this.initializeTables();
  }

  /**
   * Initialize authorization-related database tables
   */
  async initializeTables() {
    const createPermissionsTable = `
      CREATE TABLE IF NOT EXISTS permissions (
        account_id TEXT,
        permission TEXT,
        granted_at INTEGER,
        granted_by TEXT,
        PRIMARY KEY (account_id, permission),
        FOREIGN KEY (account_id) REFERENCES accounts(account_id)
      )
    `;

    const createRolesTable = `
      CREATE TABLE IF NOT EXISTS roles (
        role_id TEXT PRIMARY KEY,
        name TEXT,
        permissions TEXT,
        created_at INTEGER
      )
    `;

    const createAccountRolesTable = `
      CREATE TABLE IF NOT EXISTS account_roles (
        account_id TEXT,
        role_id TEXT,
        granted_at INTEGER,
        PRIMARY KEY (account_id, role_id),
        FOREIGN KEY (account_id) REFERENCES accounts(account_id),
        FOREIGN KEY (role_id) REFERENCES roles(role_id)
      )
    `;

    try {
      await this.db.run(createPermissionsTable);
      await this.db.run(createRolesTable);
      await this.db.run(createAccountRolesTable);

      // Create default roles
      await this.createDefaultRoles();

      console.log('[AUTHZ] Authorization tables initialized');
    } catch (error) {
      console.error('[AUTHZ] Failed to initialize tables:', error.message);
    }
  }

  /**
   * Create default roles
   */
  async createDefaultRoles() {
    const defaultRoles = [
      {
        role_id: 'user',
        name: 'User',
        permissions: ['read_files', 'read_analytics'],
      },
      {
        role_id: 'power_user',
        name: 'Power User',
        permissions: ['read_files', 'read_analytics', 'export_data'],
      },
      {
        role_id: 'admin',
        name: 'Administrator',
        permissions: ['read_files', 'read_analytics', 'export_data', 'sync_data', 'admin'],
      },
    ];

    for (const role of defaultRoles) {
      const existing = await this.db.get('SELECT role_id FROM roles WHERE role_id = ?', [
        role.role_id,
      ]);
      if (!existing) {
        await this.db.run(
          'INSERT INTO roles (role_id, name, permissions, created_at) VALUES (?, ?, ?, ?)',
          [role.role_id, role.name, JSON.stringify(role.permissions), Date.now()]
        );
      }
    }
  }

  /**
   * Grant permission to account
   */
  async grantPermission(accountId, permission, grantedBy = 'system') {
    await this.db.run(
      'INSERT OR REPLACE INTO permissions (account_id, permission, granted_at, granted_by) VALUES (?, ?, ?, ?)',
      [accountId, permission, Date.now(), grantedBy]
    );
  }

  /**
   * Revoke permission from account
   */
  async revokePermission(accountId, permission) {
    await this.db.run('DELETE FROM permissions WHERE account_id = ? AND permission = ?', [
      accountId,
      permission,
    ]);
  }

  /**
   * Assign role to account
   */
  async assignRole(accountId, roleId) {
    await this.db.run(
      'INSERT OR REPLACE INTO account_roles (account_id, role_id, granted_at) VALUES (?, ?, ?)',
      [accountId, roleId, Date.now()]
    );

    // Grant all permissions from the role
    const role = await this.db.get('SELECT permissions FROM roles WHERE role_id = ?', [roleId]);
    if (role) {
      const permissions = JSON.parse(role.permissions);
      for (const permission of permissions) {
        await this.grantPermission(accountId, permission, 'role:' + roleId);
      }
    }
  }

  /**
   * Remove role from account
   */
  async removeRole(accountId, roleId) {
    await this.db.run('DELETE FROM account_roles WHERE account_id = ? AND role_id = ?', [
      accountId,
      roleId,
    ]);

    // Revoke permissions granted by this role
    await this.db.run('DELETE FROM permissions WHERE account_id = ? AND granted_by = ?', [
      accountId,
      'role:' + roleId,
    ]);
  }

  /**
   * Check if account has permission
   */
  async hasPermission(accountId, permission) {
    if (!accountId) {
      return false;
    }

    // Check direct permission
    const directPermission = await this.db.get(
      'SELECT permission FROM permissions WHERE account_id = ? AND permission = ?',
      [accountId, permission]
    );

    if (directPermission) {
      return true;
    }

    // Check role-based permissions
    const roles = await this.db.all('SELECT role_id FROM account_roles WHERE account_id = ?', [
      accountId,
    ]);

    for (const roleRow of roles) {
      const role = await this.db.get('SELECT permissions FROM roles WHERE role_id = ?', [
        roleRow.role_id,
      ]);

      if (role) {
        const permissions = JSON.parse(role.permissions);
        if (permissions.includes(permission)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if account can access tool
   */
  async canAccessTool(accountId, toolName) {
    const tool = this.tools[toolName];
    if (!tool) {
      // Unknown tool - deny by default
      return false;
    }

    return await this.hasPermission(accountId, tool.permission);
  }

  /**
   * Get all permissions for account
   */
  async getAccountPermissions(accountId) {
    const directPermissions = await this.db.all(
      'SELECT permission FROM permissions WHERE account_id = ?',
      [accountId]
    );

    const roles = await this.db.all('SELECT role_id FROM account_roles WHERE account_id = ?', [
      accountId,
    ]);

    const rolePermissions = new Set();
    for (const roleRow of roles) {
      const role = await this.db.get('SELECT permissions FROM roles WHERE role_id = ?', [
        roleRow.role_id,
      ]);

      if (role) {
        const permissions = JSON.parse(role.permissions);
        permissions.forEach((p) => rolePermissions.add(p));
      }
    }

    const allPermissions = new Set();
    directPermissions.forEach((p) => allPermissions.add(p.permission));
    rolePermissions.forEach((p) => allPermissions.add(p));

    return Array.from(allPermissions);
  }

  /**
   * Get account roles
   */
  async getAccountRoles(accountId) {
    const roles = await this.db.all(
      `SELECT r.role_id, r.name, r.permissions 
       FROM roles r
       INNER JOIN account_roles ar ON r.role_id = ar.role_id
       WHERE ar.account_id = ?`,
      [accountId]
    );

    return roles.map((role) => ({
      role_id: role.role_id,
      name: role.name,
      permissions: JSON.parse(role.permissions),
    }));
  }

  /**
   * Get all available tools
   */
  getAvailableTools() {
    return Object.keys(this.tools).map((toolName) => ({
      name: toolName,
      ...this.tools[toolName],
    }));
  }

  /**
   * Get tools accessible by account
   */
  async getAccessibleTools(accountId) {
    const accountPermissions = await this.getAccountPermissions(accountId);
    const accessibleTools = [];

    for (const [toolName, tool] of Object.entries(this.tools)) {
      if (accountPermissions.includes(tool.permission)) {
        accessibleTools.push({
          name: toolName,
          ...tool,
        });
      }
    }

    return accessibleTools;
  }
}

module.exports = AuthorizationService;
