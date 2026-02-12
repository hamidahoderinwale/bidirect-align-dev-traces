/**
 * Abstractions Module
 * Placeholder for abstraction rung services
 * 
 * This will contain:
 * - Raw representation
 * - Tokens representation
 * - Semantic edits representation
 * - Functions representation
 * - Module graph representation
 * - Files representation
 * - Dependencies representation
 * - Motifs representation
 */

// TODO: Move abstraction rung services here
// For now, these are in research/rung_extractors.py
// Should be ported to TypeScript or exposed via API

export interface AbstractionRung {
  name: string;
  level: number;
  description: string;
}

export const ABSTRACTION_RUNGS: AbstractionRung[] = [
  { name: 'raw', level: 0, description: 'Raw representation with code and prompts' },
  { name: 'tokens', level: 1, description: 'Token-level representation' },
  { name: 'semantic_edits', level: 2, description: 'Semantic edit operations' },
  { name: 'functions', level: 3, description: 'Function-level changes' },
  { name: 'module_graph', level: 4, description: 'Module/file-level relationships' },
  { name: 'files', level: 5, description: 'File action aggregation' },
  { name: 'dependencies', level: 6, description: 'Dependency relationships' },
  { name: 'motifs', level: 7, description: 'Workflow patterns' },
];



















