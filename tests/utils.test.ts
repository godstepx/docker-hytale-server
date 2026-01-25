import { describe, test, expect } from "bun:test";
import { parseBoolEnvValue, parseNumberEnvValue, calculateBackoff } from "../src/utils.ts";

describe("utils", () => {
  test("parseBoolEnvValue", () => {
    expect(parseBoolEnvValue("true", "X")).toBe(true);
    expect(parseBoolEnvValue("1", "X")).toBe(true);
    expect(parseBoolEnvValue("yes", "X")).toBe(true);
    expect(parseBoolEnvValue("false", "X")).toBe(false);
    expect(parseBoolEnvValue("0", "X")).toBe(false);
    expect(parseBoolEnvValue("no", "X")).toBe(false);
    expect(parseBoolEnvValue("maybe", "X")).toBeNull();
  });

  test("parseNumberEnvValue", () => {
    expect(parseNumberEnvValue("42", "NUM")).toBe(42);
    expect(parseNumberEnvValue("3.5", "NUM")).toBe(3.5);
    expect(parseNumberEnvValue("nope", "NUM")).toBeNull();
  });

  test("calculateBackoff", () => {
    const originalRandom = Math.random;
    Math.random = () => 0.6;
    try {
      expect(calculateBackoff(1, 2)).toBe(5);
      expect(calculateBackoff(2, 2)).toBe(7);
    } finally {
      Math.random = originalRandom;
    }
  });
});
