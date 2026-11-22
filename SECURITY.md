# Security Policy

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting:
**Security tab > Report a vulnerability** on this repository.
You will get a reply within 7 days.

## Design guarantees

- envdiff never prints, logs or exports `.env` values (text and `--json` output contain key names only).
- No network access and zero runtime dependencies.
- npm releases are built by GitHub Actions with provenance; never by hand.
- File names and paths are stripped of terminal control characters before printing.
- The GitHub Action writes its job summary HTML-escaped, so repo file names cannot inject markdown.
- `.envdiffrc.json` cannot make envdiff read files or scan folders outside the project folder, and cannot enable any option that writes files.
- `--fix` only appends `KEY=` lines; `--html` refuses to overwrite an input file; `--open` uses a private temp folder and launches the browser without a shell.
- Parsing and "did you mean" stay fast on hostile input (unclosed quotes, thousands of keys).
- Security problems (leaked secrets, committed `.env`, missing `.gitignore`) can never be hidden by `.envdiff-baseline.json`.
- `--mcp` (for AI agents) is read-only: the tool cannot fix, write reports or baselines, rejects paths outside the folder it was started in, runs envdiff without a shell and returns the same value-free output as `--json`.

## Standalone executables

Release executables are built only by GitHub Actions (`binaries.yml`) from the tagged source with the official Node.js single executable application feature, smoke-tested, and published with a SHA256SUMS.txt and a build provenance attestation (`gh attestation verify <file> -R Guihakka2/envdiff`). They are not code-signed with a paid certificate yet.
