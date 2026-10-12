import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type * as Esm from "../../dist/index.mjs";
import { BASE_URL, cannedFetch, pkg, SYSTEM_ONE_BODY } from "./helpers";

const require = createRequire(import.meta.url);
// The CJS build exposes the same API as the ESM build; borrow its types.
const sdk = require("../../dist/index.cjs") as typeof Esm;

describe("dist/index.cjs (CommonJS build)", () => {
  it("reports the package.json version", () => {
    expect(sdk.VERSION).toBe(pkg.version);
  });

  it("makes a round trip through the bundle", async () => {
    const { fetch } = cannedFetch(SYSTEM_ONE_BODY);
    const client = new sdk.TypeSafeClient({
      apiKey: "k",
      baseURL: BASE_URL,
      fetch,
      retry: { maxRetries: 0 },
    });
    const result = await client.systemOne({
      state: "hi",
      questions: { ok: sdk.noul("ok?"), tone: sdk.choice("tone?", { warm: null, cold: null }) },
    });
    expect(result.answers.tone.probabilities.warm).toBe(0.8);
  });

  it("resolves through the package.json exports map", () => {
    const exportsMap = pkg.exports["."] as { require: { default: string; types: string } };
    expect(exportsMap.require.default).toBe("./dist/index.cjs");
    expect(exportsMap.require.types).toBe("./dist/index.d.cts");
    expect(require.resolve("../../dist/index.cjs")).toMatch(/dist\/index\.cjs$/);
  });
});
