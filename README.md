# envdiff

[![npm](https://img.shields.io/npm/v/@guihakka2/envdiff)](https://www.npmjs.com/package/@guihakka2/envdiff) [![CI](https://github.com/Guihakka2/envdiff/actions/workflows/ci.yml/badge.svg)](https://github.com/Guihakka2/envdiff/actions/workflows/ci.yml)

English · [Português](README.pt-BR.md) · [日本語](README.ja.md)

Compare `.env` files across environments (dev, staging, prod, `.env.example`) — **without ever printing secret values**.

Safe to run in CI logs, screenshots and pull requests: values are compared in memory, only key names are shown.

<p align="center"><img src="docs/demo.svg" alt="envdiff demo" width="760"></p>

```bash
npx @guihakka2/envdiff            # compares every .env* file in this folder
npx @guihakka2/envdiff --scan .   # does .env.example cover every key the code reads?
npx @guihakka2/envdiff .env .env.example --keys-only
npx @guihakka2/envdiff .env.staging .env.production
```

```
envdiff  .env.staging  vs  .env.production

Missing in .env.production:
  - REDIS_URL

Different values (hidden):
  ~ DATABASE_URL

Possible real secrets in template files:
  ! .env.example: AWS_ACCESS_KEY_ID (line 3)

✗ Not in sync
```

## Features

- Missing / extra keys across **2 or more** files
- Changed values, shown only as key names
- Detects real-looking secrets (AWS, GitHub, GitLab, npm, OpenAI, Stripe, Slack, Google, Azure, JWT, private keys) committed in `.example` / `.sample` / `.template` files
- Duplicate keys, empty values, malformed lines
- **Git safety**: fails if a real `.env` is committed to git, warns if it is not in `.gitignore`
- **Did you mean?** hints for typos like `DATABSE_URL`
- **Code scan** (`--scan .`): keys your code reads but no env file defines, and keys nobody uses. Works with just `.env.example`. Understands `process.env.X`, `import.meta.env.X`, `env("X")` / `env.X` helpers, destructuring, t3-env schemas, Python, Go, Ruby, PHP, Java, Rust, C# and docker-compose; skips `node_modules`, build output and dot folders like `.github`
- **Lint**: lowercase keys, spaces around `=`, trailing whitespace, unquoted values with spaces
- **Expiry**: `# @expire 2027-03-31` above a key warns when the token is expired or expires within 30 days
- **Zero config**: with no arguments, compares every `.env*` file in the folder; or set defaults in `.envdiffrc.json`
- `--json` output and exit codes for CI: `0` in sync, `1` differences, `2` usage error
- Zero dependencies, runs offline, nothing is sent anywhere

## Use in CI (GitHub Actions)

```yaml
- uses: Guihakka2/envdiff@v1
  with:
    files: .env.example .env.ci   # empty = .env.example vs .env
    args: --keys-only --strict
```

The report (key names only) is also written to the job summary. Needs Node 20+ on the runner (GitHub-hosted runners have it). Pin to a commit SHA for maximum supply-chain safety.

Or without the action: `npx @guihakka2/envdiff .env.example .env.ci --keys-only`

## Config file (optional)

`.envdiffrc.json` in the project root sets defaults; CLI flags win:

```json
{ "files": [".env.example", ".env.staging", ".env.production"], "ignore": ["APP_URL"], "strict": true, "scan": "." }
```

## Adopting in a big project (baseline)

Already have dozens of undocumented keys? Record them once and only fail on **new** problems:

```bash
npx @guihakka2/envdiff --scan . --baseline   # writes .envdiff-baseline.json (commit it)
npx @guihakka2/envdiff --scan .              # from now on: only new problems fail
```

The baseline stores key names only, never values. **Security problems are never baselined**: a real secret in `.env.example` or a committed `.env` always shows and always fails. `--ignore-baseline` shows everything again; delete entries from the file as you fix them.

## Visual report

```bash
npx @guihakka2/envdiff --open                      # opens the visual report in your browser
npx @guihakka2/envdiff --scan . --html report.html  # or save it, e.g. as a CI artifact
```

<p align="center"><img src="docs/report.png" alt="envdiff side-by-side report: one column per env file, missing and different keys highlighted, values masked" width="760"></p>

A side-by-side, editor-style view: one column per env file with line numbers, red bands for missing keys, amber bands for different values, ▲▼ (or `j` / `k`) to jump between problems, filter and "only problems". One self-contained HTML file, dark and light mode, works offline. Values show as `••••••` plus a letter (same letter = same value): the file **never contains values**, so it is safe to attach to CI runs or share with your team.

## Options

| Flag | What it does |
|---|---|
| `--keys-only` | Compare key names only (use with `.env.example`) |
| `--ignore LIST` | Skip keys expected to differ, comma-separated, `*` wildcard: `--ignore APP_URL,DEBUG_*`. Can repeat. Leaked secrets are still reported. |
| `--strict` | Warnings (duplicate key, empty value, invalid line) also fail with exit code 1 |
| `--table` | Grid of keys × files: `✗` missing, same letter = same value (values never shown) |
| `--fix` | Appends missing keys with **empty** values to the files that lack them. Never copies values, never edits existing lines. |
| `--html FILE` | Also writes a visual HTML report (never contains values) |
| `--open` | Opens the visual report in your browser |
| `--baseline` | Save current problems to `.envdiff-baseline.json`; later runs only report new ones |
| `--ignore-baseline` | Show every problem, including baselined ones |
| `--scan DIR` | Compare with env keys used in source code (`--scan .`) |
| `--json` | Machine-readable report (never contains values) |
| `-h`, `--help` | Help |
| `-v`, `--version` | Version |

## Parsing

Follows common dotenv rules: `export` prefix, `#` comments, single/double/backtick quotes, multiline quoted values (e.g. private keys), and `\"` `\n` `\t` `\\` escapes inside double quotes. An unclosed quote is reported as an invalid line instead of swallowing the rest of the file. No variable expansion (`${VAR}`) yet.

## Alternatives

Good tools already exist; pick the one that fits:

- [dotenv-linter](https://github.com/dotenv-linter/dotenv-linter) (Rust) — lints and auto-fixes `.env` files, and has a command to compare key sets between files.
- [dotenv-diff](https://github.com/Chrilleweb/dotenv-diff) (Node) — scans your codebase for env variable usage and checks it against `.env` / `.env.example`; also has a `--compare` mode.

envdiff focuses on one job: comparing **2 or more** env files where **no value ever appears in the output**, plus catching real secrets committed to template files. Zero dependencies, one GitHub Action line.

## Security

See [SECURITY.md](SECURITY.md). Releases are published from GitHub Actions with [npm provenance](https://docs.npmjs.com/generating-provenance-statements), so you can verify every version was built from this repo.

## License

MIT — part of [Guihakka Tools](https://github.com/Guihakka2/guihakka-tools).
