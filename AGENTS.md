# Repository Agent Instructions

This is `joedeleeuw/typesafe-sdk-js`, our fork of `typesafe-ai/typesafe-sdk-js` (the `@typesafe-ai/sdk` package). Upstream accepts no pull requests, so fork changes live here for good.

## What the fork adds

- The `rank` question (`RankQuestion`, `RankResponse`, `RankItem`). The client expands each Rank into pairwise Choice duels, asked in both option orders, fits Bradley–Terry strengths by MM, and returns `ranking`, `duels` and `position_consistency`. Rank never reaches the API as its own type.
- Scheduling, fitting, validation and request packing live in `src/rank.ts`. `src/client.ts` (`systemOne`) runs the rounds.
- The semantics match the Python fork `joedeleeuw/typesafe-sdk-python`: the same seeded round-1 cycle (FNV-1a over the code-point-sorted labels, then mulberry32 and Fisher–Yates), the same p(1−p) later rounds, the same fit tolerance, duel ids and field names. Change both forks together.

## Remotes and upstream releases

- `origin` is `git@github.com:joedeleeuw/typesafe-sdk-js.git` and `upstream` is `git@github.com:typesafe-ai/typesafe-sdk-js.git`. Work on `main`.
- To take an upstream release, run `git fetch upstream --tags`, then `git merge upstream/main` (upstream commits are release snapshots), and resolve conflicts in `src/client.ts`, `src/types.ts`, `src/questions.ts`, `src/index.ts` and `test/dist/helpers.ts`. Re-run the gate, then push to `origin`.
- Keep the fork's entry in `docs/changelog.md` under `Unreleased (fork)` above the upstream release notes.

## Validation

- Gate: `npm run lint`, `npm run typecheck`, `npx vitest run`, `npm run build && npm run test:dist`.
- `test/dist/helpers.ts` `EXPECTED_VALUE_EXPORTS` must list every runtime export, including `rank`.
- Commits use conventional commit messages, with no AI trailers. `.pre-commit-config.yaml` (from `project-init`) is the fork's own commit gate; upstream has none.
