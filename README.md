# envdiff

Compare `.env` files across environments (dev, staging, prod, `.env.example`) — **without ever printing secret values**.

Safe to run in CI logs, screenshots and pull requests: values are compared in memory, only key names are shown.

```bash
npx @guihakka2/envdiff            # compares .env.example with .env in this folder
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
- Detects real-looking secrets (AWS, GitHub, OpenAI, Stripe, Slack, Google, private keys) committed in `.example` / `.sample` / `.template` files
- Duplicate keys, empty values, malformed lines
- `--json` output and exit codes for CI: `0` in sync, `1` differences, `2` usage error
- Zero dependencies, runs offline, nothing is sent anywhere

## Use in CI (GitHub Actions)

```yaml
- run: npx @guihakka2/envdiff .env.example .env.ci --keys-only
```

## Options

| Flag | What it does |
|---|---|
| `--keys-only` | Compare key names only (use with `.env.example`) |
| `--json` | Machine-readable report (never contains values) |
| `-h`, `--help` | Help |
| `-v`, `--version` | Version |

## Limitations

Single-line values only (no multiline values or escaped quotes yet). Open an issue if you need them.

## Security

See [SECURITY.md](SECURITY.md). Releases are published from GitHub Actions with [npm provenance](https://docs.npmjs.com/generating-provenance-statements), so you can verify every version was built from this repo.

## License

MIT — part of [Guihakka Tools](https://github.com/Guihakka2/guihakka-tools).
