const { v4: uuidv4 } = require('uuid');

class Queue {
  constructor() {
    this.entries = [];
    this.events = [];
    this.pendingPrompts = []; // Store pending prompts for linking
    this.cursor = new Date().toISOString();
  }

  // Add entry to queue
  addEntry(entry) {
    const entryWithId = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    // Try to link with pending prompt if this is a code change
    if (entry.source === 'filewatcher' && entry.before_code && entry.after_code) {
      const linkedPrompt = this.linkPendingPrompt(entryWithId);
      if (linkedPrompt) {
        entryWithId.prompt = linkedPrompt.text;
        entryWithId.prompt_timestamp = linkedPrompt.timestamp;
        console.log(`Linked prompt to code change: ${entryWithId.id}`);
      }
    }

    this.entries.push(entryWithId);
    console.log(`Added entry: ${entryWithId.id} (${entry.source})`);

    // Add corresponding event
    this.addEvent({
      type: 'entry_created',
      details: { entry_id: entryWithId.id, source: entry.source },
    });

    return entryWithId;
  }

  // Add event to queue
  addEvent(event) {
    const eventWithId = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      ...event,
    };

    this.events.push(eventWithId);
    console.log(`Added event: ${eventWithId.type}`);

    return eventWithId;
  }

  // Add pending prompt for linking
  addPendingPrompt(prompt) {
    const promptWithId = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      text: prompt,
      status: 'pending',
    };

    this.pendingPrompts.push(promptWithId);
    console.log(` Added pending prompt: ${promptWithId.id}`);

    // Keep only last 10 pending prompts to prevent memory issues
    if (this.pendingPrompts.length > 10) {
      this.pendingPrompts = this.pendingPrompts.slice(-10);
    }

    return promptWithId;
  }

  // Link pending prompt to entry
  linkPendingPrompt(entry) {
    if (this.pendingPrompts.length === 0) {
      return null;
    }

    // Find the most recent pending prompt
    const prompt = this.pendingPrompts.pop();
    prompt.status = 'linked';
    prompt.linked_entry_id = entry.id;

    console.log(`� Linked prompt ${prompt.id} to entry ${entry.id}`);
    return prompt;
  }

  // Get entries and events since cursor
  getSince(since) {
    const sinceDate = new Date(since);

    const filteredEntries = this.entries.filter((entry) => new Date(entry.timestamp) > sinceDate);

    const filteredEvents = this.events.filter((event) => new Date(event.timestamp) > sinceDate);

    return {
      entries: filteredEntries,
      events: filteredEvents,
      cursor: new Date().toISOString(),
    };
  }

  // Acknowledge processed cursor
  acknowledge(cursor) {
    this.cursor = cursor;
    console.log(`Acknowledged cursor: ${cursor}`);
  }

  // Get queue statistics
  getStats() {
    return {
      total_entries: this.entries.length,
      total_events: this.events.length,
      pending_prompts: this.pendingPrompts.length,
      cursor: this.cursor,
      oldest_entry: this.entries[0]?.timestamp,
      newest_entry: this.entries[this.entries.length - 1]?.timestamp,
    };
  }

  // Get all queue data
  getQueue() {
    return {
      entries: this.entries,
      events: this.events,
      pending_prompts: this.pendingPrompts,
      cursor: this.cursor,
    };
  }

  // Get pending prompts for debugging
  getPendingPrompts() {
    return this.pendingPrompts;
  }

  // Clear old data (keep last 1000 entries)
  cleanup() {
    if (this.entries.length > 1000) {
      this.entries = this.entries.slice(-1000);
    }
    if (this.events.length > 1000) {
      this.events = this.events.slice(-1000);
    }
  }
}

const queue = new Queue();
module.exports = { queue };
