/**
 * @fileoverview NetSuite Direct Import — Shared Types
 *
 * Type definitions for the NetSuite SuiteTalk REST integration (Phase 15,
 * see PROJECT_PLAN.md and docs/netsuite-direct-import-proposal.md).
 *
 * This module has no runtime dependency on the rest of the pipeline — it is
 * deliberately generic so it can be exercised against mocked HTTP responses
 * before we have real sandbox access.
 */

import { RetryConfig } from "../types/errors";

/**
 * Supported authentication strategies for NetSuite's SuiteTalk REST Web
 * Services. Which one is actually usable depends on what the hotels'
 * NetSuite admin configures on their account (see open questions in
 * docs/netsuite-direct-import-proposal.md) — both are implemented here so
 * that decision doesn't block this branch.
 *
 * - "tba": Token-Based Authentication — OAuth 1.0a request signing with a
 *   long-lived consumer key/secret + token id/secret pair.
 * - "oauth2-jwt": OAuth 2.0 Machine-to-Machine using a JWT bearer client
 *   assertion (RFC 7523), signed with an RS256 private key registered in
 *   NetSuite as a certificate.
 */
export type NetSuiteAuthMethod = "tba" | "oauth2-jwt";

/**
 * Credentials for Token-Based Authentication (OAuth 1.0a).
 */
export interface NetSuiteTBACredentials {
  consumerKey: string;
  consumerSecret: string;
  tokenId: string;
  tokenSecret: string;
}

/**
 * Credentials for the OAuth 2.0 JWT bearer (machine-to-machine) grant.
 */
export interface NetSuiteOAuth2Credentials {
  /** Consumer key / "iss" (issuer) claim registered for this integration record. */
  clientId: string;
  /** Certificate ID registered in NetSuite for the private key below. */
  certificateId: string;
  /** RS256 private key (PEM) matching the certificate registered in NetSuite. */
  privateKeyPem: string;
  /** OAuth scope(s) requested. Defaults to "restlets rest_webservices". */
  scope?: string;
}

/**
 * Configuration required to construct a {@link NetSuiteClient}.
 *
 * Intentionally does not know about SSM/Secrets Manager — credential
 * plumbing is out of scope for this branch (tracked as
 * `feature/netsuite-pipeline-integration`) and will construct this object
 * from whatever storage mechanism is chosen there.
 */
export interface NetSuiteClientConfig {
  /** NetSuite account ID, e.g. "1234567" or "1234567-sb1" for a sandbox account. */
  accountId: string;
  authMethod: NetSuiteAuthMethod;
  tbaCredentials?: NetSuiteTBACredentials;
  oauth2Credentials?: NetSuiteOAuth2Credentials;
  /**
   * Override for the REST/token base domain. Mainly for tests; defaults to
   * NetSuite's standard per-account REST domain when omitted.
   */
  baseUrl?: string;
  /** Override for the token endpoint base domain used by oauth2-jwt. Mainly for tests. */
  tokenBaseUrl?: string;
  /** Fetch implementation override, mainly for tests. */
  fetchFn?: typeof fetch;
  /**
   * Overrides for the shared retry.ts backoff config used when upserting
   * records. Defaults to DEFAULT_RETRY_CONFIG (3 retries, 1s base delay)
   * when omitted; mainly useful for tests that want fast retries.
   */
  retryConfig?: Partial<RetryConfig>;
}

/**
 * Result of attempting to upsert a single record in NetSuite.
 */
export interface NetSuitePostResult {
  success: boolean;
  externalId: string;
  recordType: string;
  netsuiteInternalId?: string;
  statusCode?: number;
  errorMessage?: string;
  /** Raw response body, retained for debugging/logging only. */
  raw?: unknown;
}

/**
 * One line of a NetSuite Journal Entry record.
 */
export interface NetSuiteJELinePayload {
  account: { id: string };
  debit?: number;
  credit?: number;
  memo?: string;
  department?: { id: string };
  location?: { id: string };
}

/**
 * NetSuite Journal Entry record payload, shaped to match SuiteTalk REST's
 * `journalentry` record body.
 */
export interface NetSuiteJournalEntryPayload {
  externalId: string;
  tranDate: string; // YYYY-MM-DD
  subsidiary: { id: string };
  memo?: string;
  line: { items: NetSuiteJELinePayload[] };
}

/**
 * One line of a NetSuite Statistical Journal Entry record.
 *
 * ⚠️ Best-effort field shape, NOT yet verified against a real NetSuite
 * account. Statistical Journal Entry availability via SuiteTalk REST is an
 * open question for the hotels' tier (see docs/netsuite-direct-import-proposal.md)
 * — the field names below follow SuiteScript's `statisticaljournalentry`
 * record type as documented, but must be confirmed once sandbox access is
 * available (`feature/netsuite-sandbox-verification`).
 */
export interface NetSuiteStatJELinePayload {
  account: { id: string };
  amount: number;
  unit?: string;
  department?: { id: string };
  location?: { id: string };
  memo?: string;
}

/**
 * NetSuite Statistical Journal Entry record payload.
 *
 * ⚠️ Best-effort shape — see {@link NetSuiteStatJELinePayload}.
 */
export interface NetSuiteStatisticalJournalEntryPayload {
  externalId: string;
  tranDate: string; // YYYY-MM-DD
  subsidiary: { id: string };
  memo?: string;
  line: { items: NetSuiteStatJELinePayload[] };
}
