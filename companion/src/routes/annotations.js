/**
 * Annotation API routes
 * Handles event annotation, intent classification, and state summarization
 */

function createAnnotationRoutes(deps) {
  const { app, persistentDB } = deps;
  const EventAnnotationService = require('../services/event-annotation-service.js');
  const annotationService = new EventAnnotationService();

  /**
   * Annotate a single event
   */
  app.post('/api/annotations/event', async (req, res) => {
    try {
      const { event, context } = req.body;

      if (!event) {
        return res.status(400).json({
          success: false,
          error: 'Event object is required',
        });
      }

      const annotation = await annotationService.annotateEvent(event, context || {});

      // Update event in database if it has an ID
      if (event.id) {
        try {
          const existingEvent = await persistentDB.getEvent(event.id);
          if (existingEvent) {
            await persistentDB.saveEvent({
              ...existingEvent,
              annotation,
              ai_generated: true,
            });
          }
        } catch (dbError) {
          console.warn('[ANNOTATIONS] Could not update event in database:', dbError.message);
        }
      }

      res.json({
        success: true,
        annotation,
        eventId: event.id,
      });
    } catch (error) {
      console.error('[ANNOTATIONS] Error annotating event:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Batch annotate multiple events
   */
  app.post('/api/annotations/events/batch', async (req, res) => {
    try {
      const { events, context } = req.body;

      if (!events || !Array.isArray(events) || events.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Events array is required',
        });
      }

      const annotatedEvents = await annotationService.annotateEventsBatch(events, context || {});

      // Update events in database
      for (const event of annotatedEvents) {
        if (event.id && event.annotation) {
          try {
            const existingEvent = await persistentDB.getEvent(event.id);
            if (existingEvent) {
              await persistentDB.saveEvent({
                ...existingEvent,
                annotation: event.annotation,
                ai_generated: true,
              });
            }
          } catch (dbError) {
            // Continue with other events
            console.warn(`[ANNOTATIONS] Could not update event ${event.id}:`, dbError.message);
          }
        }
      }

      res.json({
        success: true,
        events: annotatedEvents,
        count: annotatedEvents.length,
      });
    } catch (error) {
      console.error('[ANNOTATIONS] Error batch annotating events:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Classify intent of a session/activity
   */
  app.post('/api/annotations/intent', async (req, res) => {
    try {
      const { events, context } = req.body;

      if (!events || !Array.isArray(events)) {
        return res.status(400).json({
          success: false,
          error: 'Events array is required',
        });
      }

      const classification = await annotationService.classifyIntent(events, context || {});

      res.json({
        success: true,
        classification,
      });
    } catch (error) {
      console.error('[ANNOTATIONS] Error classifying intent:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Generate state summary
   */
  app.post('/api/annotations/state-summary', async (req, res) => {
    try {
      const { events, fileChanges } = req.body;

      if (!events || !Array.isArray(events)) {
        return res.status(400).json({
          success: false,
          error: 'Events array is required',
        });
      }

      const summary = await annotationService.generateStateSummary(events, fileChanges || []);

      res.json({
        success: true,
        summary,
      });
    } catch (error) {
      console.error('[ANNOTATIONS] Error generating state summary:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get annotations for events
   */
  app.get('/api/annotations/events/:eventId', async (req, res) => {
    try {
      const { eventId } = req.params;
      const event = await persistentDB.getEvent(eventId);

      if (!event) {
        return res.status(404).json({
          success: false,
          error: 'Event not found',
        });
      }

      res.json({
        success: true,
        event: {
          id: event.id,
          annotation: event.annotation,
          intent: event.intent,
          tags: typeof event.tags === 'string' ? JSON.parse(event.tags || '[]') : event.tags || [],
          ai_generated: event.ai_generated === 1,
        },
      });
    } catch (error) {
      console.error('[ANNOTATIONS] Error getting event annotations:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Re-annotate events (force refresh)
   */
  app.post('/api/annotations/refresh', async (req, res) => {
    try {
      const { eventIds, sessionId } = req.body;

      let events = [];

      if (eventIds && Array.isArray(eventIds)) {
        // Get specific events
        events = await Promise.all(eventIds.map((id) => persistentDB.getEvent(id)));
        events = events.filter((e) => e);
      } else if (sessionId) {
        // Get all events for session
        events = await persistentDB.getEventsBySession(sessionId);
      } else {
        return res.status(400).json({
          success: false,
          error: 'Either eventIds array or sessionId is required',
        });
      }

      if (events.length === 0) {
        return res.json({
          success: true,
          annotated: 0,
          message: 'No events found',
        });
      }

      // Annotate events
      const annotatedEvents = await annotationService.annotateEventsBatch(events);

      // Update in database
      let updated = 0;
      for (const event of annotatedEvents) {
        if (event.annotation) {
          try {
            await persistentDB.saveEvent({
              ...event,
              annotation: event.annotation,
              ai_generated: true,
            });
            updated++;
          } catch (dbError) {
            console.warn(`[ANNOTATIONS] Could not update event ${event.id}:`, dbError.message);
          }
        }
      }

      res.json({
        success: true,
        annotated: updated,
        total: events.length,
      });
    } catch (error) {
      console.error('[ANNOTATIONS] Error refreshing annotations:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });
}

module.exports = createAnnotationRoutes;
