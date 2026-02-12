/**
 * Status message API routes
 */

function createStatusRoutes(deps) {
  const { app, persistentDB } = deps;

  app.get('/api/status-messages', async (req, res) => {
    try {
      const {
        startTime = null,
        endTime = null,
        type = null,
        action = null,
        limit = parseInt(req.query.limit) || 100,
      } = req.query;

      // Validate timestamps are reasonable before processing
      const MIN_VALID_TIMESTAMP = 1577836800000; // 2020-01-01
      const MAX_VALID_TIMESTAMP = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000; // 10 years from now

      let parsedStartTime = startTime ? parseInt(startTime) : null;
      let parsedEndTime = endTime ? parseInt(endTime) : null;

      // Validate timestamp range
      if (parsedStartTime !== null) {
        if (
          isNaN(parsedStartTime) ||
          parsedStartTime < MIN_VALID_TIMESTAMP ||
          parsedStartTime > MAX_VALID_TIMESTAMP
        ) {
          return res.status(400).json({
            success: false,
            error:
              'Invalid startTime: timestamp out of valid range (2020-01-01 to 10 years from now)',
            received: startTime,
            parsed: parsedStartTime,
          });
        }
      }

      if (parsedEndTime !== null) {
        if (
          isNaN(parsedEndTime) ||
          parsedEndTime < MIN_VALID_TIMESTAMP ||
          parsedEndTime > MAX_VALID_TIMESTAMP
        ) {
          return res.status(400).json({
            success: false,
            error:
              'Invalid endTime: timestamp out of valid range (2020-01-01 to 10 years from now)',
            received: endTime,
            parsed: parsedEndTime,
          });
        }
      }

      // Validate time range is reasonable (not more than 1 year)
      if (parsedStartTime !== null && parsedEndTime !== null) {
        const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
        if (parsedEndTime - parsedStartTime > ONE_YEAR_MS) {
          return res.status(400).json({
            success: false,
            error: 'Time range too large: maximum 1 year allowed',
            range: parsedEndTime - parsedStartTime,
          });
        }
      }

      const options = {
        startTime: parsedStartTime,
        endTime: parsedEndTime,
        type: type || null,
        action: action || null,
        limit: Math.min(parseInt(limit) || 100, 1000), // Cap at 1000
      };

      const messages = await persistentDB.getStatusMessages(options);

      res.json({
        success: true,
        data: messages,
        count: messages.length,
        filters: options,
      });
    } catch (error) {
      console.error('Error getting status messages:', error);
      // Return 500 only for unexpected errors, not validation errors
      res.status(500).json({
        success: false,
        error: error.message,
        type: 'server_error',
      });
    }
  });
}

module.exports = createStatusRoutes;
