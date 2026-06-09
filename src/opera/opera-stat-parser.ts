/**
 * @fileoverview Opera Stat DMY Segment Parser
 *
 * Parses the `stat_dmy_seg*.txt` file exported by Opera PMS.
 *
 * File structure (comma-separated, no quoting):
 *   Block 1 — Header row + market-segment rows (one per segment code)
 *             Relevant columns: GRP2_CODE, SUB_GRP_CODE_DESC, DESCRIPTION, ROOMS_DAY
 *   Block 2 — Second header row + single summary row
 *             Relevant summary columns: S_DAY_ROOMS (total occupied)
 *
 * The stat file does not contain the business date; that is always sourced from the
 * paired trial_balance file.
 */

/** A single market-segment row */
export interface StatSegment {
  /** Segment code (e.g. "D", "G", "K") */
  segmentCode: string;
  /** Human-readable description (e.g. "Discount - D") */
  description: string;
  /** Rooms occupied today for this segment */
  roomsDay: number;
}

/** Parsed stat_dmy_seg file */
export interface StatDmySegData {
  /** Total rooms occupied today (from summary block S_DAY_ROOMS) */
  totalRoomsOccupied: number;
  /** Individual market segment rows (includes zero-room segments) */
  segments: StatSegment[];
}

/**
 * Parse the raw text content of a `stat_dmy_seg*.txt` file.
 *
 * @param rawContent - UTF-8 text content of the file
 * @returns Parsed stat data
 */
export function parseStatDmySeg(rawContent: string): StatDmySegData {
  const lines = rawContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error("Stat file has no data rows");
  }

  const segments: StatSegment[] = [];
  let totalRoomsOccupied = 0;

  // Block 1: first header + segment rows
  const block1Header = splitRow(lines[0]);
  const idxGrp2Code = block1Header.indexOf("GRP2_CODE");
  const idxSubGrpDesc = block1Header.indexOf("SUB_GRP_CODE_DESC");
  const idxDescription = block1Header.indexOf("DESCRIPTION");
  const idxRoomsDay = block1Header.indexOf("ROOMS_DAY");

  // Block 2 starts at the row whose first column is "S_DAY_ROOMS"
  let block2StartIndex = -1;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("S_DAY_ROOMS")) {
      block2StartIndex = i;
      break;
    }

    const cols = splitRow(line);
    if (cols.length < 4) continue;

    // Segment code lives in GRP2_CODE column; rows without it are summary rows at top
    const segCode = idxGrp2Code !== -1 ? (cols[idxGrp2Code] ?? "").trim() : "";
    if (!segCode) continue;

    const desc =
      idxDescription !== -1
        ? (cols[idxDescription] ?? "").trim()
        : idxSubGrpDesc !== -1
          ? (cols[idxSubGrpDesc] ?? "").trim()
          : segCode;

    const roomsDay =
      idxRoomsDay !== -1
        ? parseFloat((cols[idxRoomsDay] ?? "0").replace(/,/g, "")) || 0
        : 0;

    segments.push({ segmentCode: segCode, description: desc, roomsDay });
  }

  // Block 2: summary header + single data row
  if (block2StartIndex !== -1 && block2StartIndex + 1 < lines.length) {
    const summaryHeaders = splitRow(lines[block2StartIndex]);
    const summaryValues = splitRow(lines[block2StartIndex + 1]);
    const idxSDayRooms = summaryHeaders.indexOf("S_DAY_ROOMS");
    if (idxSDayRooms !== -1 && summaryValues[idxSDayRooms] !== undefined) {
      totalRoomsOccupied =
        parseFloat((summaryValues[idxSDayRooms] ?? "0").replace(/,/g, "")) || 0;
    }
  }

  // Fallback: sum segment rooms if summary block was not found
  if (totalRoomsOccupied === 0 && segments.length > 0) {
    totalRoomsOccupied = segments.reduce((sum, s) => sum + s.roomsDay, 0);
  }

  return { totalRoomsOccupied, segments };
}

function splitRow(line: string): string[] {
  return line.split(",");
}
