/** A JSON-compatible value. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Text, a JSON object or array, or `null` for state, instructions, and criteria. */
export type EntryType = string | { [key: string]: JsonValue } | JsonValue[] | null;

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

/** A criterion description; `null` leaves the label undescribed. */
export type Description = EntryType;

/** A yes/no question with optional descriptions for either outcome. */
export interface NoulQuestion {
  type: "noul";
  /** The question as text, a JSON object, or an array; optional or `null`. */
  instructions?: EntryType;
  /** Optional descriptions of the yes and no outcomes. */
  criteria?: {
    /** Description of the yes outcome. */
    true?: EntryType;
    /** Description of the no outcome. */
    false?: EntryType;
  } | null;
}

/** Labels mapped to descriptions, or `null` for undescribed labels. */
export type ChoiceCriteria = {
  [label: string]: Description;
};

/** A question that selects between named alternatives. */
export interface ChoiceQuestion<T extends ChoiceCriteria = ChoiceCriteria> {
  type: "choice";
  /** The question as text, a JSON object, or an array; optional or `null`. */
  instructions?: EntryType;
  /** Descriptions of the available outcomes. */
  criteria: T;
}

/** At least two descriptions indexed by score from zero; `null` leaves a score undescribed. */
export type ScoreCriteria = readonly [EntryType, EntryType, ...EntryType[]];

/** A question that assigns a score using an ordered rubric. */
export interface ScoreQuestion<T extends ScoreCriteria = ScoreCriteria> {
  type: "score";
  /** The question as text, a JSON object, or an array; optional or `null`. */
  instructions?: EntryType;
  /** Descriptions of the available outcomes. */
  criteria: T;
}

/**
 * A question that orders named items by pairwise Choice duels fitted with Bradley–Terry.
 *
 * The client expands it into duels before sending; it never reaches the API as its own type.
 */
export interface RankQuestion<T extends ChoiceCriteria = ChoiceCriteria> {
  type: "rank";
  /** What makes one item better than another, as text, a JSON object, or an array; required. */
  instructions: Exclude<EntryType, null>;
  /** The items to order: 2 to 255 labels mapped to descriptions; labels must not be integers. */
  criteria: T;
  /** Pairs to play: omitted or `null` plays every pair at once; otherwise an integer from n−1 to n(n−1)/2. */
  max_duels?: number | null;
}

/** A question identified by its `type` field. */
export type Question = NoulQuestion | ScoreQuestion | ChoiceQuestion | RankQuestion;

/** A question type the API answers directly. */
export type WireQuestion = NoulQuestion | ScoreQuestion | ChoiceQuestion;

/** Questions keyed by the names used to identify their answers. */
export interface Questions {
  [name: string]: Question;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** A yes/no answer. */
export interface NoulResponse {
  readonly type: "noul";
  /** Probability of a yes answer, from zero to one. */
  readonly noul: number;
}

/** A selected label and its probabilities. */
export interface ChoiceResponse<T extends ChoiceCriteria = ChoiceCriteria> {
  readonly type: "choice";
  /** The selected label. */
  readonly choice: keyof T & string;
  /** Reported confidence in the selected label. */
  readonly confidence: number;
  /** Probabilities keyed by label. */
  readonly probabilities: {
    readonly [label in keyof T]: number;
  };
}

/** Score keys inferred from the rubric; a fixed-length tuple yields its indices, otherwise `number`. */
export type ScoreOf<T extends ScoreCriteria> = number extends T["length"]
  ? number
  : Extract<keyof T, `${number}`>;

/** Rubric descriptions keyed by score. */
export type ScoreLegend<T extends ScoreCriteria> = {
  readonly [score in ScoreOf<T>]: T[score];
};

/** An expected score with its rubric and probabilities. */
export interface ScoreResponse<T extends ScoreCriteria = ScoreCriteria> {
  readonly type: "score";
  /** Expected score, which may fall between integer rubric levels. */
  readonly score: number;
  /** Reported confidence in the score. */
  readonly confidence: number;
  /** Rubric descriptions keyed by score. */
  readonly legend: ScoreLegend<T>;
  /** Probabilities keyed by score. */
  readonly probabilities: {
    readonly [score in ScoreOf<T>]: number;
  };
}

/** A ranked item and its Luce odds against the winner, from zero to one. */
export interface RankItem<T extends ChoiceCriteria = ChoiceCriteria> {
  /** The item's label. */
  readonly label: keyof T & string;
  /** Strength relative to the winner; the winner scores 1 and P(beats the winner) = score / (1 + score). */
  readonly score: number;
}

/** One compared pair of a RankResponse, in the order the pairs were played. */
export interface RankDuelOutcome<T extends ChoiceCriteria = ChoiceCriteria> {
  /** The label of the pair's item that came first in the Rank's criteria. */
  readonly first: keyof T & string;
  /** The label of the pair's other item. */
  readonly second: keyof T & string;
  /** Recorded probability that `first` beats `second`, averaged over both option orders. */
  readonly first_wins: number;
  /** This pair's 1 − |P(first wins | first listed first) − P(first wins | second listed first)|. */
  readonly position_consistency: number;
}

/** An order over items fitted from pairwise duels. */
export interface RankResponse<T extends ChoiceCriteria = ChoiceCriteria> {
  readonly type: "rank";
  /** Every item, best first; ties keep input order. */
  readonly ranking: readonly RankItem<T>[];
  /** Number of pairs played, each asked in both option orders. */
  readonly duels: number;
  /** Mean over pairs of 1 − |P(a wins | a first) − P(a wins | b first)|. */
  readonly position_consistency: number;
  /** Every compared pair in the order played, with its recorded outcome and position consistency. */
  readonly duel_outcomes: readonly RankDuelOutcome<T>[];
}

/** The answer type for a question, preserving its criteria keys. */
export type ResultFor<T extends Question> = T extends NoulQuestion
  ? NoulResponse
  : T extends ScoreQuestion<infer S>
    ? ScoreResponse<S>
    : T extends ChoiceQuestion<infer E>
      ? ChoiceResponse<E>
      : T extends RankQuestion<infer R>
        ? RankResponse<R>
        : never;

/** Token usage for a request, summed over every request a Rank question needed. */
export interface Usage {
  /** Number of input tokens used. */
  readonly input_tokens: number;
  /** Number of output tokens used. */
  readonly output_tokens: number;
}

/** Answers keyed by question name, with model and usage metadata. */
export interface SystemOneResult<Q extends Questions> {
  /** The model used to answer the request. */
  readonly model: string;
  /** Answers with types inferred from the supplied questions. */
  readonly answers: { readonly [K in keyof Q]: ResultFor<Q[K]> };
  /** Token usage for the request, or summed over all requests when Rank questions need several. */
  readonly usage: Usage;
}

/** Metadata for an available model. */
export interface ModelCard {
  readonly name: string;
  readonly description: string;
  readonly release_date: string;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * State and named questions for `systemOne`.
 *
 * Additional properties on a request variable are forwarded, including `null` values.
 */
export interface SystemOneRequest<Q extends Questions = Questions> {
  /** Text, a JSON object or array, or `null` to evaluate. */
  state: EntryType;
  /** Nonempty questions keyed by the names used to identify their answers. */
  questions: Q;
  /** Model override; omitted values inherit `defaultModel`. */
  model?: string;
}

/** Request body for `POST /v1/systemone`, with the model resolved and Rank questions expanded. */
export interface SystemOneRequestPayload extends Omit<SystemOneRequest, "questions"> {
  questions: { [name: string]: WireQuestion };
  model: string;
}

/** Retry configuration. Partial overrides inherit unset fields from the client or SDK defaults. */
export interface RetryPolicy {
  /** Maximum retries after the initial attempt; `0` disables retries. Default: 2. */
  readonly maxRetries: number;
  /** First backoff delay in milliseconds, doubled up to `backoffMaxMs`. Default: 500. */
  readonly backoffInitialMs: number;
  /** Maximum backoff delay in milliseconds. Default: 5000. */
  readonly backoffMaxMs: number;
  /** Fraction of each backoff delay randomly subtracted, from 0 to 1. Default: 0.25. */
  readonly backoffJitter: number;
  /** HTTP status codes to retry. Default: 408, 429, and 500–599. */
  readonly httpStatuses: ReadonlySet<number>;
  /** Honor `Retry-After` and `retry-after-ms` up to `maxRetryAfterMs`. Default: true. */
  readonly respectRetryAfter: boolean;
  /** Maximum server retry delay in milliseconds; longer delays use backoff. Default: 60000. */
  readonly maxRetryAfterMs: number;
  /** Retry connection failures, including interrupted response bodies (`APIConnectionError`). Default: true. */
  readonly apiConnectionError: boolean;
  /** Whether to retry `APITimeoutError`. Default: true. */
  readonly apiTimeoutError: boolean;
}

/** Per-call options that override client settings. */
export interface RequestOptions {
  /** Cancellation signal for the request and pending retries. */
  signal?: AbortSignal;
  /** Timeout per attempt in milliseconds; there is no total retry budget. */
  timeout?: number;
  /** Retry overrides for this call; omitted fields inherit client settings. */
  retry?: Partial<RetryPolicy>;
  /** Additional headers, merged over `defaultHeaders`. */
  headers?: Record<string, string>;
}

/** HTTP fetch implementation compatible with the global `fetch`. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Log verbosity; `off` disables logging. */
export type LogLevel = "debug" | "info" | "warn" | "error" | "off";

/** Log methods accepting a message and structured values; compatible with `console`. */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** Client options. Explicit values take precedence over environment variables, then SDK defaults. */
export interface TypeSafeClientConfig {
  /** Required API key; falls back to `TYPESAFE_API_KEY`. */
  apiKey?: string;
  /** API root; falls back to `TYPESAFE_BASE_URL`, then `https://api.typesafe.ai`. */
  baseURL?: string;
  /** Default model; falls back to `TYPESAFE_DEFAULT_MODEL`, then `jev-latest`. */
  defaultModel?: string;
  /**
   * Log level; falls back to `TYPESAFE_LOG_LEVEL`, then `warn`.
   * `info` logs request summaries; `debug` adds headers and bodies.
   * Known credential headers are redacted; bodies are not.
   */
  logLevel?: LogLevel;
  /** Logger filtered to `logLevel` and above. Default: prefixed `console`. */
  logger?: Logger;
  /** Retry overrides; omitted fields use the defaults in `RetryPolicy`. */
  retry?: Partial<RetryPolicy>;
  /** Timeout per attempt in milliseconds, without a total retry budget. Default: 10000. */
  timeout?: number;
  /** Additional request headers; per-call headers take precedence. */
  defaultHeaders?: Record<string, string>;
  /** Allow browser use, exposing the API key to page users. Default: false. */
  dangerouslyAllowBrowser?: boolean;
  /** Custom HTTP fetch implementation for transport configuration or tests. Default: global `fetch`. */
  fetch?: Fetch;
}
