# Roadmap

Goal: envdiff becomes the default safe way to check `.env` drift locally and in CI.

## v0.1.1 — trusted release pipeline (this week)
- [ ] Configure npm Trusted Publisher + "disallow tokens" on npmjs.com
- [ ] Release 0.1.1 from GitHub Actions and verify the provenance badge on npm

## v0.2 — zero-config + CI (≈2 weeks)
- [ ] **Zero-arg mode**: `envdiff` alone compares `.env.example` with `.env` in the current folder
- [ ] **Multiline values and escaped quotes** (current known limit)
- [ ] `--ignore KEY,PREFIX_*` to skip keys that are expected to differ
- [ ] `--strict`: warnings (duplicate, empty, invalid line) also fail
- [ ] **GitHub Action**: `uses: Guihakka2/envdiff@v1` with job summary output
- [ ] More secret patterns (GitLab, npm, Azure, JWT-looking values), each with a test

## Launch (after v0.2)
- [ ] README: demo GIF, comparison with alternatives (honest, verified)
- [ ] README.pt-BR.md and README.ja.md
- [ ] Post: Show HN, r/devops, r/node, dev.to (EN) · Zenn, Qiita (JA) · TabNews (PT)
- [ ] Submit to awesome-dotenv / awesome-devops style lists

## How we decide what's next
After launch, measure for 2 weeks: npm weekly downloads, GitHub stars, issues opened by people other than the maintainer.
- Real usage → v0.3 driven by issues (likely: YAML/JSON config files, monorepo scan)
- Little interest → stop adding features, move to the next Guihakka tool with the most 👍

## Not planned
Network access, telemetry, printing values in any mode, runtime dependencies.
