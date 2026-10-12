import { TypeSafeError } from "./errors";
import type {
  ChoiceCriteria,
  ChoiceQuestion,
  EntryType,
  RankQuestion,
  RankResponse,
} from "./types";

/** The most options a Choice question accepts, and so the most items a Rank can order. */
const MAX_RANK_ITEMS = 255;

const FIT_TOLERANCE = 1e-10;
const FIT_MAX_ITERATIONS = 10_000;

/** The API's limit on the state plus all questions of one request. Tokens never exceed UTF-8 bytes. */
const REQUEST_BYTE_LIMIT = 64_000;
/** The API's limit on the state plus the longest question of one request. */
const QUESTION_BYTE_LIMIT = 32_000;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Reject Rank questions that cannot be scheduled as duels in both option orders. */
export const validateRank = (name: string, question: RankQuestion): void => {
  const { criteria, instructions, max_duels: maxDuels } = question;
  if (instructions === undefined || instructions === null) {
    throw new TypeSafeError(`Rank question "${name}" requires instructions.`);
  }
  if (typeof criteria !== "object" || criteria === null || Array.isArray(criteria)) {
    throw new TypeSafeError(`Rank question "${name}" criteria must be an object.`);
  }
  const labels = Object.keys(criteria);
  const n = labels.length;
  if (n < 2 || n > MAX_RANK_ITEMS) {
    throw new TypeSafeError(
      `Rank question "${name}" has ${n} criteria; between 2 and ${MAX_RANK_ITEMS} items are required.`,
    );
  }
  // JavaScript enumerates canonical array-index keys first, which would lose the input and duel order.
  const integerLabel = labels.find(
    (label) => /^(0|[1-9][0-9]*)$/.test(label) && Number(label) < 2 ** 32 - 1,
  );
  if (integerLabel !== undefined) {
    throw new TypeSafeError(
      `Rank question "${name}" has the integer label "${integerLabel}"; ` +
        "Rank labels must not be integers, because JavaScript reorders integer object keys.",
    );
  }
  if (maxDuels === undefined || maxDuels === null) return;
  const allPairs = (n * (n - 1)) / 2;
  if (!Number.isInteger(maxDuels) || maxDuels < n - 1 || maxDuels > allPairs) {
    throw new TypeSafeError(
      `Rank question "${name}" max_duels must be unset or an integer from ${n - 1} to ${allPairs} ` +
        `for its ${n} items.`,
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

/**
 * A cycle over the items in a shuffle seeded by the sorted labels, so the duel graph is connected.
 * A budget of one fewer than the item count drops the closing edge, leaving a path.
 */
const cycleRound = (labels: readonly string[], budget: number): Pair[] => {
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
const uncertainRound = (
  strengths: readonly number[],
  played: ReadonlySet<string>,
  budget: number,
): Pair[] => {
  const n = strengths.length;
  const candidates: { pair: Pair; uncertainty: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (played.has(pairKey(i, j))) continue;
      const si = strengths[i] as number;
      const total = si + (strengths[j] as number);
      const p = total > 0 ? si / total : 0.5;
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
 * Every sum accumulates left to right in record order, operation for operation as in the Python
 * fork, so both SDKs return bit-identical scores for identical duel probabilities.
 *
 * @throws {TypeSafeError} The fit does not converge within the iteration cap.
 */
const fitBradleyTerry = (n: number, outcomes: readonly Outcome[]): number[] => {
  const wins = new Array<number>(n).fill(0);
  for (const { i, j, win } of outcomes) {
    wins[i] = (wins[i] as number) + win;
    wins[j] = (wins[j] as number) + (1 - win);
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
    let total = 0;
    for (const x of next) total = total + x;
    const scale = n / total;
    for (let i = 0; i < n; i++) next[i] = (next[i] as number) * scale;
    let change = 0;
    let largest = 0;
    for (let i = 0; i < n; i++) {
      change = Math.max(change, Math.abs((next[i] as number) - (strengths[i] as number)));
      largest = Math.max(largest, next[i] as number);
    }
    strengths = next;
    if (change <= FIT_TOLERANCE * largest) return strengths;
  }
  throw new TypeSafeError(
    `The Bradley–Terry fit did not converge within ${FIT_MAX_ITERATIONS} iterations.`,
  );
};

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** A Choice duel between two items. */
export interface Duel {
  readonly id: string;
  readonly question: ChoiceQuestion;
}

const duelQuestion = (
  instructions: EntryType | undefined,
  criteria: ChoiceCriteria,
  first: string,
  second: string,
): ChoiceQuestion => ({
  type: "choice",
  instructions,
  criteria: { [first]: criteria[first] ?? null, [second]: criteria[second] ?? null },
});

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

  /** Expects a question that passed `validateRank`. */
  constructor(name: string, question: RankQuestion) {
    this.#name = name;
    this.#question = question;
    this.#labels = Object.keys(question.criteria);
    const n = this.#labels.length;
    this.#budget = question.max_duels ?? (n * (n - 1)) / 2;
  }

  /**
   * The largest duel this Rank can schedule: the Choice over its two largest criteria entries,
   * since a duel's size is the sum of its two entries.
   */
  largestDuel(): ChoiceQuestion {
    const { criteria, instructions } = this.#question;
    const sizes = this.#labels.map((label) => ({
      label,
      bytes: jsonBytes({ [label]: criteria[label] ?? null }),
    }));
    sizes.sort((x, y) => y.bytes - x.bytes);
    return duelQuestion(instructions, criteria, sizes[0]?.label ?? "", sizes[1]?.label ?? "");
  }

  /**
   * The next round's duels, both orders of each pair, or none once the budget is spent.
   *
   * Without `max_duels` round 1 plays every pair. With it, round 1 is a seeded cycle and each later
   * round plays the most uncertain unplayed pairs under the current fit.
   *
   * @param prefix - Id prefix that no caller question id starts with.
   */
  nextDuels(prefix: string): Duel[] {
    const n = this.#labels.length;
    const remaining = this.#budget - this.#played.size;
    if (remaining <= 0) return [];
    let pairs: Pair[];
    if (this.#played.size > 0) {
      pairs = uncertainRound(fitBradleyTerry(n, this.#outcomes), this.#played, remaining);
    } else if (this.#question.max_duels === undefined || this.#question.max_duels === null) {
      pairs = [];
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j]);
    } else {
      pairs = cycleRound(this.#labels, remaining);
    }
    const { criteria, instructions } = this.#question;
    const duels: Duel[] = [];
    this.#pending = pairs.map((pair) => {
      const [a, b] = [this.#labels[pair[0]] as string, this.#labels[pair[1]] as string];
      const id = `${prefix}${this.#name}:${pair[0]}:${pair[1]}`;
      duels.push(
        { id: `${id}:ab`, question: duelQuestion(instructions, criteria, a, b) },
        { id: `${id}:ba`, question: duelQuestion(instructions, criteria, b, a) },
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
      const first = winProbability(answers.get(ab), a, b, this.#name);
      const second = winProbability(answers.get(ba), a, b, this.#name);
      this.#outcomes.push({ i: pair[0], j: pair[1], win: (first + second) / 2 });
      this.#consistency = this.#consistency + (1 - Math.abs(first - second));
      this.#played.add(pairKey(...pair));
    }
    this.#pending = [];
  }

  /** The fitted ranking, best first, with Luce odds against the winner as scores. */
  answer<T extends ChoiceCriteria>(): RankResponse<T> {
    const strengths = fitBradleyTerry(this.#labels.length, this.#outcomes);
    let best = 0;
    for (const s of strengths) best = Math.max(best, s);
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
const winProbability = (answer: unknown, a: string, b: string, name: string): number => {
  const probabilities =
    typeof answer === "object" && answer !== null && "probabilities" in answer
      ? answer.probabilities
      : undefined;
  const known = typeof probabilities === "object" && probabilities !== null;
  const pa: unknown = known ? Reflect.get(probabilities, a) : undefined;
  const pb: unknown = known ? Reflect.get(probabilities, b) : undefined;
  if (typeof pa !== "number" || typeof pb !== "number" || !(pa + pb > 0)) {
    throw new TypeSafeError(`The response is missing a duel answer for Rank question "${name}".`);
  }
  return pa / (pa + pb);
};

/** The shortest `rank` + colons prefix that no caller question id starts with. */
export const duelPrefix = (ids: readonly string[]): string => {
  let prefix = "rank:";
  while (ids.some((id) => id.startsWith(prefix))) prefix += ":";
  return prefix;
};

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

/** UTF-8 bytes of compact JSON: an upper bound on tokens, since every token covers at least one byte. */
const jsonBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value) ?? "").length;

/**
 * Reject a question that cannot fit in any request with the state.
 *
 * @throws {TypeSafeError} The state and the question exceed the per-question limit.
 */
export const checkQuestionSize = (
  state: unknown,
  name: string,
  question: unknown,
  isRank: boolean,
): void => {
  const bytes = jsonBytes(state) + jsonBytes(question);
  if (bytes <= QUESTION_BYTE_LIMIT) return;
  const subject = isRank
    ? `Rank question "${name}" has a duel that takes`
    : `Question "${name}" takes`;
  throw new TypeSafeError(
    `${subject} ${bytes} bytes with the state, over the ${QUESTION_BYTE_LIMIT}-byte limit for the state and one question.`,
  );
};

/**
 * Pack questions in order into as few requests as the per-request limit allows. Each question must
 * already have passed `checkQuestionSize`, so it fits in a request of its own.
 */
export const packQuestions = <T>(
  state: unknown,
  questions: readonly (readonly [string, T])[],
): (readonly [string, T])[][] => {
  const base = jsonBytes(state);
  const batches: (readonly [string, T])[][] = [];
  let batch: (readonly [string, T])[] = [];
  let used = base;
  for (const entry of questions) {
    const bytes = jsonBytes(entry[1]);
    if (batch.length > 0 && used + bytes > REQUEST_BYTE_LIMIT) {
      batches.push(batch);
      batch = [];
      used = base;
    }
    batch.push(entry);
    used += bytes;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
};
