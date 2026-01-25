import { describe, test, expect } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { runJsonRunner } from "./helpers/run-json-runner.ts";
import { isAccessTokenExpired, isRefreshTokenExpiringSoon } from "../src/token-manager.ts";

describe("token manager", () => {
  test("save and load tokens", async () => {
    const dir = resolve(tmpdir(), `hytale-tokens-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const now = Date.now();
    const tokens = {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: new Date(now + 3600 * 1000).toISOString(),
    };

    const output = await runJsonRunner("tests/helpers/token-manager-runner.ts", {
      DATA_DIR: dir,
      TOKEN_ACTION: "save",
      TOKENS_JSON: JSON.stringify(tokens),
    });

    expect(output).toMatchObject({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: tokens.expiresAt,
    });

    rmSync(dir, { recursive: true, force: true });
  });

  test("clear tokens", async () => {
    const dir = resolve(tmpdir(), `hytale-tokens-clear-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const tokens = {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    };

    await runJsonRunner("tests/helpers/token-manager-runner.ts", {
      DATA_DIR: dir,
      TOKEN_ACTION: "save",
      TOKENS_JSON: JSON.stringify(tokens),
    });

    const output = await runJsonRunner("tests/helpers/token-manager-runner.ts", {
      DATA_DIR: dir,
      TOKEN_ACTION: "clear",
    });

    expect(output).toBeNull();

    rmSync(dir, { recursive: true, force: true });
  });

  test("access token expiry checks", () => {
    const now = Date.now();
    expect(isAccessTokenExpired({ accessToken: "a", refreshToken: "r", expiresAt: "" })).toBe(true);
    expect(
      isAccessTokenExpired({
        accessToken: "a",
        refreshToken: "r",
        expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
      })
    ).toBe(false);
    expect(
      isAccessTokenExpired({
        accessToken: "a",
        refreshToken: "r",
        expiresAt: new Date(now - 10 * 60 * 1000).toISOString(),
      })
    ).toBe(true);
  });

  test("refresh token expiring soon", () => {
    const now = Date.now();
    const oldTokens = {
      accessToken: "a",
      refreshToken: "r",
      expiresAt: new Date(now + 3600 * 1000).toISOString(),
      refreshedAt: new Date(now - 25 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const freshTokens = {
      accessToken: "a",
      refreshToken: "r",
      expiresAt: new Date(now + 3600 * 1000).toISOString(),
      refreshedAt: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
    };

    expect(isRefreshTokenExpiringSoon(oldTokens)).toBe(true);
    expect(isRefreshTokenExpiringSoon(freshTokens)).toBe(false);
  });
});
