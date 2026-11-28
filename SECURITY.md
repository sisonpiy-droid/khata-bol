# Security policy

Khata Bol is a hackathon prototype with an anonymous demo-session model. It is **not** production authentication and is not ready for real merchants' money records. The controls that exist, and the limits that remain, are written down in [docs/PRIVACY-SECURITY.md](docs/PRIVACY-SECURITY.md).

## Reporting a vulnerability

Please open a private security advisory on this repository (Security tab, "Report a vulnerability") rather than a public issue. Include the steps to reproduce and what you expected. Do not test against other people's sessions or data.

## Scope notes

- API keys are read from environment variables only and are never sent to the browser.
- Secrets must never be committed. `.env` is git-ignored; use `.env.example` as the template.
- Known gaps for production use: real sign-in (for example phone OTP), encryption at rest, backups, a permanent hosted database, and a data-protection review.
