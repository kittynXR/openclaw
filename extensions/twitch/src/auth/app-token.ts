/**
 * App access token manager for Twitch client credentials grant.
 *
 * Generates and auto-refreshes app access tokens used for conduit management
 * and EventSub subscriptions. These tokens are scoped to the application
 * (not a specific user) and authenticate via clientId + clientSecret.
 */

import type { ChannelLogSink } from "../types.js";

const TOKEN_URL = "https://id.twitch.tv/oauth2/token";

/** Buffer before expiry to trigger proactive refresh (5 minutes). */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

interface AppToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * Manages Twitch app access tokens via the client credentials grant flow.
 *
 * App tokens are used for server-to-server Twitch API calls that don't require
 * a user context, such as conduit management and EventSub subscription creation.
 */
export class AppTokenManager {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly logger: ChannelLogSink;
  private token: AppToken | null = null;

  constructor(opts: { clientId: string; clientSecret: string; logger: ChannelLogSink }) {
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.logger = opts.logger;
  }

  /**
   * Get a valid app access token, refreshing if needed.
   *
   * Automatically fetches a new token if the current one is expired or
   * about to expire within the refresh buffer window.
   */
  async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - REFRESH_BUFFER_MS) {
      return this.token.accessToken;
    }
    return await this.refresh();
  }

  /**
   * Force a token refresh via client credentials grant.
   */
  async refresh(): Promise<string> {
    this.logger.debug?.(`Requesting app access token via client credentials grant`);

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "client_credentials",
    });

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Failed to obtain app access token: ${res.status} ${text}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
      token_type: string;
    };
    const expiresAt = Date.now() + data.expires_in * 1000;

    this.token = { accessToken: data.access_token, expiresAt };
    this.logger.info(`App access token obtained (expires in ${data.expires_in}s)`);

    return data.access_token;
  }

  /** Invalidate the cached token. */
  invalidate(): void {
    this.token = null;
  }
}
