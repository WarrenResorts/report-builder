/**
 * @fileoverview Transformation Module Exports
 *
 * This module provides a centralized export point for all transformation-related
 * functionality in the report builder system.
 */

// Main transformation engine
export {
  TransformationEngine,
  transformFileData,
  transformMultipleFiles,
} from "./transformation-engine";

// Type exports
export type {
  RawFileData,
  TransformedData,
  TransformedRecord,
  TransformationError,
  TransformationConfig,
} from "./transformation-engine";
