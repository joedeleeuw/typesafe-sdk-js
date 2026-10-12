# Changelog

## Unreleased (fork)

### Features

- add the `rank` question, which orders items by pairwise Choice duels in both option orders fitted with Bradley–Terry, answering with `RankResponse` (`ranking`, `duels`, `position_consistency`)
- add `RankIncompleteError`, raised when a request for a Rank question fails, carrying the usage of the requests that succeeded

## v0.6.0 (2026-09-15)

### Breaking changes

- accept `Score.criteria` as an ordered sequence instead of a dictionary keyed by integers

## v0.5.7 (2026-09-11)

This is the initial public release of TypeSafe JavaScript and TypeScript SDK. Learn more in the [documentation](https://docs.typesafe.ai/sdk/javascript).
