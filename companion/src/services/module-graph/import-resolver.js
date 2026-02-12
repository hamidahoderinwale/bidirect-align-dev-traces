/**
 * Advanced Import Resolver
 * Resolves import paths to actual file paths, handling node_modules, TypeScript paths, etc.
 */

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { getConfig } = require('./config');

class ImportResolver {
  constructor(workspaceRoot = null) {
    this.workspaceRoot = workspaceRoot || process.cwd();
    this.cache = new Map(); // Cache resolved paths
    this.packageJsonCache = new Map(); // Cache package.json contents
    this.tsConfigCache = new Map(); // Cache tsconfig.json contents
  }

  /**
   * Resolve import path to actual file path
   * @param {string} importPath - Import path
   * @param {string} fromFile - File making the import
   * @param {object} options - Options
   * @returns {string|null} Resolved file path or null
   */
  async resolve(importPath, fromFile, options = {}) {
    const cacheKey = `${importPath}:${fromFile}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    let resolved = null;

    // Remove file extension if present
    const cleanPath = importPath.replace(/\.(js|ts|jsx|tsx|py|json)$/, '');

    // Try different resolution strategies
    if (cleanPath.startsWith('.')) {
      // Relative import
      resolved = await this.resolveRelative(cleanPath, fromFile);
    } else if (cleanPath.startsWith('/')) {
      // Absolute import (from workspace root)
      resolved = await this.resolveAbsolute(cleanPath, fromFile);
    } else {
      // Package/module import
      resolved = await this.resolvePackage(cleanPath, fromFile, options);
    }

    // Try TypeScript path mappings if enabled
    if (!resolved && getConfig('edges.import.resolveTypeScriptPaths', true)) {
      resolved = await this.resolveTypeScriptPath(cleanPath, fromFile);
    }

    // Try common extensions if not found
    if (resolved && !fsSync.existsSync(resolved)) {
      resolved = await this.tryExtensions(resolved);
    }

    this.cache.set(cacheKey, resolved);
    return resolved;
  }

  /**
   * Resolve relative import
   * @param {string} importPath - Relative path
   * @param {string} fromFile - Source file
   * @returns {string|null} Resolved path
   */
  async resolveRelative(importPath, fromFile) {
    const fromDir = path.dirname(fromFile);
    const resolved = path.resolve(fromDir, importPath);

    // Try as directory with index file
    if (fsSync.existsSync(resolved) && fsSync.statSync(resolved).isDirectory()) {
      const indexFiles = ['index.js', 'index.ts', 'index.jsx', 'index.tsx'];
      for (const indexFile of indexFiles) {
        const indexPath = path.join(resolved, indexFile);
        if (fsSync.existsSync(indexPath)) {
          return indexPath;
        }
      }
    }

    return resolved;
  }

  /**
   * Resolve absolute import
   * @param {string} importPath - Absolute path
   * @param {string} fromFile - Source file
   * @returns {string|null} Resolved path
   */
  async resolveAbsolute(importPath, fromFile) {
    // Resolve from workspace root
    const resolved = path.resolve(this.workspaceRoot, importPath.substring(1));
    return resolved;
  }

  /**
   * Resolve package/module import
   * @param {string} importPath - Package path
   * @param {string} fromFile - Source file
   * @param {object} options - Options
   * @returns {Promise<string|null>} Resolved path
   */
  async resolvePackage(importPath, fromFile, options = {}) {
    if (!getConfig('edges.import.resolveNodeModules', true)) {
      return null;
    }

    // Find package.json starting from file's directory
    const packageJsonPath = await this.findPackageJson(fromFile);
    if (!packageJsonPath) {
      return null;
    }

    const packageJson = await this.loadPackageJson(packageJsonPath);
    const packageDir = path.dirname(packageJsonPath);

    // Check if it's a local package (workspace/monorepo)
    if (packageJson.workspaces) {
      // Monorepo - check workspace packages
      for (const workspace of packageJson.workspaces) {
        const workspacePath = path.resolve(packageDir, workspace);
        const resolved = await this.resolveInWorkspace(importPath, workspacePath);
        if (resolved) return resolved;
      }
    }

    // Check node_modules
    const nodeModulesPath = path.join(packageDir, 'node_modules');
    if (fsSync.existsSync(nodeModulesPath)) {
      const resolved = await this.resolveInNodeModules(importPath, nodeModulesPath);
      if (resolved) return resolved;
    }

    // Check parent directories for node_modules
    let currentDir = path.dirname(fromFile);
    const rootDir = this.workspaceRoot;

    while (currentDir !== rootDir && currentDir !== path.dirname(currentDir)) {
      const parentNodeModules = path.join(currentDir, 'node_modules');
      if (fsSync.existsSync(parentNodeModules)) {
        const resolved = await this.resolveInNodeModules(importPath, parentNodeModules);
        if (resolved) return resolved;
      }
      currentDir = path.dirname(currentDir);
    }

    return null;
  }

  /**
   * Resolve in node_modules
   * @param {string} importPath - Import path
   * @param {string} nodeModulesPath - node_modules directory
   * @returns {Promise<string|null>} Resolved path
   */
  async resolveInNodeModules(importPath, nodeModulesPath) {
    const parts = importPath.split('/');
    const packageName = parts[0];
    const packagePath = path.join(nodeModulesPath, packageName);

    if (!fsSync.existsSync(packagePath)) {
      return null;
    }

    // Load package.json
    const packageJsonPath = path.join(packagePath, 'package.json');
    if (fsSync.existsSync(packageJsonPath)) {
      const packageJson = await this.loadPackageJson(packageJsonPath);

      // Check main/module/exports fields
      const mainFile = packageJson.main || packageJson.module || 'index.js';
      const subPath = parts.slice(1).join('/');

      if (subPath) {
        // Sub-path import
        const resolved = path.join(packagePath, subPath);
        return await this.tryExtensions(resolved);
      } else {
        // Root import
        const resolved = path.join(packagePath, mainFile);
        return await this.tryExtensions(resolved);
      }
    }

    // Fallback: try index.js
    const indexPath = path.join(packagePath, 'index.js');
    if (fsSync.existsSync(indexPath)) {
      return indexPath;
    }

    return null;
  }

  /**
   * Resolve TypeScript path mappings
   * @param {string} importPath - Import path
   * @param {string} fromFile - Source file
   * @returns {Promise<string|null>} Resolved path
   */
  async resolveTypeScriptPath(importPath, fromFile) {
    const tsConfigPath = await this.findTsConfig(fromFile);
    if (!tsConfigPath) {
      return null;
    }

    const tsConfig = await this.loadTsConfig(tsConfigPath);
    const paths = tsConfig.compilerOptions?.paths || {};
    const baseUrl = tsConfig.compilerOptions?.baseUrl || '.';
    const tsConfigDir = path.dirname(tsConfigPath);

    // Find matching path mapping
    for (const [pattern, replacements] of Object.entries(paths)) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      if (regex.test(importPath)) {
        for (const replacement of replacements) {
          const resolved = replacement.replace(
            /\*/g,
            importPath.replace(pattern.replace(/\*/, ''), '')
          );
          const fullPath = path.resolve(tsConfigDir, baseUrl, resolved);
          const withExt = await this.tryExtensions(fullPath);
          if (withExt && fsSync.existsSync(withExt)) {
            return withExt;
          }
        }
      }
    }

    return null;
  }

  /**
   * Try common file extensions
   * @param {string} filePath - File path without extension
   * @returns {Promise<string|null>} Path with extension or null
   */
  async tryExtensions(filePath) {
    const extensions = ['.js', '.ts', '.jsx', '.tsx', '.json', '.py'];

    for (const ext of extensions) {
      const withExt = filePath + ext;
      if (fsSync.existsSync(withExt)) {
        return withExt;
      }
    }

    // Try as directory with index
    if (fsSync.existsSync(filePath) && fsSync.statSync(filePath).isDirectory()) {
      for (const ext of extensions) {
        const indexPath = path.join(filePath, `index${ext}`);
        if (fsSync.existsSync(indexPath)) {
          return indexPath;
        }
      }
    }

    return null;
  }

  /**
   * Find package.json starting from a file
   * @param {string} fromFile - Starting file
   * @returns {Promise<string|null>} Package.json path
   */
  async findPackageJson(fromFile) {
    let currentDir = path.dirname(fromFile);
    const rootDir = this.workspaceRoot;

    while (currentDir !== rootDir && currentDir !== path.dirname(currentDir)) {
      const packageJsonPath = path.join(currentDir, 'package.json');
      if (fsSync.existsSync(packageJsonPath)) {
        return packageJsonPath;
      }
      currentDir = path.dirname(currentDir);
    }

    return null;
  }

  /**
   * Find tsconfig.json starting from a file
   * @param {string} fromFile - Starting file
   * @returns {Promise<string|null>} tsconfig.json path
   */
  async findTsConfig(fromFile) {
    let currentDir = path.dirname(fromFile);
    const rootDir = this.workspaceRoot;

    while (currentDir !== rootDir && currentDir !== path.dirname(currentDir)) {
      const tsConfigPath = path.join(currentDir, 'tsconfig.json');
      if (fsSync.existsSync(tsConfigPath)) {
        return tsConfigPath;
      }
      currentDir = path.dirname(currentDir);
    }

    return null;
  }

  /**
   * Load package.json with caching
   * @param {string} packageJsonPath - Path to package.json
   * @returns {Promise<object>} Package.json content
   */
  async loadPackageJson(packageJsonPath) {
    if (this.packageJsonCache.has(packageJsonPath)) {
      return this.packageJsonCache.get(packageJsonPath);
    }

    try {
      const content = await fs.readFile(packageJsonPath, 'utf8');
      const json = JSON.parse(content);
      this.packageJsonCache.set(packageJsonPath, json);
      return json;
    } catch (error) {
      return {};
    }
  }

  /**
   * Load tsconfig.json with caching
   * @param {string} tsConfigPath - Path to tsconfig.json
   * @returns {Promise<object>} tsconfig.json content
   */
  async loadTsConfig(tsConfigPath) {
    if (this.tsConfigCache.has(tsConfigPath)) {
      return this.tsConfigCache.get(tsConfigPath);
    }

    try {
      const content = await fs.readFile(tsConfigPath, 'utf8');
      // Remove comments (basic)
      const cleaned = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
      const json = JSON.parse(cleaned);
      this.tsConfigCache.set(tsConfigPath, json);
      return json;
    } catch (error) {
      return {};
    }
  }

  /**
   * Resolve in workspace (for monorepos)
   * @param {string} importPath - Import path
   * @param {string} workspacePath - Workspace path
   * @returns {Promise<string|null>} Resolved path
   */
  async resolveInWorkspace(importPath, workspacePath) {
    // Similar to node_modules resolution but in workspace
    const packagePath = path.join(workspacePath, importPath);
    return await this.tryExtensions(packagePath);
  }

  /**
   * Clear caches
   */
  clearCache() {
    this.cache.clear();
    this.packageJsonCache.clear();
    this.tsConfigCache.clear();
  }
}

module.exports = ImportResolver;
