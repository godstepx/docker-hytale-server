/**
 * Token Manager - OAuth2 Authentication for Hytale Server
 *
 * Handles:
 * 1. Device Authorization Flow (RFC 8628) for first-time setup
 * 2. OAuth token refresh using stored refresh tokens
 * 3. Game session creation for server startup
 * 4. Background OAuth token refresh for indefinite authentication
 *
 * Tokens are stored in AUTH_CACHE (default: /data/.auth)
 * After first auth, the server can restart without re-authorization
 * for up to 30 days (refresh token lifetime).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { logInfo, logWarn, logError, logDebug, logSeparator } from "./log-utils.ts";
import {
  AUTH_CACHE,
  HYTALE_SERVER_SESSION_TOKEN,
  HYTALE_SERVER_IDENTITY_TOKEN,
  HYTALE_OWNER_UUID,
  AUTO_AUTH_ON_START,
  OAUTH_REFRESH_CHECK_INTERVAL,
  OAUTH_REFRESH_THRESHOLD_DAYS,
  OAUTH_TOKEN_FILE,
} from "./config.ts";

// =============================================================================
// OAuth Configuration
// =============================================================================

const OAUTH_DEVICE_URL = "https://oauth.accounts.hytale.com/oauth2/device/auth";
const OAUTH_TOKEN_URL = "https://oauth.accounts.hytale.com/oauth2/token";
const PROFILES_URL = "https://account-data.hytale.com/my-account/get-profiles";
const SESSION_URL = "https://sessions.hytale.com/game-session/new";
const CLIENT_ID = "hytale-server";
const SCOPES = "openid offline auth:server";

// =============================================================================
// Types
// =============================================================================

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  refreshedAt?: string; // When tokens were last refreshed (for tracking refresh token age)
}

export interface SessionTokens {
  sessionToken: string;
  identityToken: string;
  profileUuid: string;
  expiresAt: string;
}

interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  error?: string;
}

interface ProfilesResponse {
  owner: string;
  profiles: Array<{
    uuid: string;
    username: string;
  }>;
}

interface GameSessionResponse {
  sessionToken: string;
  identityToken: string;
  expiresAt: string;
}

// =============================================================================
// Token Storage
// =============================================================================

/**
 * Load stored OAuth tokens from disk
 */
export function loadOAuthTokens(): OAuthTokens | null {
  if (!existsSync(OAUTH_TOKEN_FILE)) {
    return null;
  }

  try {
    const content = readFileSync(OAUTH_TOKEN_FILE, "utf-8");
    const data = JSON.parse(content);

    if (!data.refreshToken) {
      return null;
    }

    return {
      accessToken: data.accessToken || "",
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt || "",
      refreshedAt: data.refreshedAt,
    };
  } catch (error) {
    logWarn(`Failed to load OAuth tokens: ${error}`);
    return null;
  }
}

/**
 * Save OAuth tokens to disk
 */
export function saveOAuthTokens(tokens: OAuthTokens): void {
  mkdirSync(AUTH_CACHE, { recursive: true });

  const data = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    refreshedAt: new Date().toISOString(), // Track when we last refreshed
  };

  writeFileSync(OAUTH_TOKEN_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  logInfo("OAuth tokens saved");
}

/**
 * Check if OAuth access token is expired (with 60 second buffer)
 */
export function isAccessTokenExpired(tokens: OAuthTokens): boolean {
  if (!tokens.expiresAt) return true;

  try {
    const expiresAt = new Date(tokens.expiresAt).getTime();
    const now = Date.now();
    return expiresAt <= now + 60000; // 60 second buffer
  } catch {
    return true;
  }
}

/**
 * Check if refresh token is expiring soon (within threshold days)
 * Refresh tokens have 30-day TTL, we refresh when less than THRESHOLD days remain
 */
export function isRefreshTokenExpiringSoon(tokens: OAuthTokens): boolean {
  // Use refreshedAt to track when tokens were last refreshed
  // If not set (old token file), assume tokens are fresh (don't spam refresh on startup)
  if (!tokens.refreshedAt) {
    logDebug("No refreshedAt timestamp (old token file), assuming tokens are fresh");
    return false;
  }

  try {
    const refreshedAt = new Date(tokens.refreshedAt).getTime();
    const now = Date.now();
    const daysSinceRefresh = (now - refreshedAt) / (24 * 60 * 60 * 1000);

    // Refresh tokens last 30 days, refresh when (30 - threshold) days have passed
    const refreshAfterDays = 30 - OAUTH_REFRESH_THRESHOLD_DAYS; // e.g., 30 - 7 = 23 days

    if (daysSinceRefresh >= refreshAfterDays) {
      logDebug(`Tokens refreshed ${daysSinceRefresh.toFixed(1)} days ago, need refresh`);
      return true;
    }

    logDebug(`Tokens refreshed ${daysSinceRefresh.toFixed(1)} days ago, still valid`);
    return false;
  } catch {
    return false; // On error, don't spam refresh
  }
}

/**
 * Clear all stored tokens
 */
export function clearTokens(): void {
  try {
    if (existsSync(OAUTH_TOKEN_FILE)) {
      const { unlinkSync } = require("fs");
      unlinkSync(OAUTH_TOKEN_FILE);
    }
    logInfo("Tokens cleared");
  } catch (error) {
    logWarn(`Failed to clear tokens: ${error}`);
  }
}

// =============================================================================
// Device Authorization Flow (RFC 8628)
// =============================================================================

/**
 * Start device authorization flow
 */
export async function startDeviceAuth(): Promise<DeviceAuthResponse> {
  logInfo("Starting device authorization flow...");

  const response = await fetch(OAUTH_DEVICE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      scope: SCOPES,
    }),
  });

  if (!response.ok) {
    throw new Error(`Device auth failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as DeviceAuthResponse & { error?: string };

  if (data.error) {
    throw new Error(`Device auth failed: ${data.error}`);
  }

  return data;
}

/**
 * Poll for token after user authorizes
 */
export async function pollForToken(
  deviceCode: string,
  interval: number,
  expiresIn: number
): Promise<OAuthTokens> {
  const deadline = Date.now() + expiresIn * 1000;
  let pollInterval = interval * 1000;

  while (Date.now() < deadline) {
    await Bun.sleep(pollInterval);

    const response = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
      }),
    });

    const data = (await response.json()) as TokenResponse;

    switch (data.error) {
      case "authorization_pending":
        // User hasn't authorized yet, keep polling
        continue;

      case "slow_down":
        // Increase interval
        pollInterval += 5000;
        continue;

      case "expired_token":
        throw new Error("Device code expired");

      case "access_denied":
        throw new Error("User denied authorization");

      case undefined:
        // Success! We have tokens
        if (!data.access_token || !data.refresh_token) {
          throw new Error("Invalid token response");
        }

        const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

        const tokens: OAuthTokens = {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt,
        };

        saveOAuthTokens(tokens);
        logInfo("Authorization successful!");
        return tokens;

      default:
        throw new Error(`Token error: ${data.error}`);
    }
  }

  throw new Error("Device authorization timed out");
}

/**
 * Interactive device auth flow - displays URL and waits for user authorization
 */
export async function deviceAuthFlow(): Promise<OAuthTokens> {
  const deviceResponse = await startDeviceAuth();

  console.log("");
  logSeparator();
  logInfo("DEVICE AUTHORIZATION");
  logSeparator();
  logInfo(`Visit: ${deviceResponse.verification_uri}`);
  logInfo(`Enter code: ${deviceResponse.user_code}`);
  logInfo(`Or visit: ${deviceResponse.verification_uri_complete}`);
  logSeparator();
  logInfo(`Waiting for authorization (expires in ${deviceResponse.expires_in} seconds)...`);
  console.log("");

  return pollForToken(
    deviceResponse.device_code,
    deviceResponse.interval,
    deviceResponse.expires_in
  );
}

// =============================================================================
// OAuth Token Refresh
// =============================================================================

/**
 * Refresh OAuth tokens using refresh token
 */
export async function refreshOAuthTokens(): Promise<OAuthTokens> {
  logInfo("Refreshing OAuth tokens...");

  const stored = loadOAuthTokens();
  if (!stored?.refreshToken) {
    throw new Error("No refresh token available");
  }

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: stored.refreshToken,
    }),
  });

  const data = (await response.json()) as TokenResponse;

  if (data.error) {
    throw new Error(`Token refresh failed: ${data.error}`);
  }

  if (!data.access_token) {
    throw new Error("No access token in refresh response");
  }

  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  // Use new refresh token if provided, otherwise keep old one
  const tokens: OAuthTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || stored.refreshToken,
    expiresAt,
  };

  saveOAuthTokens(tokens);
  logInfo("OAuth tokens refreshed successfully");
  return tokens;
}

/**
 * Check if OAuth tokens need refresh and refresh if so
 * Returns true if tokens were refreshed
 */
export async function checkAndRefreshOAuth(): Promise<boolean> {
  const tokens = loadOAuthTokens();

  if (!tokens) {
    logDebug("No OAuth tokens to refresh");
    return false;
  }

  // Check if refresh token might be expiring soon
  // We refresh proactively to renew the refresh token's 30-day TTL
  if (isRefreshTokenExpiringSoon(tokens)) {
    logInfo("OAuth tokens expiring soon, refreshing...");
    try {
      await refreshOAuthTokens();
      return true;
    } catch (error) {
      logError(`Failed to refresh OAuth tokens: ${error}`);
      return false;
    }
  }

  logDebug("OAuth tokens still valid");
  return false;
}

// =============================================================================
// Game Session Management
// =============================================================================

/**
 * Get game profiles for authenticated account
 */
async function getGameProfiles(accessToken: string): Promise<ProfilesResponse> {
  const response = await fetch(PROFILES_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to get profiles: HTTP ${response.status}`);
  }

  return (await response.json()) as ProfilesResponse;
}

/**
 * Create game session for server
 */
export async function createGameSession(accessToken: string): Promise<SessionTokens> {
  logInfo("Fetching game profiles...");
  const profiles = await getGameProfiles(accessToken);

  const profile = profiles.profiles?.[0];
  if (!profile) {
    throw new Error("No game profiles found");
  }

  logInfo(`Found profile: ${profile.username} (${profile.uuid})`);

  logInfo("Creating game session...");
  const response = await fetch(SESSION_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ uuid: profile.uuid }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create game session: HTTP ${response.status} - ${text}`);
  }

  const session = (await response.json()) as GameSessionResponse;

  if (!session.sessionToken || !session.identityToken) {
    throw new Error("Invalid session response");
  }

  const tokens: SessionTokens = {
    sessionToken: session.sessionToken,
    identityToken: session.identityToken,
    profileUuid: profile.uuid,
    expiresAt: session.expiresAt,
  };

  logInfo(`Session created (expires: ${session.expiresAt})`);
  return tokens;
}

// =============================================================================
// Main Token Acquisition
// =============================================================================

/**
 * Acquire session tokens for server startup
 * Tries: env vars -> stored tokens -> device auth (if AUTO_AUTH_ON_START)
 */
export async function acquireSessionTokens(): Promise<SessionTokens | null> {
  // Check if tokens provided via environment (hosting providers)
  if (HYTALE_SERVER_SESSION_TOKEN) {
    logInfo("Using session tokens from environment variables");
    return {
      sessionToken: HYTALE_SERVER_SESSION_TOKEN,
      identityToken: HYTALE_SERVER_IDENTITY_TOKEN,
      profileUuid: HYTALE_OWNER_UUID,
      expiresAt: "", // Unknown - managed externally
    };
  }

  // Try to use stored OAuth tokens
  let oauthTokens = loadOAuthTokens();

  if (oauthTokens) {
    logInfo("Found stored OAuth credentials");

    // Refresh if access token expired
    if (isAccessTokenExpired(oauthTokens)) {
      logInfo("Access token expired, refreshing...");
      try {
        oauthTokens = await refreshOAuthTokens();
      } catch (error) {
        logError(`Token refresh failed: ${error}`);
        oauthTokens = null;
      }
    }

    // Create game session
    if (oauthTokens) {
      try {
        return await createGameSession(oauthTokens.accessToken);
      } catch (error) {
        logError(`Failed to create game session: ${error}`);
        // Token might be invalid, clear and try device auth
        oauthTokens = null;
      }
    }
  }

  // No valid tokens - try device auth if enabled
  if (AUTO_AUTH_ON_START) {
    logInfo("No valid tokens found - starting device authorization...");
    try {
      oauthTokens = await deviceAuthFlow();
      return await createGameSession(oauthTokens.accessToken);
    } catch (error) {
      logError(`Device authorization failed: ${error}`);
      return null;
    }
  }

  logWarn("No tokens available - server will start unauthenticated");
  logWarn("Use /auth login device in server console to authenticate");
  return null;
}

// =============================================================================
// Background OAuth Refresh Loop
// =============================================================================

let refreshLoopRunning = false;

/**
 * Start background OAuth refresh loop
 * Periodically checks and refreshes OAuth tokens to keep them alive
 */
export function startOAuthRefreshLoop(): void {
  if (refreshLoopRunning) {
    logWarn("OAuth refresh loop already running");
    return;
  }

  refreshLoopRunning = true;
  logInfo(
    `Starting background OAuth refresh (check every ${OAUTH_REFRESH_CHECK_INTERVAL / 1000 / 60 / 60}h)`
  );

  // Initial delay before first check
  setTimeout(async () => {
    while (refreshLoopRunning) {
      try {
        await checkAndRefreshOAuth();
      } catch (error) {
        logError(`Background OAuth refresh error: ${error}`);
      }

      // Wait for next check
      await Bun.sleep(OAUTH_REFRESH_CHECK_INTERVAL);
    }
  }, 60000); // Start checking after 1 minute
}

/**
 * Stop background OAuth refresh loop
 */
export function stopOAuthRefreshLoop(): void {
  refreshLoopRunning = false;
}
