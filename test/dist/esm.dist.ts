import { describe, expect, it } from "vitest";
import * as sdk from "../../dist/index.mjs";
import { BASE_URL, cannedFetch, pkg, SYSTEM_ONE_BODY } from "./helpers";

describe("dist/index.mjs (ESM build)", () => {
  it("reports the package.json version", () => {
    expect(sdk.VERSION).toBe(pkg.version);
  });

  it("makes a typed round trip through the bundle", async () => {
    const { fetch, calls } = cannedFetch(SYSTEM_ONE_BODY);
    const client = new sdk.TypeSafeClient({
      apiKey: "k",
      baseURL: BASE_URL,
      fetch,
      retry: { maxRetries: 0 },
    });
    const { data, requestId } = await client
      .systemOne({
        state: "hi",
        questions: { ok: sdk.noul("ok?"), tone: sdk.choice("tone?", { warm: null, cold: null }) },
      })
      .withResponse();

    expect(requestId).toBe("req_dist");
    expect(data.answers.ok.noul).toBe(0.9);
    expect(data.answers.tone.choice).toBe("warm");
    expect(calls[0]?.url).toBe(`${BASE_URL}/v1/systemone`);
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers["X-TypeSafe-SDK"]).toBe(`typesafe-sdk/${pkg.version}`);
  });

  it("throws the bundle's own error classes", async () => {
    const fetch = async () => new Response("{}", { status: 429, headers: { "retry-after": "1" } });
    const client = new sdk.TypeSafeClient({
      apiKey: "k",
      baseURL: BASE_URL,
      fetch,
      retry: { maxRetries: 0 },
    });
    const err = await client.models.list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(sdk.RateLimitError);
    expect(err).toBeInstanceOf(sdk.APIError);
    expect(err).toBeInstanceOf(sdk.TypeSafeError);
    expect((err as sdk.RateLimitError).retryAfterMs).toBe(1000);
  });

  it("does not pull in Node built-ins", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s+["']node:/);
    expect(source).not.toMatch(/require\(["']node:/);
  });
});
