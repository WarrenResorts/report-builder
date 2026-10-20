import { describe, it, expect, vi, beforeEach } from "vitest";
import { NetSuiteClient, resolveAccountDomainId } from "./netsuite-client";
import { NetSuiteClientConfig, NetSuiteTBACredentials } from "./netsuite-types";

vi.mock("../utils/logger", () => ({
  createCorrelatedLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

const tbaCredentials: NetSuiteTBACredentials = {
  consumerKey: "consumer-key",
  consumerSecret: "consumer-secret",
  tokenId: "token-id",
  tokenSecret: "token-secret",
};

function buildResponse(overrides: Partial<Response> = {}): Response {
  return {
    ok: true,
    status: 204,
    headers: new Headers(),
    text: () => Promise.resolve(""),
    ...overrides,
  } as unknown as Response;
}

describe("resolveAccountDomainId", () => {
  it("lowercases and converts underscores to hyphens", () => {
    expect(resolveAccountDomainId("1234567_SB1")).toBe("1234567-sb1");
  });

  it("leaves an already-lowercase production account id unchanged", () => {
    expect(resolveAccountDomainId("1234567")).toBe("1234567");
  });
});

describe("NetSuiteClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let baseConfig: NetSuiteClientConfig;

  beforeEach(() => {
    fetchMock = vi.fn();
    baseConfig = {
      accountId: "1234567_SB1",
      authMethod: "tba",
      tbaCredentials,
      fetchFn: fetchMock as unknown as typeof fetch,
      retryConfig: { maxRetries: 2, baseDelay: 1, maxDelay: 5 },
    };
  });

  describe("construction", () => {
    it("throws when authMethod is 'tba' but no tbaCredentials are provided", () => {
      expect(
        () => new NetSuiteClient({ accountId: "1234567", authMethod: "tba" }),
      ).toThrow(/tbaCredentials/);
    });

    it("throws when authMethod is 'oauth2-jwt' but no oauth2Credentials are provided", () => {
      expect(
        () =>
          new NetSuiteClient({
            accountId: "1234567",
            authMethod: "oauth2-jwt",
          }),
      ).toThrow(/oauth2Credentials/);
    });

    it("derives the default base URL from the account id when not overridden", async () => {
      fetchMock.mockResolvedValue(buildResponse());
      const client = new NetSuiteClient({
        accountId: "1234567_SB1",
        authMethod: "tba",
        tbaCredentials,
        fetchFn: fetchMock as unknown as typeof fetch,
      });

      await client.postJournalEntry(
        {
          externalId: "WR2420260714",
          tranDate: "2026-07-14",
          subsidiary: { id: "26" },
          line: { items: [] },
        },
        "corr-1",
      );

      const [calledUrl] = fetchMock.mock.calls[0];
      expect(calledUrl).toBe(
        "https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/record/v1/journalentry/eid:WR2420260714",
      );
    });
  });

  describe("postJournalEntry", () => {
    it("returns success and extracts the internal id from the Location header on 2xx", async () => {
      fetchMock.mockResolvedValue(
        buildResponse({
          headers: new Headers({
            Location:
              "https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/record/v1/journalentry/98765",
          }),
        }),
      );

      const client = new NetSuiteClient(baseConfig);
      const result = await client.postJournalEntry(
        {
          externalId: "WR2420260714",
          tranDate: "2026-07-14",
          subsidiary: { id: "26" },
          line: { items: [] },
        },
        "corr-1",
      );

      expect(result).toEqual({
        success: true,
        externalId: "WR2420260714",
        recordType: "journalentry",
        netsuiteInternalId: "98765",
        statusCode: 204,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [, options] = fetchMock.mock.calls[0];
      expect(options.method).toBe("PUT");
      expect(options.headers.Authorization).toMatch(/^OAuth /);
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(JSON.parse(options.body)).toMatchObject({
        externalId: "WR2420260714",
      });
    });

    it("returns success without an internal id when the Location header doesn't end with a numeric id", async () => {
      fetchMock.mockResolvedValue(
        buildResponse({
          headers: new Headers({ Location: "https://example.com/not-an-id" }),
        }),
      );

      const client = new NetSuiteClient(baseConfig);
      const result = await client.postJournalEntry(
        {
          externalId: "WR2420260714",
          tranDate: "2026-07-14",
          subsidiary: { id: "26" },
          line: { items: [] },
        },
        "corr-1",
      );

      expect(result.success).toBe(true);
      expect(result.netsuiteInternalId).toBeUndefined();
    });

    it("returns success without an internal id when there is no Location header", async () => {
      fetchMock.mockResolvedValue(buildResponse());

      const client = new NetSuiteClient(baseConfig);
      const result = await client.postJournalEntry(
        {
          externalId: "WR2420260714",
          tranDate: "2026-07-14",
          subsidiary: { id: "26" },
          line: { items: [] },
        },
        "corr-1",
      );

      expect(result.success).toBe(true);
      expect(result.netsuiteInternalId).toBeUndefined();
    });

    it("returns a failure result (not throwing) for a non-retryable 4xx error", async () => {
      fetchMock.mockResolvedValue(
        buildResponse({
          ok: false,
          status: 400,
          text: () => Promise.resolve('{"error":"Invalid subsidiary"}'),
        }),
      );

      const client = new NetSuiteClient(baseConfig);
      const result = await client.postJournalEntry(
        {
          externalId: "WR2420260714",
          tranDate: "2026-07-14",
          subsidiary: { id: "26" },
          line: { items: [] },
        },
        "corr-1",
      );

      expect(result.success).toBe(false);
      expect(result.externalId).toBe("WR2420260714");
      expect(result.recordType).toBe("journalentry");
      expect(result.errorMessage).toContain("status 400");
      expect(result.errorMessage).toContain("Invalid subsidiary");
      // Non-retryable — fetch should only be called once.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("retries on a transient 503 and eventually succeeds", async () => {
      fetchMock
        .mockResolvedValueOnce(
          buildResponse({
            ok: false,
            status: 503,
            text: () => Promise.resolve(""),
          }),
        )
        .mockResolvedValueOnce(buildResponse());

      const client = new NetSuiteClient(baseConfig);
      const result = await client.postJournalEntry(
        {
          externalId: "WR2420260714",
          tranDate: "2026-07-14",
          subsidiary: { id: "26" },
          line: { items: [] },
        },
        "corr-1",
      );

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("returns failure after exhausting retries on a persistent 503", async () => {
      fetchMock.mockResolvedValue(
        buildResponse({
          ok: false,
          status: 503,
          text: () => Promise.resolve(""),
        }),
      );

      const client = new NetSuiteClient(baseConfig);
      const result = await client.postJournalEntry(
        {
          externalId: "WR2420260714",
          tranDate: "2026-07-14",
          subsidiary: { id: "26" },
          line: { items: [] },
        },
        "corr-1",
      );

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("status 503");
      // maxRetries: 2 -> initial attempt + 2 retries = 3 calls
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("handles an error response whose body cannot be read as text", async () => {
      fetchMock.mockResolvedValue(
        buildResponse({
          ok: false,
          status: 400,
          text: () => Promise.reject(new Error("body already consumed")),
        }),
      );

      const client = new NetSuiteClient(baseConfig);
      const result = await client.postJournalEntry(
        {
          externalId: "WR2420260714",
          tranDate: "2026-07-14",
          subsidiary: { id: "26" },
          line: { items: [] },
        },
        "corr-1",
      );

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("status 400");
    });
  });

  describe("postStatisticalJournalEntry", () => {
    it("PUTs to the statisticaljournalentry record type", async () => {
      fetchMock.mockResolvedValue(buildResponse());

      const client = new NetSuiteClient(baseConfig);
      const result = await client.postStatisticalJournalEntry(
        {
          externalId: "WRH2620260714",
          tranDate: "2026-07-14",
          subsidiary: { id: "26" },
          line: { items: [] },
        },
        "corr-1",
      );

      expect(result.success).toBe(true);
      expect(result.recordType).toBe("statisticaljournalentry");

      const [calledUrl] = fetchMock.mock.calls[0];
      expect(calledUrl).toContain(
        "/record/v1/statisticaljournalentry/eid:WRH2620260714",
      );
    });
  });

  describe("oauth2-jwt auth method end-to-end", () => {
    it("fetches a token and uses it to authorize the upsert request", async () => {
      const { generateKeyPairSync } = await import("crypto");
      const { privateKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
      });

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({ access_token: "abc123", expires_in: 3600 }),
        })
        .mockResolvedValueOnce(buildResponse());

      const client = new NetSuiteClient({
        accountId: "1234567",
        authMethod: "oauth2-jwt",
        oauth2Credentials: {
          clientId: "client-id",
          certificateId: "cert-id",
          privateKeyPem: privateKey.export({
            type: "pkcs1",
            format: "pem",
          }) as string,
        },
        fetchFn: fetchMock as unknown as typeof fetch,
        retryConfig: { maxRetries: 0 },
      });

      const result = await client.postJournalEntry(
        {
          externalId: "WR2420260714",
          tranDate: "2026-07-14",
          subsidiary: { id: "26" },
          line: { items: [] },
        },
        "corr-1",
      );

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const [, upsertOptions] = fetchMock.mock.calls[1];
      expect(upsertOptions.headers.Authorization).toBe("Bearer abc123");
    });
  });
});
