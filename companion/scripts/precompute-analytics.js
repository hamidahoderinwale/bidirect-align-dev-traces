#!/usr/bin/env node
/**
 * Precompute Analytics from companion_traces.jsonl
 * Uses streaming to handle very large files
 */

const fs = require('fs');
const path = require('path');

const JSONL_PATH = process.argv[2] || path.join(__dirname, '../../../../research/data/companion_traces.jsonl');
const OUTPUT_PATH = path.join(__dirname, '../data/precomputed-analytics.json');
const MAX_SESSIONS = parseInt(process.argv[3]) || 50000; // Limit for memory

// Ensure output directory exists
const outputDir = path.dirname(OUTPUT_PATH);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const stats = {
  totalSessions: 0,
  totalEvents: 0,
  totalPrompts: 0,
  totalEntries: 0,
  eventTypes: {},
  languageDistribution: {},
  modelDistribution: {},
  dailyActivity: {},
  workspaces: new Set(),
  topFiles: {},
  charsChanged: 0,
  linesAdded: 0,
  linesRemoved: 0,
};

const validLanguages = new Set([
  'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp',
  'cs', 'go', 'rb', 'php', 'swift', 'kt', 'rs', 'scala', 'r',
  'html', 'css', 'scss', 'sass', 'less', 'vue', 'svelte',
  'sql', 'sh', 'bash', 'zsh', 'json', 'md', 'yaml', 'yml', 'toml'
]);

function processSession(session) {
  stats.totalSessions++;
  
  if (session.workspace_path) {
    stats.workspaces.add(session.workspace_path);
  }

  // Process events
  for (const event of (session.events || [])) {
    stats.totalEvents++;
    const eventType = event.type || 'unknown';
    stats.eventTypes[eventType] = (stats.eventTypes[eventType] || 0) + 1;

    if (event.details) {
      stats.charsChanged += (event.details.chars_added || 0) + (event.details.chars_deleted || 0);
      stats.linesAdded += event.details.lines_added || 0;
      stats.linesRemoved += event.details.lines_removed || 0;

      if (event.details.file_path) {
        const filePath = event.details.file_path;
        stats.topFiles[filePath] = (stats.topFiles[filePath] || 0) + 1;
        
        const ext = filePath.split('.').pop()?.toLowerCase();
        if (ext && validLanguages.has(ext)) {
          stats.languageDistribution[ext] = (stats.languageDistribution[ext] || 0) + 1;
        }
      }
    }

    if (event.timestamp) {
      const dateKey = event.timestamp.split('T')[0];
      stats.dailyActivity[dateKey] = stats.dailyActivity[dateKey] || { prompts: 0, fileChanges: 0 };
      stats.dailyActivity[dateKey].fileChanges++;
    }
  }

  // Process prompts
  for (const prompt of (session.prompts || [])) {
    stats.totalPrompts++;
    
    const model = prompt.model_name || prompt.modelName || prompt.model;
    if (model && model !== 'unknown' && model !== 'Unknown') {
      stats.modelDistribution[model] = (stats.modelDistribution[model] || 0) + 1;
    }

    const ts = prompt.timestamp || prompt.created_at;
    if (ts) {
      const dateKey = ts.split('T')[0];
      stats.dailyActivity[dateKey] = stats.dailyActivity[dateKey] || { prompts: 0, fileChanges: 0 };
      stats.dailyActivity[dateKey].prompts++;
    }
  }

  // Process entries
  for (const entry of (session.entries || [])) {
    stats.totalEntries++;
    
    if (entry.file_path) {
      stats.topFiles[entry.file_path] = (stats.topFiles[entry.file_path] || 0) + 1;
      
      const ext = entry.file_path.split('.').pop()?.toLowerCase();
      if (ext && validLanguages.has(ext)) {
        stats.languageDistribution[ext] = (stats.languageDistribution[ext] || 0) + 1;
      }
    }
  }
}

async function precomputeAnalytics() {
  console.log(`Reading from: ${JSONL_PATH}`);
  console.log(`Max sessions: ${MAX_SESSIONS}`);
  
  if (!fs.existsSync(JSONL_PATH)) {
    console.error('JSONL file not found:', JSONL_PATH);
    process.exit(1);
  }

  const startTime = Date.now();
  
  // Use spawn to process file with shell streaming
  const { execSync } = require('child_process');
  
  // Read file line by line using shell
  let lineCount = 0;
  const chunkSize = 1000;
  
  for (let offset = 0; offset < MAX_SESSIONS; offset += chunkSize) {
    try {
      // Use sed to get specific line ranges
      const cmd = `sed -n '${offset + 1},${offset + chunkSize}p' "${JSONL_PATH}"`;
      const chunk = execSync(cmd, { 
        maxBuffer: 500 * 1024 * 1024, // 500MB buffer
        encoding: 'utf8'
      });
      
      const lines = chunk.split('\n').filter(l => l.trim());
      if (lines.length === 0) break;
      
      for (const line of lines) {
        try {
          const session = JSON.parse(line);
          processSession(session);
          lineCount++;
        } catch (e) {
          // Skip malformed lines
        }
      }
      
      if (lineCount % 5000 === 0) {
        console.log(`Processed ${lineCount} sessions...`);
      }
      
      if (lines.length < chunkSize) break;
    } catch (e) {
      console.error('Error reading chunk:', e.message);
      break;
    }
  }

  const endTime = Date.now();
  console.log(`\nProcessed ${stats.totalSessions} sessions in ${((endTime - startTime) / 1000).toFixed(2)}s`);

  // Build final analytics
  const sortedTopFiles = Object.entries(stats.topFiles)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50);

  const langTotal = Object.values(stats.languageDistribution).reduce((a, b) => a + b, 0) || 1;
  const sortedLanguages = Object.entries(stats.languageDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([language, count]) => ({
      language, count,
      percentage: (count / langTotal) * 100
    }));

  const sortedModels = Object.entries(stats.modelDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const activityOverTime = Object.entries(stats.dailyActivity)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-90)
    .map(([date, data]) => ({
      date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      prompts: data.prompts,
      fileChanges: data.fileChanges,
      interactions: data.prompts + data.fileChanges
    }));

  const modelTotal = Object.values(stats.modelDistribution).reduce((a, b) => a + b, 0);

  const precomputed = {
    computedAt: new Date().toISOString(),
    processingTimeMs: endTime - startTime,
    
    generalStats: {
      totalActions: stats.totalEvents + stats.totalPrompts,
      promptCount: stats.totalPrompts,
      fileChangeCount: stats.totalEvents,
      uniqueSessions: stats.totalSessions,
      avgActionsPerSession: stats.totalSessions > 0 
        ? (stats.totalEvents + stats.totalPrompts) / stats.totalSessions : 0,
      avgPromptsPerSession: stats.totalSessions > 0 
        ? stats.totalPrompts / stats.totalSessions : 0,
      avgEntriesPerSession: stats.totalSessions > 0 
        ? stats.totalEntries / stats.totalSessions : 0,
    },

    activityOverTime,
    topLanguages: sortedLanguages,
    
    topFiles: sortedTopFiles.map(([p, count]) => ({
      file: p.split('/').pop() || p,
      changes: count,
      lastModified: new Date().toLocaleDateString()
    })),

    productivity: {
      totalPrompts: stats.totalPrompts,
      avgFilesPerPrompt: 0,
      totalUniqueFiles: Object.keys(stats.topFiles).length,
    },

    contextUsage: { distribution: {}, avgFilesPerPrompt: 0 },
    systemResources: [],

    modelUsage: {
      distribution: stats.modelDistribution,
      totalWithModel: modelTotal,
      totalWithoutModel: stats.totalPrompts - modelTotal,
      percentageWithModel: stats.totalPrompts > 0 
        ? (modelTotal / stats.totalPrompts) * 100 : 0
    },

    actionTypeDistribution: Object.entries(stats.eventTypes)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count })),

    modelFamilyDistribution: sortedModels.map(([family, count]) => ({ family, count })),

    codeComplexity: {
      avgCharsChanged: stats.totalEvents > 0 ? stats.charsChanged / stats.totalEvents : 0,
      avgLinesChanged: stats.totalEvents > 0 ? (stats.linesAdded + stats.linesRemoved) / stats.totalEvents : 0,
      avgFilesTouched: 1,
      heavyDiffRatio: 0,
      sampleCount: stats.totalEntries,
    },

    contextTrend: [],

    headerStats: {
      workspaces: stats.workspaces.size,
      sessions: stats.totalSessions,
      fileChanges: stats.totalEvents,
      aiInteractions: stats.totalPrompts,
      codeChanged: `${(stats.charsChanged / 1024).toFixed(1)} KB`,
      avgContext: '0%',
      languages: sortedLanguages.slice(0, 3).map(l => l.language).join(', ') || '-',
      activeWorkspace: Array.from(stats.workspaces)[0]?.split('/').pop() || '-',
      activitiesToday: 0,
      topModels: sortedModels.slice(0, 3).map(([m]) => m).join(', ') || '-',
    }
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(precomputed, null, 2));
  console.log(`\nSaved to: ${OUTPUT_PATH}`);
  console.log(`Size: ${(fs.statSync(OUTPUT_PATH).size / 1024).toFixed(2)} KB`);
  
  console.log('\n=== Summary ===');
  console.log(`Sessions: ${stats.totalSessions.toLocaleString()}`);
  console.log(`Events: ${stats.totalEvents.toLocaleString()}`);
  console.log(`Prompts: ${stats.totalPrompts.toLocaleString()}`);
}

precomputeAnalytics().catch(console.error);
