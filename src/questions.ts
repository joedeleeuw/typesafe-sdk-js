import { TypeSafeError } from "./errors";
import { validateRank } from "./rank";
import type {
  ChoiceCriteria,
  ChoiceQuestion,
  EntryType,
  NoulQuestion,
  Questions,
  RankQuestion,
  ScoreCriteria,
  ScoreQuestion,
} from "./types";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Create a yes/no question with optional descriptions for either outcome.
 *
 * @param instructions - The question as text, a JSON object or array; defaults to `null`.
 * @param criteria - Optional descriptions of the yes and no outcomes.
 */
export const noul = (
  instructions: EntryType = null,
  criteria?: NoulQuestion["criteria"],
): NoulQuestion => ({
  type: "noul",
  instructions,
  criteria,
});

/**
 * Create a score question using an ordered rubric.
 *
 * @param instructions - The question as text, a JSON object or array, or `null`.
 * @param criteria - At least two descriptions indexed by score from zero; entries may be `null`.
 */
export const score = <const T extends ScoreCriteria>(
  instructions: EntryType,
  criteria: T,
): ScoreQuestion<T> => {
  if (!Array.isArray(criteria)) {
    throw new TypeSafeError(
      "Score criteria must be a list of descriptions indexed by score from zero, not a map.",
    );
  }
  return { type: "score", instructions, criteria };
};

/**
 * Create a question that selects between named alternatives.
 *
 * @param instructions - The question as text, a JSON object or array, or `null`.
 * @param criteria - Labels mapped to descriptions, or `null` for undescribed labels.
 */
export const choice = <const T extends ChoiceCriteria>(
  instructions: EntryType,
  criteria: T,
): ChoiceQuestion<T> => {
  if (Array.isArray(criteria)) {
    throw new TypeSafeError("Choice criteria must be a map of labels to descriptions, not a list.");
  }
  return { type: "choice", instructions, criteria };
};

/**
 * Create a question that orders items by pairwise duels, fitted with Bradley–Terry.
 *
 * @param instructions - What makes one item better, as text, a JSON object or array; required.
 * @param criteria - 2 to 255 non-integer labels mapped to descriptions, or `null` for undescribed items.
 * @param maxDuels - Pairs to play; `null` plays every pair at once, otherwise an integer from one fewer
 *   than the items to every pair, played as a seeded cycle and then rounds of the most uncertain pairs.
 */
export const rank = <const T extends ChoiceCriteria>(
  instructions: Exclude<EntryType, null>,
  criteria: T,
  maxDuels: number | null = null,
): RankQuestion<T> => ({ type: "rank", instructions, criteria, max_duels: maxDuels });

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Reject empty question sets, malformed score questions, and Rank questions that cannot be scheduled. */
export const validateQuestions = (questions: Questions): void => {
  if (Object.keys(questions).length === 0) {
    throw new TypeSafeError("At least one question is required.");
  }
  for (const [name, question] of Object.entries(questions)) {
    if (question.type === "rank") validateRank(name, question);
    if (question.type !== "score") continue;
    if (!Array.isArray(question.criteria)) {
      throw new TypeSafeError(
        `Score question "${name}" has criteria that are not a list; ` +
          "score criteria must be a list of descriptions indexed by score from zero.",
      );
    }
    if (question.criteria.length < 2) {
      throw new TypeSafeError(
        `Score question "${name}" has ${question.criteria.length} criteria; ` +
          "at least two scores are required.",
      );
    }
  }
};
