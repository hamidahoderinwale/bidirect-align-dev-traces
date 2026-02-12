/**
 * Database repair service
 */

function createDbRepairService(deps) {
  const { persistentDB } = deps;

  async function repairDatabaseLinks() {
    try {
      console.log('[REPAIR] Starting database link repair...');

      const promptsWithLinks = await persistentDB.getPromptsWithLinkedEntries();
      let repairedCount = 0;
      let skippedCount = 0;
      let notFoundCount = 0;

      for (const prompt of promptsWithLinks) {
        const linkedEntryId = prompt.linked_entry_id || prompt.linkedEntryId;
        if (!linkedEntryId) {
          skippedCount++;
          continue;
        }

        let entry = await persistentDB.getEntryById(linkedEntryId);

        if (!entry) {
          let promptTime;
          if (typeof prompt.timestamp === 'number') {
            promptTime = prompt.timestamp;
          } else if (typeof prompt.timestamp === 'string') {
            promptTime = new Date(prompt.timestamp).getTime();
          } else {
            notFoundCount++;
            continue;
          }

          if (isNaN(promptTime) || !isFinite(promptTime)) {
            notFoundCount++;
            continue;
          }

          const fiveMinutesAgo = promptTime - 5 * 60 * 1000;
          const fiveMinutesAfter = promptTime + 5 * 60 * 1000;

          const nearbyEntries = await persistentDB.getEntriesInTimeRange(
            new Date(fiveMinutesAgo).toISOString(),
            new Date(fiveMinutesAfter).toISOString(),
            prompt.workspace_path || prompt.workspacePath
          );

          entry = nearbyEntries
            .filter((e) => !e.prompt_id)
            .sort((a, b) => {
              const aTime = new Date(a.timestamp).getTime();
              const bTime = new Date(b.timestamp).getTime();
              return Math.abs(aTime - promptTime) - Math.abs(bTime - promptTime);
            })[0];
        }

        if (!entry) {
          notFoundCount++;
          continue;
        }

        if (entry.prompt_id) {
          skippedCount++;
          continue;
        }

        try {
          await persistentDB.updateEntry(entry.id, {
            prompt_id: prompt.id,
          });
          repairedCount++;
          console.log(`[REPAIR] Fixed entry ${entry.id} -> prompt ${prompt.id}`);
        } catch (updateError) {
          console.error(`[REPAIR] Error updating entry ${entry.id}:`, updateError.message);
        }
      }

      console.log(
        `[REPAIR] Completed: Fixed ${repairedCount} entries, skipped ${skippedCount}, not found ${notFoundCount}`
      );
      return {
        repaired: repairedCount,
        total: promptsWithLinks.length,
        skipped: skippedCount,
        notFound: notFoundCount,
      };
    } catch (error) {
      console.error('[REPAIR] Error repairing links:', error);
      return { repaired: 0, error: error.message };
    }
  }

  return {
    repairDatabaseLinks,
  };
}

module.exports = createDbRepairService;
