# Contributing

Thanks for helping! Rules that keep users safe:

1. Every change goes through a pull request reviewed by the maintainer.
2. **No new runtime dependencies** without an issue discussing it first.
3. Output must never include `.env` values. Add a test if you touch output.
4. Run `npm test` before opening a PR (Node 20+).
5. If you change the terminal output, run `npm run demo` so the README demo (`docs/demo.svg`) shows the real, current output.

English first for code, issues and docs. Translations (pt-BR, ja) are welcome as separate PRs.
