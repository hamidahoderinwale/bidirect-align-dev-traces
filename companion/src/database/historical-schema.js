/**
 * Historical Data Schema
 * Defines tables for mined historical data
 */

const HISTORICAL_TABLES = {
  historical_commits: `
    CREATE TABLE IF NOT EXISTS historical_commits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_path TEXT NOT NULL,
      commit_hash TEXT UNIQUE NOT NULL,
      author TEXT,
      author_email TEXT,
      date INTEGER,
      message TEXT,
      files_changed INTEGER DEFAULT 0,
      insertions INTEGER DEFAULT 0,
      deletions INTEGER DEFAULT 0,
      file_changes TEXT,
      parent_hashes TEXT,
      branch TEXT,
      mined_at INTEGER NOT NULL,
      UNIQUE(commit_hash, workspace_path)
    )
  `,

  historical_branches: `
    CREATE TABLE IF NOT EXISTS historical_branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_path TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      last_commit_date INTEGER,
      last_author TEXT,
      mined_at INTEGER NOT NULL,
      UNIQUE(workspace_path, branch_name)
    )
  `,

  historical_diffs: `
    CREATE TABLE IF NOT EXISTS historical_diffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      commit_hash TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      diff_content TEXT,
      mined_at INTEGER NOT NULL,
      UNIQUE(commit_hash, workspace_path)
    )
  `,

  historical_commands: `
    CREATE TABLE IF NOT EXISTS historical_commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      command TEXT NOT NULL,
      timestamp INTEGER,
      source_file TEXT NOT NULL,
      shell TEXT,
      line_number INTEGER,
      mined_at INTEGER NOT NULL
    )
  `,

  historical_prompts: `
    CREATE TABLE IF NOT EXISTS historical_prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_text TEXT NOT NULL,
      timestamp INTEGER,
      source TEXT DEFAULT 'log_mining',
      confidence REAL DEFAULT 0.5,
      context TEXT,
      log_file TEXT,
      line_number INTEGER,
      mined_at INTEGER NOT NULL
    )
  `,

  file_timestamps: `
    CREATE TABLE IF NOT EXISTS file_timestamps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT UNIQUE NOT NULL,
      size INTEGER,
      created_at INTEGER,
      modified_at INTEGER,
      accessed_at INTEGER,
      is_directory INTEGER DEFAULT 0,
      mined_at INTEGER NOT NULL
    )
  `,

  mining_runs: `
    CREATE TABLE IF NOT EXISTS mining_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_path TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      duration_ms INTEGER,
      git_commits INTEGER DEFAULT 0,
      shell_commands INTEGER DEFAULT 0,
      cursor_prompts INTEGER DEFAULT 0,
      file_timestamps INTEGER DEFAULT 0,
      errors TEXT,
      status TEXT DEFAULT 'in_progress'
    )
  `,
};

const HISTORICAL_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_historical_commits_workspace ON historical_commits(workspace_path)',
  'CREATE INDEX IF NOT EXISTS idx_historical_commits_date ON historical_commits(date)',
  'CREATE INDEX IF NOT EXISTS idx_historical_commits_author ON historical_commits(author)',
  'CREATE INDEX IF NOT EXISTS idx_historical_branches_workspace ON historical_branches(workspace_path)',
  'CREATE INDEX IF NOT EXISTS idx_historical_commands_timestamp ON historical_commands(timestamp)',
  'CREATE INDEX IF NOT EXISTS idx_historical_prompts_timestamp ON historical_prompts(timestamp)',
  'CREATE INDEX IF NOT EXISTS idx_file_timestamps_modified ON file_timestamps(modified_at)',
  'CREATE INDEX IF NOT EXISTS idx_mining_runs_workspace ON mining_runs(workspace_path)',
  'CREATE INDEX IF NOT EXISTS idx_mining_runs_started ON mining_runs(started_at)',
];

module.exports = {
  HISTORICAL_TABLES,
  HISTORICAL_INDEXES,
};
