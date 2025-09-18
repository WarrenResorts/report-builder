/**
 * @fileoverview Output Generation Module
 * 
 * Exports all output generation utilities including CSV generation,
 * file formatting, and data export functionality.
 */

// CSV Generator
export { 
  CSVGenerator, 
  generateCSV, 
  generateMultipleCSVs 
} from './csv-generator';

// Types
export type {
  CSVGeneratorConfig,
  CSVGenerationStats,
  CSVGenerationResult,
} from './csv-generator';
