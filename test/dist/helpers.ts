import { readFileSync } from "node:fs";

export const pkg: { name: string; version: string; exports: Record<string, unknown> } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);

export interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

/** Create a fetch mock that records calls and returns fixed JSON. */
export const cannedFetch = (
  body: unknown,
): { fetch: (url: string, init?: RequestInit) => Promise<Response>; calls: RecordedCall[] } => {
  const calls: RecordedCall[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json", "x-typesafe-request-id": "req_dist" },
    });
  };
  return { fetch, calls };
};

/** Fixed API root independent of `TYPESAFE_BASE_URL`. */
export const BASE_URL = "https://dist.test";

export const SYSTEM_ONE_BODY: Record<string, unknown> = {
  model: "jev-latest",
  answers: {
    ok: { type: "noul", noul: 0.9 },
    tone: {
      type: "choice",
      choice: "warm",
      confidence: 0.8,
      probabilities: { warm: 0.8, cold: 0.2 },
    },
  },
  usage: { input_tokens: 10, output_tokens: 2 },
};

/** Expected runtime exports; keep aligned with `src/index.ts`. */
export const EXPECTED_VALUE_EXPORTS: string[] = [
  "APIConnectionError",
  "APIError",
  "APIPromise",
  "APITimeoutError",
  "APIUserAbortError",
  "AuthenticationError",
  "BadRequestError",
  "ENV",
  "InternalServerError",
  "LOG_LEVELS",
  "NotFoundError",
  "PermissionDeniedError",
  "RankIncompleteError",
  "RankSeparationError",
  "RateLimitError",
  "TypeSafeClient",
  "TypeSafeError",
  "UnprocessableEntityError",
  "VERSION",
  "choice",
  "noul",
  "rank",
  "score",
].sort();
