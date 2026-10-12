import { TypeSafeError } from "./errors";
import type {
  ChoiceCriteria,
  ChoiceQuestion,
  ChoiceResponse,
  RankQuestion,
  RankResponse,
} from "./types";

/** The most options a Choice question accepts, and so the most items a Rank can order. */
export const MAX_RANK_ITEMS = 255;

const FIT_TOLERANCE = 1e-10;
const FIT_MAX_ITERATIONS = 10_000;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Canonical array-index strings, which JavaScript objects enumerate before all other keys. */
const isIntegerKey = (label: string): boolean =>
  /^(0|[1-9]\d*)$/.test(label) && Number(label) < 2 ** 32 - 1;

/** Reject Rank questions whose criteria cannot be scheduled as duels in both orders. */
export const validateRank = (name: string, question: RankQuestion): void => {
  const { criteria, max_duels: maxDuels } = question;
  if (typeof criteria !== "object" || criteria === null || Array.isArray(criteria)) {
    throw new TypeSafeError(
      `Rank question "${name}" has criteria that are not a map; ` +
        "rank criteria must map each item's label to its description.",
    );
  }
  const labels = Object.keys(criteria);
  if (labels.length < 2 || labels.length > MAX_RANK_ITEMS) {
    throw new TypeSafeError(
      `Rank question "${name}" has ${labels.length} items; ` +
        `a rank orders between 2 and ${MAX_RANK_ITEMS} items.`,
    );
  }
  const integerLabel = labels.find(isIntegerKey);
  if (integerLabel !== undefined) {
    throw new TypeSafeError(
      `Rank question "${name}" has the integer label "${integerLabel}"; ` +
        "JavaScript objects reorder integer keys, which loses the input order and the duel order, " +
        "so give each item a non-integer label.",
    );
  }
  if (maxDuels === undefined || maxDuels === null) return;
  if (!Number.isInteger(maxDuels) || maxDuels < labels.length - 1) {
    throw new TypeSafeError(
      `Rank question "${name}" has max_duels ${maxDuels}; ` +
        `ordering ${labels.length} items needs an integer of at least ${labels.length - 1}.`,
    );
  }
};

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/** Item indices `i < j` in input order; `i` is listed first in the "ab" duel. */
type Pair = readonly [i: number, j: number];

const pairKey = (i: number, j: number): string => `${i}:${j}`;

/** Compare by Unicode code point, matching Python's `sorted`. */
const compareCodePoints = (a: string, b: string): number => {
  const x = Array.from(a, (c) => c.codePointAt(0) ?? 0);
  const y = Array.from(b, (c) => c.codePointAt(0) ?? 0);
  for (let k = 0; k < Math.min(x.length, y.length); k++) {
    const d = (x[k] ?? 0) - (y[k] ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
};

/** 32-bit FNV-1a over UTF-8 bytes. */
const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash;
};

const mulberry32 = (seed: number): (() => number) => {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
};

/** A cycle over the items in a shuffle seeded by the sorted labels, so the duel graph is connected. */
const firstRound = (labels: readonly string[], budget: number): Pair[] => {
  const order = [...labels].sort(compareCodePoints);
  const random = mulberry32(fnv1a(order.join("\u0000")));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j] as string, order[i] as string];
  }
  const index = new Map(labels.map((label, i) => [label, i]));
  const seen = new Set<string>();
  const pairs: Pair[] = [];
  for (let k = 0; k < order.length; k++) {
    const x = index.get(order[k] as string) as number;
    const y = index.get(order[(k + 1) % order.length] as string) as number;
    const pair: Pair = x < y ? [x, y] : [y, x];
    if (seen.has(pairKey(...pair))) continue;
    seen.add(pairKey(...pair));
    pairs.push(pair);
  }
  return pairs.slice(0, budget);
};

/** Up to `n` unplayed pairs whose outcome is most uncertain under the current fit. */
const nextRound = (
  strengths: readonly number[],
  played: ReadonlySet<string>,
  budget: number,
): Pair[] => {
  const n = strengths.length;
  const candidates: { pair: Pair; uncertainty: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (played.has(pairKey(i, j))) continue;
      const pi = strengths[i] as number;
      const total = pi + (strengths[j] as number);
      const p = total > 0 ? pi / total : 0.5;
      candidates.push({ pair: [i, j], uncertainty: p * (1 - p) });
    }
  }
  candidates.sort((x, y) => y.uncertainty - x.uncertainty);
  return candidates.slice(0, Math.min(n, budget)).map((c) => c.pair);
};

// ---------------------------------------------------------------------------
// Fit
// ---------------------------------------------------------------------------

/** A played pair with the soft probability that its first item wins. */
interface Outcome {
  readonly i: number;
  readonly j: number;
  readonly win: number;
}

/**
 * Bradley–Terry strengths fitted to soft outcomes by the MM algorithm (Hunter 2004), normalized to
 * sum to the number of items.
 *
 * @throws {TypeSafeError} The fit does not converge within the iteration cap.
 */
const fitBradleyTerry = (n: number, outcomes: readonly Outcome[]): number[] => {
  const wins = new Array<number>(n).fill(0);
  for (const { i, j, win } of outcomes) {
    wins[i] = (wins[i] as number) + win;
    wins[j] = (wins[j] as number) + 1 - win;
  }
  let strengths = new Array<number>(n).fill(1);
  for (let iteration = 0; iteration < FIT_MAX_ITERATIONS; iteration++) {
    const denominators = new Array<number>(n).fill(0);
    for (const { i, j } of outcomes) {
      const inverse = 1 / ((strengths[i] as number) + (strengths[j] as number));
      denominators[i] = (denominators[i] as number) + inverse;
      denominators[j] = (denominators[j] as number) + inverse;
    }
    const next = wins.map((w, i) => w / (denominators[i] as number));
    const total = next.reduce((sum, x) => sum + x, 0);
    for (let i = 0; i < n; i++) next[i] = ((next[i] as number) * n) / total;
    const largest = Math.max(...next);
    const change = Math.max(...next.map((x, i) => Math.abs(x - (strengths[i] as number))));
    strengths = next;
    if (change <= FIT_TOLERANCE * largest) return strengths;
  }
  throw new TypeSafeError(
    `Bradley–Terry fit did not converge within ${FIT_MAX_ITERATIONS} iterations.`,
  );
};

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** A Choice duel between two items, with the item listed first. */
export interface Duel {
  readonly id: string;
  readonly question: ChoiceQuestion;
}

/** Schedules duels for one Rank question round by round and fits the final ranking. */
export class RankSession {
  readonly #name: string;
  readonly #question: RankQuestion;
  readonly #labels: readonly string[];
  readonly #budget: number;
  readonly #outcomes: Outcome[] = [];
  readonly #played = new Set<string>();
  #consistency = 0;
  #pending: { pair: Pair; ab: string; ba: string }[] = [];

  constructor(name: string, question: RankQuestion) {
    this.#name = name;
    this.#question = question;
    this.#labels = Object.keys(question.criteria);
    const n = this.#labels.length;
    const allPairs = (n * (n - 1)) / 2;
    this.#budget = Math.min(question.max_duels ?? allPairs, allPairs);
  }

  /**
   * The next round's duels, both orders of each pair, or none once the budget is spent.
   *
   * @param prefix - Id prefix that no caller question id starts with.
   */
  nextDuels(prefix: string): Duel[] {
    const n = this.#labels.length;
    const remaining = this.#budget - this.#played.size;
    if (remaining <= 0) return [];
    let pairs: Pair[];
    if (this.#played.size > 0) {
      pairs = nextRound(fitBradleyTerry(n, this.#outcomes), this.#played, remaining);
    } else if (this.#question.max_duels === undefined || this.#question.max_duels === null) {
      pairs = [];
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j]);
    } else {
      pairs = firstRound(this.#labels, remaining);
    }
    const criteria = this.#question.criteria;
    const instructions = this.#question.instructions ?? null;
    const duels: Duel[] = [];
    this.#pending = pairs.map((pair) => {
      const [a, b] = [this.#labels[pair[0]] as string, this.#labels[pair[1]] as string];
      const id = `${prefix}${this.#name}:${pair[0]}:${pair[1]}`;
      const duel = (first: string, second: string): ChoiceQuestion => ({
        type: "choice",
        instructions,
        criteria: { [first]: criteria[first] ?? null, [second]: criteria[second] ?? null },
      });
      duels.push(
        { id: `${id}:ab`, question: duel(a, b) },
        { id: `${id}:ba`, question: duel(b, a) },
      );
      return { pair, ab: `${id}:ab`, ba: `${id}:ba` };
    });
    return duels;
  }

  /** Record the answers to the duels returned by the last `nextDuels` call. */
  record(answers: ReadonlyMap<string, unknown>): void {
    for (const { pair, ab, ba } of this.#pending) {
      const a = this.#labels[pair[0]] as string;
      const b = this.#labels[pair[1]] as string;
      const first = winProbability(answers.get(ab), a, b, ab);
      const second = winProbability(answers.get(ba), a, b, ba);
      this.#outcomes.push({ i: pair[0], j: pair[1], win: (first + second) / 2 });
      this.#consistency += 1 - Math.abs(first - second);
      this.#played.add(pairKey(...pair));
    }
    this.#pending = [];
  }

  /** The fitted ranking, best first, with Luce odds against the winner as scores. */
  answer<T extends ChoiceCriteria>(): RankResponse<T> {
    const strengths = fitBradleyTerry(this.#labels.length, this.#outcomes);
    const best = Math.max(...strengths);
    const ranking = this.#labels
      .map((label, i) => ({
        label: label as keyof T & string,
        score: (strengths[i] as number) / best,
      }))
      .sort((x, y) => y.score - x.score);
    return {
      type: "rank",
      ranking,
      duels: this.#played.size,
      position_consistency: this.#consistency / this.#played.size,
    };
  }
}

/** P(a wins) in one duel, normalized over its two options. */
const winProbability = (answer: unknown, a: string, b: string, id: string): number => {
  const probabilities = (answer as Partial<ChoiceResponse> | undefined)?.probabilities;
  const pa = probabilities?.[a];
  const pb = probabilities?.[b];
  if (typeof pa !== "number" || typeof pb !== "number" || !(pa + pb > 0)) {
    throw new TypeSafeError(`The API returned no usable probabilities for rank duel "${id}".`);
  }
  return pa / (pa + pb);
};

/** The shortest `rank` + colons prefix that no caller question id starts with. */
export const duelPrefix = (ids: readonly string[]): string => {
  let prefix = "rank:";
  while (ids.some((id) => id.startsWith(prefix))) prefix += ":";
  return prefix;
};

/** Estimated tokens for a JSON value. */
const estimateTokens = (value: unknown): number =>
  Math.ceil((JSON.stringify(value) ?? "").length / 3);

/** Estimated tokens per request, below the API's 64k limit on state plus all questions. */
const REQUEST_TOKEN_BUDGET = 60_000;

/** Pack questions in order into as few requests as the token budget allows, at least one each. */
export const packQuestions = <T>(
  state: unknown,
  questions: readonly (readonly [string, T])[],
): (readonly [string, T])[][] => {
  const base = estimateTokens(state);
  const batches: (readonly [string, T])[][] = [];
  let batch: (readonly [string, T])[] = [];
  let used = base;
  for (const entry of questions) {
    const cost = estimateTokens(entry[1]);
    if (batch.length > 0 && used + cost > REQUEST_TOKEN_BUDGET) {
      batches.push(batch);
      batch = [];
      used = base;
    }
    batch.push(entry);
    used += cost;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
};
