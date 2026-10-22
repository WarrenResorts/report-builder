/**
 * @fileoverview NetSuite direct import — public exports
 */

export {
  type NetSuiteAuthMethod,
  type NetSuiteTBACredentials,
  type NetSuiteOAuth2Credentials,
  type NetSuiteClientConfig,
  type NetSuitePostResult,
  type NetSuiteJELinePayload,
  type NetSuiteJournalEntryPayload,
  type NetSuiteStatJELinePayload,
  type NetSuiteStatisticalJournalEntryPayload,
} from "./netsuite-types";

export {
  type NetSuiteAuthRequest,
  type NetSuiteAuthProvider,
  TokenBasedAuthProvider,
  OAuth2JwtAuthProvider,
} from "./netsuite-auth";

export {
  type TransformedRecordInput,
  type TransformedDataInput,
  isStatisticalRecord,
  splitAccountCode,
  generateJEExternalId,
  generateStatJEExternalId,
  mapToJournalEntryPayload,
  mapToStatisticalJournalEntryPayload,
} from "./netsuite-mapper";

export { NetSuiteClient, resolveAccountDomainId } from "./netsuite-client";
