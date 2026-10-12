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

- `criteria` maps 2 to 255 labels to descriptions, like Choice options. Labels must not be integers such as `"3"`, because JavaScript objects reorder integer keys.
- `score` is the item's Bradley–Terry strength divided by the winner's: the winner scores exactly 1, and P(item beats the winner) = score / (1 + score). Ties keep input order.
- The third argument, `maxDuels`, caps the pairs played. `null`, or any number covering every pair, plays every pair in one round. Otherwise the number must be at least the item count minus one: round 1 plays a cycle over a shuffle seeded by the sorted labels, and each later round plays up to n unplayed pairs whose outcome is most uncertain under the current fit.
- Duels share requests with your other questions and are packed into as few requests per round as the token limit allows. `usage` sums every request.

The Python fork (`joedeleeuw/typesafe-sdk-python`) implements the same schedule and fit with the same field names.

## Documentation

Learn what TypeSafe can do in the [TypeSafe docs](https://docs.typesafe.ai/).
See the SDK's [client](src/client.ts) and [types](src/types.ts) for API options and defaults.
