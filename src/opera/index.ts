/**
 * @fileoverview Opera pipeline — public exports
 */

export {
  loadOperaMapping,
  parseOperaMappingWorkbook,
  OPERA_MAPPING_PREFIX,
  NOT_MAPPED,
  type OperaMappingEntry,
  type OperaMapping,
} from "./opera-mapping-loader";

export {
  parseTrialBalance,
  parseOperaDate,
  type TrialBalanceData,
  type TrialBalanceTransaction,
} from "./opera-trial-balance-parser";

export {
  parseStatDmySeg,
  type StatDmySegData,
  type StatSegment,
} from "./opera-stat-parser";

export {
  transformTrialBalanceToJERecords,
  transformStatDmySegToStatJERecords,
} from "./opera-transformation";
