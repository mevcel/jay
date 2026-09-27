# Contributing

Thanks for helping out. Most useful contributions fall into two groups.

## Updating what Jay knows

Fees, addresses and flows live in `knowledge/*.md`. If something there is wrong or out of date:

1. Edit the right file. Keep the numbers exact and link the source (docs page or contract).
2. If it changes an answer Jay gives often, add or update a case in `evals/cases.jsonl`.
3. Run `npm test`, and `npm run eval` if you have an API key.
4. Open a pull request using the **Knowledge update** template.

Official contract addresses and allowed link domains are also listed in `src/safety/guardrails.ts`. Update both places together.

## Code changes

```bash
npm install
npm test
npm run typecheck
npm run format:check
```

- Keep the chain client read-only. Pull requests that add signing or transaction sending will not be merged.
- New safety rules need unit tests in `tests/guardrails.test.ts`.
- Keep pull requests small and focused, with a short note on what changed and why.

## Reporting bugs

Open an issue with the **Bug report** template. For anything security related, follow [`SECURITY.md`](SECURITY.md) instead.

## Conduct

Be respectful. See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
