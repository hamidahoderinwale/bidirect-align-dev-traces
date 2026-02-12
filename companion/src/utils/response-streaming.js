/**
 * Response Streaming Utility
 * Provides utilities for streaming large responses progressively
 */

/**
 * Stream JSON array response
 * @param {object} res - Express response object
 * @param {array} items - Items to stream
 * @param {function} transform - Optional transform function for each item
 * @param {number} chunkSize - Number of items to send per chunk
 * @returns {Promise} Promise that resolves when streaming is complete
 */
async function streamJSONArray(res, items, transform = null, chunkSize = 10) {
  return new Promise((resolve, reject) => {
    try {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Transfer-Encoding', 'chunked');

      res.write('{"data":[');

      let first = true;
      let written = 0;

      const writeChunk = () => {
        const end = Math.min(written + chunkSize, items.length);

        for (let i = written; i < end; i++) {
          if (!first) res.write(',');

          const item = transform ? transform(items[i]) : items[i];
          res.write(JSON.stringify(item));

          first = false;
        }

        written = end;

        if (written < items.length) {
          // Flush and continue
          res.flushHeaders();
          setImmediate(writeChunk);
        } else {
          // Done
          res.write(']}');
          res.end();
          resolve();
        }
      };

      writeChunk();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Stream database query results
 * @param {object} res - Express response object
 * @param {function} queryFn - Function that returns a promise resolving to items
 * @param {function} transform - Optional transform function
 * @param {number} chunkSize - Items per chunk
 * @returns {Promise} Promise that resolves when streaming is complete
 */
async function streamQueryResults(res, queryFn, transform = null, chunkSize = 10) {
  try {
    const items = await queryFn();
    return streamJSONArray(res, items, transform, chunkSize);
  } catch (error) {
    res.status(500).json({ error: error.message });
    throw error;
  }
}

/**
 * Create a streaming endpoint handler
 * @param {function} queryFn - Function that returns items to stream
 * @param {function} transform - Optional transform function
 * @param {object} options - Options (chunkSize, etc.)
 * @returns {function} Express route handler
 */
function createStreamingHandler(queryFn, transform = null, options = {}) {
  const { chunkSize = 10 } = options;

  return async (req, res) => {
    try {
      const items = await queryFn(req);
      await streamJSONArray(res, items, transform, chunkSize);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
    }
  };
}

module.exports = {
  streamJSONArray,
  streamQueryResults,
  createStreamingHandler,
};
