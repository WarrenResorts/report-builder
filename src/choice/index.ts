/**
 * @fileoverview Choice Hotels pipeline — public exports
 */

export {
  parseJournalSummary,
  parseAmount,
  parseCsvRow,
  type JournalSummaryData,
  type JournalSummaryTransaction,
} from "./choice-journal-summary-parser";

export {
  parseHotelStats,
  getRevParValue,
  REVPAR_HEADER_PREFIX,
  type HotelStatsData,
} from "./choice-hotel-stats-parser";

export {
  loadChoiceMapping,
  parseChoiceMappingWorkbook,
  findChoiceMappingEntry,
  CHOICE_MAPPING_PREFIX,
  CHOICE_NOT_MAPPED,
  REVPAR_DATE_PLACEHOLDER,
  type ChoiceMappingEntry,
  type ChoiceMapping,
} from "./choice-mapping-loader";

export {
  transformJournalSummaryToJERecords,
  transformHotelStatsToStatJERecords,
  parseStatAmount,
  buildRevParHeader,
} from "./choice-transformation";
