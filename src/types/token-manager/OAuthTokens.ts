export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  refreshedAt?: string;
}
