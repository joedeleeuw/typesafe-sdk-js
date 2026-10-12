# TypeSafe AI JavaScript SDK

JavaScript and TypeScript SDK for [TypeSafe AI](https://typesafe.ai).

## Quickstart

Install the SDK (Node.js 20 or newer):

```sh
npm install @typesafe-ai/sdk
```

Set `TYPESAFE_API_KEY` in your environment, then create and use the client:

```ts
import { choice, TypeSafeClient } from "@typesafe-ai/sdk";

const client = new TypeSafeClient();
const response = await client.systemOne({
  state: { document: "I was charged twice. Please fix this ASAP." },
  questions: {
    category: choice("What is this ticket about?", {
      billing: null,
      technical: null,
      other: null,
    }),
  },
});

console.log(response.answers.category.choice);
```

Answer types are inferred from your questions. The package includes ESM, CommonJS, and TypeScript declarations.

## Rank

This fork adds a fourth question form, `rank`, for picking a clear #1 among items, where pointwise Noul or Score judgments tend to bunch together. The client expands each Rank into pairwise Choice duels, asks every pair in both option orders over the same `state`, fits Bradley–Terry strengths, and answers with the order. The API itself never sees a Rank.

```ts
import { rank, TypeSafeClient } from "@typesafe-ai/sdk";

const client = new TypeSafeClient();
const { answers, usage } = await client.systemOne({
  state: { query: "Which passage is the cited precedent?" },
  questions: {
    best: rank("Which candidate passage is more likely the cited precedent?", {
      p1: "first passage…",
      p2: "second passage…",
      p3: "third passage…",
    }),
  },
});

answers.best.ranking; // [{ label: "p2", score: 1 }, { label: "p1", score: 0.31 }, …]
answers.best.duels; // pairs played
answers.best.position_consistency; // mean 1 − |P(a wins | a first) − P(a wins | b first)|
```

- `instructions` are required. `criteria` maps 2 to 255 labels to descriptions, like Choice options. Labels must not be integers such as `"3"`, because JavaScript objects reorder integer keys.
- `score` is the item's Bradley–Terry strength divided by the winner's: the winner scores exactly 1, and P(item beats the winner) = score / (1 + score). Ties keep input order.
- The third argument, `maxDuels`, sets the number of pairs played. `null` plays every pair in one round. A number must be an integer from the item count minus one to the number of pairs. Round 1 then plays a cycle over a shuffle seeded by the sorted labels, and each later round plays up to n unplayed pairs whose outcome is most uncertain under the current fit.
- Duels share requests with your other questions. Each round is packed into as few requests as the API's limits allow: 64,000 for the state plus all of a request's questions, and 32,000 for the state plus any one question. Sizes are counted in UTF-8 bytes of compact JSON, which bounds tokens whenever every token covers at least one byte. A question, or a Rank's largest possible duel, that cannot fit is rejected before anything is sent.
- `usage` sums every request. If a request fails, the call rejects with `RankIncompleteError` after the round's other requests settle. Its `usage` covers every request that succeeded, and its `cause` is the first failure.
- If a group of items lost every duel against the other items with certainty, no Bradley–Terry fit with finite positive strengths exists, and the call rejects with `RankSeparationError` naming the question (`questionName`) and that group (`labels`) instead of returning zero scores.

The Python fork (`joedeleeuw/typesafe-sdk-python`) implements the same validation, schedule, fit and packing with the same field names. Given the same duel probabilities, both forks return bit-identical schedules and scores.

## Documentation

Learn what TypeSafe can do in the [TypeSafe docs](https://docs.typesafe.ai/).
See the SDK's [client](src/client.ts) and [types](src/types.ts) for API options and defaults.
