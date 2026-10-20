/**
 * @fileoverview NetSuite Direct Import — API Client
 *
 * Thin SuiteTalk REST client responsible for authenticating and upserting
 * Journal Entry / Statistical Journal Entry records. Not yet wired into
 * `file-processor.ts` — that's `feature/netsuite-pipeline-integration`
 * (see PROJECT_PLAN.md Phase 15). This branch only needs the client to work
 * correctly against mocked HTTP responses.
 *
 * Design notes:
 * - One record is posted per property per day (never line-by-line), so a
 *   post either fully succeeds or fully fails — see
 *   docs/netsuite-direct-import-proposal.md.
 * - Idempotency relies on NetSuite's upsert-by-`externalId` REST semantics
 *   (`PUT /record/v1/{recordType}/eid:{externalId}`), reusing this
 *   project's existing retry.ts for transient-error backoff.
 */

import { createCorrelatedLogger, Logger } from "../utils/logger";
import { retryOperation } from "../utils/retry";
import {
  NetSuiteAuthProvider,
  OAuth2JwtAuthProvider,
  TokenBasedAuthProvider,
} from "./netsuite-auth";
import {
  NetSuiteClientConfig,
  NetSuiteJournalEntryPayload,
  NetSuitePostResult,
  NetSuiteStatisticalJournalEntryPayload,
} from "./netsuite-types";

const JOURNAL_ENTRY_RECORD_TYPE = "journalentry";
/**
 * ⚠️ Unverified record type name — see the warning on
 * `NetSuiteStatisticalJournalEntryPayload` in netsuite-types.ts. Statistical
 * Journal Entry availability (and its exact REST record type name) is an
 * open question for the hotels' NetSuite tier.
 */
const STATISTICAL_JOURNAL_ENTRY_RECORD_TYPE = "statisticaljournalentry";

/**
 * Resolves a NetSuite account ID into the subdomain segment SuiteTalk REST
 * uses, e.g. "1234567_SB1" -> "1234567-sb1".
 */
export function resolveAccountDomainId(accountId: string): string {
  return accountId.toLowerCase().replace(/_/g, "-");
}

export class NetSuiteClient {
  private readonly logger: Logger;
  private readonly authProvider: NetSuiteAuthProvider;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly config: NetSuiteClientConfig) {
    this.logger = createCorrelatedLogger("NetSuiteClient");
    this.fetchFn = config.fetchFn ?? fetch;

    const domainId = resolveAccountDomainId(config.accountId);
    this.baseUrl =
      config.baseUrl ??
      `https://${domainId}.suitetalk.api.netsuite.com/services/rest`;

    this.authProvider = this.buildAuthProvider(domainId);
  }

  private buildAuthProvider(domainId: string): NetSuiteAuthProvider {
    if (this.config.authMethod === "tba") {
      if (!this.config.tbaCredentials) {
        throw new Error(
          "NetSuiteClient configured with authMethod 'tba' but no tbaCredentials were provided",
        );
      }
      return new TokenBasedAuthProvider(
        this.config.accountId,
        this.config.tbaCredentials,
      );
    }

    if (!this.config.oauth2Credentials) {
      throw new Error(
        "NetSuiteClient configured with authMethod 'oauth2-jwt' but no oauth2Credentials were provided",
      );
    }

    const tokenUrl =
      this.config.tokenBaseUrl ??
      `https://${domainId}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;

    return new OAuth2JwtAuthProvider(
      this.config.oauth2Credentials,
      tokenUrl,
      this.fetchFn,
    );
  }

  /**
   * Upserts a Journal Entry record for a single property/day.
   */
  async postJournalEntry(
    payload: NetSuiteJournalEntryPayload,
    correlationId: string,
  ): Promise<NetSuitePostResult> {
    return this.upsertRecord(
      JOURNAL_ENTRY_RECORD_TYPE,
      payload.externalId,
      payload,
      correlationId,
    );
  }

  /**
   * Upserts a Statistical Journal Entry record for a single property/day.
   *
   * ⚠️ See the warning on `STATISTICAL_JOURNAL_ENTRY_RECORD_TYPE` above —
   * this record type/shape is unverified until sandbox access confirms it.
   */
  async postStatisticalJournalEntry(
    payload: NetSuiteStatisticalJournalEntryPayload,
    correlationId: string,
  ): Promise<NetSuitePostResult> {
    return this.upsertRecord(
      STATISTICAL_JOURNAL_ENTRY_RECORD_TYPE,
      payload.externalId,
      payload,
      correlationId,
    );
  }

  /**
   * Upserts a single record by `externalId`, retrying transient failures
   * via the shared `retryOperation` helper (network errors, timeouts,
   * 502/503/504) and surfacing non-retryable failures (validation errors,
   * auth failures, etc.) immediately.
   */
  private async upsertRecord(
    recordType: string,
    externalId: string,
    payload: unknown,
    correlationId: string,
  ): Promise<NetSuitePostResult> {
    const url = `${this.baseUrl}/record/v1/${recordType}/eid:${encodeURIComponent(externalId)}`;

    this.logger.info("Upserting NetSuite record", {
      correlationId,
      recordType,
      externalId,
      operation: "netsuite_upsert_start",
    });

    try {
      const result = await retryOperation(
        () => this.sendUpsertRequest(url, payload, recordType, externalId),
        correlationId,
        this.config.retryConfig,
      );

      this.logger.info("NetSuite record upserted successfully", {
        correlationId,
        recordType,
        externalId,
        netsuiteInternalId: result.netsuiteInternalId,
        operation: "netsuite_upsert_success",
      });

      return result;
    } catch (error) {
      const errorMessage = (error as Error).message;

      this.logger.error(
        "NetSuite record upsert failed after retries",
        error as Error,
        {
          correlationId,
          recordType,
          externalId,
          operation: "netsuite_upsert_failure",
        },
      );

      return {
        success: false,
        externalId,
        recordType,
        errorMessage,
      };
    }
  }

  private async sendUpsertRequest(
    url: string,
    payload: unknown,
    recordType: string,
    externalId: string,
  ): Promise<NetSuitePostResult> {
    const authHeader = await this.authProvider.getAuthHeader({
      method: "PUT",
      url,
    });

    const response = await this.fetchFn(url, {
      method: "PUT",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        Prefer: "transient",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");

      // Surface the HTTP status in the message so retry.ts's
      // isRetryableError can recognize 502/503/504 as transient; anything
      // else (4xx validation errors, 401/403 auth failures) is treated as
      // non-retryable and returned to the caller immediately.
      throw new Error(
        `NetSuite request failed with status ${response.status}: ${bodyText}`,
      );
    }

    const netsuiteInternalId = this.extractInternalId(response);

    return {
      success: true,
      externalId,
      recordType,
      netsuiteInternalId,
      statusCode: response.status,
    };
  }

  /**
   * NetSuite REST returns the created/updated record's internal ID in the
   * `Location` response header, e.g.
   * ".../record/v1/journalentry/12345" -> "12345".
   */
  private extractInternalId(response: Response): string | undefined {
    const location = response.headers.get("Location");
    if (!location) return undefined;

    const match = location.match(/\/(\d+)\/?$/);
    return match ? match[1] : undefined;
  }
}
