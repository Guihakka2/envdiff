# Security Policy

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting:
**Security tab > Report a vulnerability** on this repository.
You will get a reply within 7 days.

## Design guarantees

- envdiff never prints, logs or exports `.env` values (text and `--json` output contain key names only).
- No network access and zero runtime dependencies.
- npm releases are built by GitHub Actions with provenance; never by hand.
