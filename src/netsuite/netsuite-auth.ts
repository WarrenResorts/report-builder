/**
 * @fileoverview NetSuite Direct Import — Authentication Providers
 *
 * Implements request signing for the two auth strategies NetSuite's
 * SuiteTalk REST Web Services support. Which one the hotels' account
 * actually has configured is an open question (see
 * docs/netsuite-direct-import-proposal.md) — both are implemented so that
 * uncertainty doesn't block this branch.
 *
 * Deliberately uses only Node's built-in `crypto` module (no new npm
 * dependency) — this code will eventually run inside the `file-processor`
 * Lambda, and AGENTS.md documents a real failure mode where new
 * dependencies/overrides break CDK's `NodejsFunction` bundling in ways that
 * only surface at deploy time. Fewer dependencies here means one less thing
 * to verify against Lambda bundling later.
 */

import { createHmac, createSign, randomBytes } from "crypto";
import {
  NetSuiteOAuth2Credentials,
  NetSuiteTBACredentials,
} from "./netsuite-types";

/**
 * A single outbound request, described just enough for auth providers that
 * need the HTTP method + URL to compute a signature (TBA). Providers that
 * don't need per-request signing (OAuth2 bearer tokens) simply ignore it.
 */
export interface NetSuiteAuthRequest {
  method: string;
  url: string;
}

/**
 * Common interface both auth strategies implement.
 */
export interface NetSuiteAuthProvider {
  /**
   * Resolve the `Authorization` header value to send with a given request.
   */
  getAuthHeader(request: NetSuiteAuthRequest): Promise<string>;
}

const DEFAULT_OAUTH2_SCOPE = "restlets rest_webservices";
/** NetSuite requires short-lived JWT assertions; 5 minutes is the documented max. */
const JWT_ASSERTION_VALIDITY_SECONDS = 300;
/** Refresh the cached access token this many seconds before it actually expires. */
const TOKEN_REFRESH_BUFFER_SECONDS = 60;

/**
 * OAuth 1.0a request signing (NetSuite's "Token-Based Authentication").
 *
 * Produces an `Authorization: OAuth ...` header per NetSuite's TBA spec:
 * https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4247337262.html
 */
export class TokenBasedAuthProvider implements NetSuiteAuthProvider {
  constructor(
    private readonly accountId: string,
    private readonly credentials: NetSuiteTBACredentials,
  ) {}

  async getAuthHeader(request: NetSuiteAuthRequest): Promise<string> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString("hex");

    const oauthParams: Record<string, string> = {
      oauth_consumer_key: this.credentials.consumerKey,
      oauth_token: this.credentials.tokenId,
      oauth_signature_method: "HMAC-SHA256",
      oauth_timestamp: timestamp,
      oauth_nonce: nonce,
      oauth_version: "1.0",
    };

    const signature = this.buildSignature(request, oauthParams);

    const headerParams = {
      realm: this.accountId,
      ...oauthParams,
      oauth_signature: signature,
    };

    const headerValue = Object.entries(headerParams)
      .map(([key, value]) => `${key}="${percentEncode(value)}"`)
      .join(", ");

    return `OAuth ${headerValue}`;
  }

  /**
   * Builds the OAuth 1.0a signature base string and signs it with
   * HMAC-SHA256 using `consumerSecret&tokenSecret` as the key.
   */
  private buildSignature(
    request: NetSuiteAuthRequest,
    oauthParams: Record<string, string>,
  ): string {
    const url = new URL(request.url);
    const queryParams: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      queryParams[key] = value;
    });

    const allParams = { ...queryParams, ...oauthParams };
    const sortedKeys = Object.keys(allParams).sort();
    const paramString = sortedKeys
      .map((key) => `${percentEncode(key)}=${percentEncode(allParams[key])}`)
      .join("&");

    const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
    const baseString = [
      request.method.toUpperCase(),
      percentEncode(baseUrl),
      percentEncode(paramString),
    ].join("&");

    const signingKey = `${percentEncode(this.credentials.consumerSecret)}&${percentEncode(this.credentials.tokenSecret)}`;

    return createHmac("sha256", signingKey).update(baseString).digest("base64");
  }
}

/**
 * OAuth 2.0 machine-to-machine authentication using a JWT bearer client
 * assertion (RFC 7523), signed with an RS256 private key registered in
 * NetSuite as a certificate. NetSuite exchanges the signed assertion for a
 * short-lived access token via its token endpoint.
 *
 * https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1540391625.html
 */
export class OAuth2JwtAuthProvider implements NetSuiteAuthProvider {
  private cachedToken: { accessToken: string; expiresAtMs: number } | null =
    null;

  constructor(
    private readonly credentials: NetSuiteOAuth2Credentials,
    private readonly tokenUrl: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async getAuthHeader(): Promise<string> {
    const accessToken = await this.getAccessToken();
    return `Bearer ${accessToken}`;
  }

  /**
   * Returns a cached access token if it's still valid, otherwise requests a
   * new one from NetSuite's token endpoint.
   */
  private async getAccessToken(): Promise<string> {
    if (
      this.cachedToken &&
      this.cachedToken.expiresAtMs >
        Date.now() + TOKEN_REFRESH_BUFFER_SECONDS * 1000
    ) {
      return this.cachedToken.accessToken;
    }

    const assertion = this.buildJwtAssertion();

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion,
    });

    const response = await this.fetchFn(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => "");
      throw new Error(
        `NetSuite OAuth2 token request failed with status ${response.status}: ${responseText}`,
      );
    }

    const tokenResponse = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.cachedToken = {
      accessToken: tokenResponse.access_token,
      expiresAtMs: Date.now() + tokenResponse.expires_in * 1000,
    };

    return this.cachedToken.accessToken;
  }

  /**
   * Builds and signs the JWT bearer client assertion sent to NetSuite's
   * token endpoint in exchange for an access token.
   */
  private buildJwtAssertion(): string {
    const nowSeconds = Math.floor(Date.now() / 1000);

    const header = {
      alg: "RS256",
      typ: "JWT",
      // NetSuite requires the `kid` header to match the certificate ID
      // registered for this integration record.
      kid: this.credentials.certificateId,
    };

    const claims = {
      iss: this.credentials.clientId,
      scope: this.credentials.scope || DEFAULT_OAUTH2_SCOPE,
      aud: this.tokenUrl,
      exp: nowSeconds + JWT_ASSERTION_VALIDITY_SECONDS,
      iat: nowSeconds,
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedClaims = base64UrlEncode(JSON.stringify(claims));
    const signingInput = `${encodedHeader}.${encodedClaims}`;

    const signature = createSign("RSA-SHA256")
      .update(signingInput)
      .sign(this.credentials.privateKeyPem);

    const encodedSignature = base64UrlEncode(signature);

    return `${signingInput}.${encodedSignature}`;
  }
}

/**
 * Percent-encodes a string per RFC 3986 / OAuth 1.0a rules, which are
 * stricter than `encodeURIComponent` alone (it leaves `!*'()` unescaped).
 */
function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Base64url-encodes a string or Buffer per RFC 7515 (no padding, URL-safe
 * alphabet) — required for JWT header/payload/signature segments.
 */
function base64UrlEncode(input: string | Buffer): string {
  const base64 =
    typeof input === "string"
      ? Buffer.from(input, "utf8").toString("base64")
      : input.toString("base64");

  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
