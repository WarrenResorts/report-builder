/**
 * @fileoverview Choice Hotels Mapping Loader
 *
 * Loads and parses the Choice Hotels → NetSuite GL mapping workbook from S3.
 * The mapping XLSX must be uploaded under the `choice/` prefix in the
 * mapping-files bucket so it does not conflict with other pipeline mappings.
 *
 * Sheet: "Choice"
 * Key columns:
 *   [1] Src Data Code  [2] Src Desc  [3] Multiplier  [4] Property Name
 *   [5] Glacct Code    [6] Glacct Name  [7] Acct Type
 *
 * Property Name is empty / null for global entries that apply to all properties.
 * Property-specific entries (e.g. cash-in-bank accounts) have the display name
 * of the property as it was registered in the workbook.
 *
 * Acct Type values: "Accounting" (JE) or "Statistical" (StatJE).
 */

import ExcelJS from "exceljs";
import { Readable } from "stream";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { createCorrelatedLogger } from "../utils/logger";
import { retryS3Operation } from "../utils/retry";

export const CHOICE_MAPPING_PREFIX = "choice/";
export const CHOICE_SHEET_NAME = "Choice";

/** Glacct Code value indicating the source code has no NetSuite mapping */
export const CHOICE_NOT_MAPPED = "Not Mapped";

/** Placeholder suffix in the RevPAR mapping key; replaced with the actual date */
export const REVPAR_DATE_PLACEHOLDER = "(Date)";

/**
 * A single row from the Choice mapping workbook.
 */
export interface ChoiceMappingEntry {
  /** Choice Hotels transaction code or Hotel-Statistics column header */
  srcDataCode: string;
  /** Human-readable description of the source */
  srcDesc: string;
  /** Amount multiplier (1 or -1). Credit card / payment codes use -1. */
  multiplier: number;
  /**
   * Display name of the property this entry applies to, e.g.
   * "Comfort Inn - Missoula".  Empty string means the entry is global
   * (applies to all Choice properties).
   */
  propertyName: string;
  /**
   * Full NetSuite GL account string: "<account>-<internalId>"
   * (e.g. "40110-634").  Value is CHOICE_NOT_MAPPED when unmapped.
   */
  glAcctCode: string;
  /** Human-readable account name */
  glAcctName: string;
  /** "Accounting" → JE, "Statistical" → StatJE */
  acctType: "Accounting" | "Statistical";
}

/**
 * Keyed by Src Data Code for O(1) lookup.
 * Each key maps to an array because a code may appear multiple times with
 * different property-name values (e.g. cash-in-bank entries per property).
 */
export type ChoiceMapping = Map<string, ChoiceMappingEntry[]>;

/**
 * Download and parse the most-recent Choice mapping XLSX from S3.
 *
 * @param s3Client - Authenticated S3 client
 * @param mappingBucket - Name of the mapping-files S3 bucket
 * @param correlationId - Correlation ID for logging
 * @returns Parsed Choice mapping, or null if no file found / parsing fails
 */
export async function loadChoiceMapping(
  s3Client: S3Client,
  mappingBucket: string,
  correlationId: string,
): Promise<ChoiceMapping | null> {
  const logger = createCorrelatedLogger(correlationId, {
    operation: "load_choice_mapping",
  });

  try {
    const listResult = await retryS3Operation(
      () =>
        s3Client.send(
          new ListObjectsV2Command({
            Bucket: mappingBucket,
            Prefix: CHOICE_MAPPING_PREFIX,
          }),
        ),
      correlationId,
      "list_choice_mapping_files",
      { maxRetries: 3, baseDelay: 1000 },
    );

    const mappingFiles = (listResult.Contents || [])
      .filter((obj) => obj.Key?.toLowerCase().endsWith(".xlsx"))
      .sort(
        (a, b) =>
          (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0),
      );

    if (mappingFiles.length === 0) {
      logger.warn("No Choice mapping XLSX found in S3", {
        bucket: mappingBucket,
        prefix: CHOICE_MAPPING_PREFIX,
      });
      return null;
    }

    const mappingKey = mappingFiles[0].Key!;
    logger.info("Loading Choice mapping file", {
      key: mappingKey,
      size: mappingFiles[0].Size,
    });

    const response = await retryS3Operation(
      () =>
        s3Client.send(
          new GetObjectCommand({ Bucket: mappingBucket, Key: mappingKey }),
        ),
      correlationId,
      "download_choice_mapping",
      { maxRetries: 3, baseDelay: 1000 },
    );

    if (!response.Body) {
      throw new Error(`No content for Choice mapping file: ${mappingKey}`);
    }

    const bytes = await response.Body.transformToByteArray();
    const buffer = Buffer.from(bytes);

    const mapping = await parseChoiceMappingWorkbook(buffer);

    const totalEntries = Array.from(mapping.values()).reduce(
      (sum, arr) => sum + arr.length,
      0,
    );
    logger.info("Choice mapping loaded successfully", {
      key: mappingKey,
      uniqueKeys: mapping.size,
      totalEntries,
    });

    return mapping;
  } catch (error) {
    logger.error("Failed to load Choice mapping", error as Error);
    return null;
  }
}

/**
 * Parse a Choice mapping XLSX buffer into a ChoiceMapping map.
 * Exposed separately so it can be called in tests without S3.
 */
export async function parseChoiceMappingWorkbook(
  buffer: Buffer,
): Promise<ChoiceMapping> {
  const workbook = new ExcelJS.Workbook();
  const stream = Readable.from(buffer);
  await workbook.xlsx.read(stream);

  const worksheet = workbook.getWorksheet(CHOICE_SHEET_NAME);
  if (!worksheet) {
    throw new Error(
      `Sheet "${CHOICE_SHEET_NAME}" not found in Choice mapping workbook`,
    );
  }

  const mapping: ChoiceMapping = new Map();

  // Row 1 is the header; data starts at row 2.
  // Column layout (1-based):
  //   [1] Src Data Code  [2] Src Desc  [3] Multiplier  [4] Property Name
  //   [5] Glacct Code    [6] Glacct Name  [7] Acct Type
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const srcDataCode = String(row.getCell(1).value ?? "").trim();
    if (!srcDataCode) return;

    const rawAcctType = String(row.getCell(7).value ?? "").trim();
    const acctType: ChoiceMappingEntry["acctType"] =
      rawAcctType === "Statistical" ? "Statistical" : "Accounting";

    const glAcctCode = String(row.getCell(5).value ?? "").trim();
    const rawPropertyName = row.getCell(4).value;
    const propertyName =
      rawPropertyName === null || rawPropertyName === undefined
        ? ""
        : String(rawPropertyName).trim();

    const entry: ChoiceMappingEntry = {
      srcDataCode,
      srcDesc: String(row.getCell(2).value ?? "").trim(),
      multiplier: Number(row.getCell(3).value ?? 1) || 1,
      propertyName,
      glAcctCode: glAcctCode || CHOICE_NOT_MAPPED,
      glAcctName: String(row.getCell(6).value ?? "").trim(),
      acctType,
    };

    const existing = mapping.get(srcDataCode);
    if (existing) {
      existing.push(entry);
    } else {
      mapping.set(srcDataCode, [entry]);
    }
  });

  return mapping;
}

/**
 * Find the best-matching mapping entry for a given source code and property.
 *
 * Priority:
 *   1. Entry with a matching property name
 *   2. Entry with an empty/global property name
 *   3. undefined (no mapping)
 *
 * @param mapping - Full Choice mapping
 * @param srcDataCode - Source transaction code or stat column header
 * @param propertyName - Display name of the property (as in the workbook)
 */
export function findChoiceMappingEntry(
  mapping: ChoiceMapping,
  srcDataCode: string,
  propertyName: string,
): ChoiceMappingEntry | undefined {
  const entries = mapping.get(srcDataCode);
  if (!entries || entries.length === 0) return undefined;

  return (
    entries.find((e) => e.propertyName === propertyName) ??
    entries.find((e) => !e.propertyName)
  );
}
