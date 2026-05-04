/**
 * @fileoverview Opera Mapping Loader
 *
 * Loads and parses the Opera → NetSuite GL mapping workbook from S3.
 * The Opera mapping XLSX must be uploaded under the reserved `opera/` prefix in the
 * mapping-files bucket so it does not conflict with the Visual Matrix mapping.
 *
 * Sheet: "Opera"
 * Key columns: TRX_CODE (col 3), Glacct Code (col 14), Glacct Name (col 16),
 *              Multiplier (col 10), Xref Key (col 7), TRX_TYPE (col 4)
 */

import * as ExcelJS from "exceljs";
import { Readable } from "stream";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { createCorrelatedLogger } from "../utils/logger";
import { retryS3Operation } from "../utils/retry";

export const OPERA_MAPPING_PREFIX = "opera/";
export const OPERA_SHEET_NAME = "Opera";

/** Glacct Code value indicating the TRX_CODE has no NetSuite mapping */
export const NOT_MAPPED = "Not Mapped";

/**
 * A single row from the Opera mapping workbook.
 */
export interface OperaMappingEntry {
  /** Opera transaction code (join key from trial_balance TRX_CODE) */
  tRXCode: string;
  /** Opera description (for validation / disambiguation) */
  description: string;
  /** Transaction category: REVENUE | NON REVENUE | PAYMENT | INTERNAL | TrialBalance2 */
  tRXType: string;
  /**
   * Full NetSuite GL account string: "<account>-<internalId>" (e.g. "40110-634").
   * Value is "Not Mapped" when the TRX_CODE has no NetSuite mapping.
   */
  glAcctCode: string;
  /** Human-readable account name */
  glAcctName: string;
  /**
   * Amount multiplier (usually 1 or -1).
   * Payment codes have -1 so that negative TB_AMOUNT × -1 = positive debit.
   */
  multiplier: number;
  /**
   * Cross-reference key used to group related codes (e.g. "GstPMSMCV" groups
   * Visa + MasterCard so they are combined into a single JE line).
   */
  xRefKey: string;
}

/** Keyed by TRX_CODE for O(1) lookup */
export type OperaMapping = Map<string, OperaMappingEntry>;

/**
 * Download and parse the most-recent Opera mapping XLSX from S3.
 *
 * @param s3Client - Authenticated S3 client
 * @param mappingBucket - Name of the mapping-files S3 bucket
 * @param correlationId - Correlation ID for logging
 * @returns Parsed Opera mapping, or null if no file found or parsing fails
 */
export async function loadOperaMapping(
  s3Client: S3Client,
  mappingBucket: string,
  correlationId: string,
): Promise<OperaMapping | null> {
  const logger = createCorrelatedLogger(correlationId, {
    operation: "load_opera_mapping",
  });

  try {
    const listResult = await retryS3Operation(
      () =>
        s3Client.send(
          new ListObjectsV2Command({
            Bucket: mappingBucket,
            Prefix: OPERA_MAPPING_PREFIX,
          }),
        ),
      correlationId,
      "list_opera_mapping_files",
      { maxRetries: 3, baseDelay: 1000 },
    );

    const mappingFiles = (listResult.Contents || [])
      .filter((obj) => obj.Key?.toLowerCase().endsWith(".xlsx"))
      .sort(
        (a, b) =>
          (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0),
      );

    if (mappingFiles.length === 0) {
      logger.warn("No Opera mapping XLSX found in S3", {
        bucket: mappingBucket,
        prefix: OPERA_MAPPING_PREFIX,
      });
      return null;
    }

    const mappingKey = mappingFiles[0].Key!;
    logger.info("Loading Opera mapping file", {
      key: mappingKey,
      size: mappingFiles[0].Size,
    });

    const response = await retryS3Operation(
      () =>
        s3Client.send(
          new GetObjectCommand({ Bucket: mappingBucket, Key: mappingKey }),
        ),
      correlationId,
      "download_opera_mapping",
      { maxRetries: 3, baseDelay: 1000 },
    );

    if (!response.Body) {
      throw new Error(`No content for Opera mapping file: ${mappingKey}`);
    }

    const bytes = await response.Body.transformToByteArray();
    const buffer = Buffer.from(bytes);

    const mapping = await parseOperaMappingWorkbook(buffer);

    logger.info("Opera mapping loaded successfully", {
      key: mappingKey,
      totalEntries: mapping.size,
    });

    return mapping;
  } catch (error) {
    logger.error("Failed to load Opera mapping", error as Error);
    return null;
  }
}

/**
 * Parse an Opera mapping XLSX buffer into an OperaMapping map.
 * Exposed separately so it can be called in tests without S3.
 */
export async function parseOperaMappingWorkbook(
  buffer: Buffer,
): Promise<OperaMapping> {
  const workbook = new ExcelJS.Workbook();
  const stream = Readable.from(buffer);
  await workbook.xlsx.read(stream);

  const worksheet = workbook.getWorksheet(OPERA_SHEET_NAME);
  if (!worksheet) {
    throw new Error(
      `Sheet "${OPERA_SHEET_NAME}" not found in Opera mapping workbook`,
    );
  }

  const mapping: OperaMapping = new Map();

  // Row 1 is the header; data starts at row 2
  // Column indices (1-based, ExcelJS uses 1-based with a null at index 0):
  //   [1] Rec Id  [2] System  [3] TRX_CODE  [4] TRX_TYPE  [5] SUB_GRP_1
  //   [6] Descr   [7] Xref Key [8] Allow User Edit Flag  [9] Ignore Mapping
  //   [10] Multiplier  [11] Acct Id  [12] Property Id  [13] Property Name
  //   [14] Glacct Code  [15] Glacct Suffix  [16] Glacct Name  ...
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header

    const tRXCode = String(row.getCell(3).value ?? "").trim();
    if (!tRXCode) return;

    const glAcctCode = String(row.getCell(14).value ?? "").trim();
    const entry: OperaMappingEntry = {
      tRXCode,
      description: String(row.getCell(6).value ?? "").trim(),
      tRXType: String(row.getCell(4).value ?? "").trim(),
      glAcctCode: glAcctCode || NOT_MAPPED,
      glAcctName: String(row.getCell(16).value ?? "").trim(),
      multiplier: Number(row.getCell(10).value ?? 1) || 1,
      xRefKey: String(row.getCell(7).value ?? "").trim(),
    };

    // Only keep the first occurrence of each TRX_CODE (property-global rows)
    if (!mapping.has(tRXCode)) {
      mapping.set(tRXCode, entry);
    }
  });

  return mapping;
}
