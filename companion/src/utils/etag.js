/**
 * ETag utility for HTTP caching
 * Generates ETags based on content hash for better cache validation
 */

const crypto = require('crypto');

/**
 * Generate ETag from content
 * @param {string|object} content - Content to hash
 * @param {boolean} weak - Use weak ETag (default: true for better cache hit rate)
 * @returns {string} ETag value
 */
function generateETag(content, weak = true) {
  const contentString = typeof content === 'string' ? content : JSON.stringify(content);

  const hash = crypto.createHash('md5').update(contentString).digest('hex').substring(0, 16); // Use first 16 chars for shorter ETags

  return weak ? `W/"${hash}"` : `"${hash}"`;
}

/**
 * Generate ETag from multiple values (for composite keys)
 * @param {...any} values - Values to combine for hash
 * @param {boolean} weak - Use weak ETag
 * @returns {string} ETag value
 */
function generateETagFromValues(weak = true, ...values) {
  const combined = values.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('|');

  return generateETag(combined, weak);
}

/**
 * Middleware to check If-None-Match header and return 304 if unchanged
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {string} etag - ETag to compare
 * @returns {boolean} True if 304 was sent (request handled)
 */
function checkETag(req, res, etag) {
  const ifNoneMatch = req.headers['if-none-match'];

  if (ifNoneMatch && ifNoneMatch === etag) {
    res.status(304).end(); // Not Modified
    return true;
  }

  res.set('ETag', etag);
  return false;
}

/**
 * Wrap a route handler to automatically handle ETags
 * @param {function} handler - Route handler function
 * @param {function} etagGenerator - Function to generate ETag from response data
 * @returns {function} Wrapped handler
 */
function withETag(handler, etagGenerator = null) {
  return async (req, res, next) => {
    try {
      const result = await handler(req, res, next);

      // If response already sent (e.g., by checkETag), skip
      if (res.headersSent) {
        return;
      }

      // Generate ETag
      const etag = etagGenerator ? etagGenerator(result) : generateETag(JSON.stringify(result));

      // Check If-None-Match
      if (checkETag(req, res, etag)) {
        return; // 304 sent
      }

      // Send response with ETag
      if (typeof result === 'object' && !res.headersSent) {
        res.json(result);
      }
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  generateETag,
  generateETagFromValues,
  checkETag,
  withETag,
};
