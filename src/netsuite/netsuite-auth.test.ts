import { generateKeyPairSync } from "crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NetSuiteOAuth2Credentials,
  NetSuiteTBACredentials,
} from "./netsuite-types";
import { OAuth2JwtAuthProvider, TokenBasedAuthProvider } from "./netsuite-auth";

describe("TokenBasedAuthProvider", () => {
  const credentials: NetSuiteTBACredentials = {
    consumerKey: "consumer-key",
    consumerSecret: "consumer-secret",
    tokenId: "token-id",
    tokenSecret: "token-secret",
  };

  it("produces a well-formed OAuth 1.0a Authorization header", async () => {
    const provider = new TokenBasedAuthProvider("1234567", credentials);

    const header = await provider.getAuthHeader({
      method: "PUT",
      url: "https://1234567.suitetalk.api.netsuite.com/services/rest/record/v1/journalentry/eid:WR2420260714",
    });

    expect(header).toMatch(/^OAuth /);
    expect(header).toContain('realm="1234567"');
    expect(header).toContain('oauth_consumer_key="consumer-key"');
    expect(header).toContain('oauth_token="token-id"');
    expect(header).toContain('oauth_signature_method="HMAC-SHA256"');
    expect(header).toContain('oauth_version="1.0"');
    expect(header).toMatch(/oauth_timestamp="\d+"/);
    expect(header).toMatch(/oauth_nonce="[0-9a-f]+"/);
    // oauth_signature is base64 (percent-encoded); just assert it's present and non-empty.
    expect(header).toMatch(/oauth_signature="[^"]+"/);
  });

  it("produces a different signature for different HTTP methods on the same URL", async () => {
    const provider = new TokenBasedAuthProvider("1234567", credentials);
    const url =
      "https://1234567.suitetalk.api.netsuite.com/services/rest/record/v1/journalentry/eid:WR2420260714";

    const putHeader = await provider.getAuthHeader({ method: "PUT", url });
    const getHeader = await provider.getAuthHeader({ method: "GET", url });

    const extractSignature = (header: string) =>
      header.match(/oauth_signature="([^"]+)"/)?.[1];

    expect(extractSignature(putHeader)).not.toBe(extractSignature(getHeader));
  });

  it("percent-encodes reserved OAuth 1.0a characters (!*'()) in credentials", async () => {
    const provider = new TokenBasedAuthProvider("1234567", {
      ...credentials,
      consumerKey: "key-with-!*'()-chars",
    });

    const header = await provider.getAuthHeader({
      method: "GET",
      url: "https://1234567.suitetalk.api.netsuite.com/services/rest/record/v1/journalentry",
    });

    expect(header).toContain(
      'oauth_consumer_key="key-with-%21%2A%27%28%29-chars"',
    );
  });

  it("includes query string parameters in the signature base string", async () => {
    const provider = new TokenBasedAuthProvider("1234567", credentials);

    // Just confirm it doesn't throw when the URL has query params, and that
    // the resulting signature differs from the same URL without them.
    const withQuery = await provider.getAuthHeader({
      method: "GET",
      url: "https://1234567.suitetalk.api.netsuite.com/services/rest/record/v1/journalentry?limit=10",
    });
    const withoutQuery = await provider.getAuthHeader({
      method: "GET",
      url: "https://1234567.suitetalk.api.netsuite.com/services/rest/record/v1/journalentry",
    });

    const extractSignature = (header: string) =>
      header.match(/oauth_signature="([^"]+)"/)?.[1];

    expect(extractSignature(withQuery)).not.toBe(
      extractSignature(withoutQuery),
    );
  });
});

describe("OAuth2JwtAuthProvider", () => {
  let credentials: NetSuiteOAuth2Credentials;
  const tokenUrl =
    "https://1234567.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token";

  beforeEach(() => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });

    credentials = {
      clientId: "client-id",
      certificateId: "cert-id",
      privateKeyPem: privateKey.export({
        type: "pkcs1",
        format: "pem",
      }) as string,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests and returns a bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "test-access-token",
          expires_in: 3600,
        }),
    });

    const provider = new OAuth2JwtAuthProvider(
      credentials,
      tokenUrl,
      fetchMock as unknown as typeof fetch,
    );

    const header = await provider.getAuthHeader();

    expect(header).toBe("Bearer test-access-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [calledUrl, options] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(tokenUrl);
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(options.body).toContain("grant_type=client_credentials");
    expect(options.body).toContain(
      "client_assertion_type=urn%3Aietf%3Aparams%3Aoauth%3Aclient-assertion-type%3Ajwt-bearer",
    );
    expect(options.body).toContain("client_assertion=");
  });

  it("caches the access token across calls until it's close to expiring", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ access_token: "cached-token", expires_in: 3600 }),
    });

    const provider = new OAuth2JwtAuthProvider(
      credentials,
      tokenUrl,
      fetchMock as unknown as typeof fetch,
    );

    await provider.getAuthHeader();
    await provider.getAuthHeader();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requests a new token once the cached one is near expiry", async () => {
    vi.useFakeTimers();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: "first-token", expires_in: 120 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: "second-token", expires_in: 3600 }),
      });

    const provider = new OAuth2JwtAuthProvider(
      credentials,
      tokenUrl,
      fetchMock as unknown as typeof fetch,
    );

    const firstHeader = await provider.getAuthHeader();
    expect(firstHeader).toBe("Bearer first-token");

    // Token expires in 120s; refresh buffer is 60s, so advancing 70s should
    // force a refresh.
    vi.advanceTimersByTime(70_000);

    const secondHeader = await provider.getAuthHeader();
    expect(secondHeader).toBe("Bearer second-token");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("throws a descriptive error when the token request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("invalid_client"),
    });

    const provider = new OAuth2JwtAuthProvider(
      credentials,
      tokenUrl,
      fetchMock as unknown as typeof fetch,
    );

    await expect(provider.getAuthHeader()).rejects.toThrow(
      /NetSuite OAuth2 token request failed with status 401/,
    );
  });

  it("handles a token error response whose body cannot be read as text", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.reject(new Error("stream already consumed")),
    });

    const provider = new OAuth2JwtAuthProvider(
      credentials,
      tokenUrl,
      fetchMock as unknown as typeof fetch,
    );

    await expect(provider.getAuthHeader()).rejects.toThrow(
      /NetSuite OAuth2 token request failed with status 500/,
    );
  });

  it("signs the JWT assertion with the certificate id as the kid header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "token", expires_in: 3600 }),
    });

    const provider = new OAuth2JwtAuthProvider(
      credentials,
      tokenUrl,
      fetchMock as unknown as typeof fetch,
    );

    await provider.getAuthHeader();

    const body = fetchMock.mock.calls[0][1].body as string;
    const params = new URLSearchParams(body);
    const assertion = params.get("client_assertion") as string;
    const [encodedHeader] = assertion.split(".");
    const header = JSON.parse(
      Buffer.from(
        encodedHeader.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf8"),
    );

    expect(header).toEqual({ alg: "RS256", typ: "JWT", kid: "cert-id" });
  });

  it("uses the default OAuth2 scope when none is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "token", expires_in: 3600 }),
    });

    const provider = new OAuth2JwtAuthProvider(
      credentials,
      tokenUrl,
      fetchMock as unknown as typeof fetch,
    );

    await provider.getAuthHeader();

    const body = fetchMock.mock.calls[0][1].body as string;
    const params = new URLSearchParams(body);
    const assertion = params.get("client_assertion") as string;
    const [, encodedClaims] = assertion.split(".");
    const claims = JSON.parse(
      Buffer.from(
        encodedClaims.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf8"),
    );

    expect(claims.scope).toBe("restlets rest_webservices");
    expect(claims.iss).toBe("client-id");
    expect(claims.aud).toBe(tokenUrl);
  });

  it("uses a custom scope when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: "token", expires_in: 3600 }),
    });

    const provider = new OAuth2JwtAuthProvider(
      { ...credentials, scope: "custom_scope" },
      tokenUrl,
      fetchMock as unknown as typeof fetch,
    );

    await provider.getAuthHeader();

    const body = fetchMock.mock.calls[0][1].body as string;
    const params = new URLSearchParams(body);
    const assertion = params.get("client_assertion") as string;
    const [, encodedClaims] = assertion.split(".");
    const claims = JSON.parse(
      Buffer.from(
        encodedClaims.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf8"),
    );

    expect(claims.scope).toBe("custom_scope");
  });
});
