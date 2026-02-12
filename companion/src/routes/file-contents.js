/**
 * File contents API routes
 */

function createFileContentsRoutes(deps) {
  const { app, persistentDB } = deps;

  // Module-level cache
  let fileContentsCache = null;
  let fileContentsCacheTime = 0;
  const FILE_CONTENTS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  app.get('/api/file-contents', async (req, res) => {
    try {
      // Check cache first
      const now = Date.now();
      if (fileContentsCache && now - fileContentsCacheTime < FILE_CONTENTS_CACHE_TTL) {
        console.log('[CACHE] Serving file contents from cache');
        return res.json(fileContentsCache);
      }

      // Fetch all recent file changes (default 2000, configurable via ?limit=N)
      const limit = parseInt(req.query.limit) || 2000;
      console.log(`[FILE] Fetching file contents with limit ${limit}...`);

      if (typeof persistentDB.getFileContents !== 'function') {
        throw new Error('persistentDB.getFileContents is not a function');
      }

      const entries = await persistentDB.getFileContents(limit);
      console.log(`[FILE] Processing ${entries.length} files for semantic analysis...`);

      // Build file content map with latest content for each file
      const fileContents = new Map();
      const MAX_CONTENT_SIZE = 200000; // 200KB per file - enough for most code files

      entries.forEach((entry) => {
        const filePath = entry.file_path;
        const content = entry.after_code;

        if (!filePath || !content) return;

        // Skip very small files (likely metadata)
        if (content.length < 10) return;

        const fileName = filePath.split('/').pop();
        const ext = filePath.split('.').pop()?.toLowerCase();

        // Truncate content if too large (keep first 200KB - rare but prevents crashes)
        const truncatedContent =
          content.length > MAX_CONTENT_SIZE ? content.substring(0, MAX_CONTENT_SIZE) : content;

        // Create or update file entry (keep most recent version of each file)
        if (!fileContents.has(filePath)) {
          fileContents.set(filePath, {
            path: filePath,
            name: fileName,
            ext: ext,
            content: truncatedContent,
            lastModified: entry.timestamp,
            size: truncatedContent.length,
            truncated: content.length > MAX_CONTENT_SIZE,
          });
        } else {
          // Update if this entry is more recent
          const existing = fileContents.get(filePath);
          if (new Date(entry.timestamp) > new Date(existing.lastModified)) {
            existing.content = truncatedContent;
            existing.lastModified = entry.timestamp;
            existing.size = truncatedContent.length;
            existing.truncated = content.length > MAX_CONTENT_SIZE;
          }
        }
      });

      const result = Array.from(fileContents.values());
      const totalSize = result.reduce((sum, f) => sum + f.size, 0);
      const truncatedCount = result.filter((f) => f.truncated).length;

      console.log(
        `[FILE] Serving ${result.length} unique files with ${(totalSize / 1024 / 1024).toFixed(2)}MB content for TF-IDF analysis`
      );
      if (truncatedCount > 0) {
        console.log(
          `[FILE] ${truncatedCount} files truncated to ${MAX_CONTENT_SIZE / 1000}KB (originally larger)`
        );
      }

      const response = {
        files: result,
        totalFiles: result.length,
        totalSize: totalSize,
        cached: false,
        processedEntries: entries.length,
        truncatedFiles: truncatedCount,
        maxContentSize: MAX_CONTENT_SIZE,
      };

      // Cache the result
      fileContentsCache = response;
      fileContentsCacheTime = now;

      res.json(response);
    } catch (error) {
      console.error('Error fetching file contents:', error);
      // More detailed error for JSON serialization issues
      if (error.message && error.message.includes('Invalid string length')) {
        console.error(
          '[ERROR] Response too large to serialize - this should not happen with limits!'
        );
        res.status(500).json({ error: 'Response too large - contact support' });
      } else {
        res.status(500).json({ error: 'Failed to fetch file contents', details: error.message });
      }
    }
  });
}

module.exports = createFileContentsRoutes;
