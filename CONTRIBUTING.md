# Contributing

## Set up

```bash
npm install
npm run dev     # web on http://localhost:5173, API on :8787 (Node 22.13+)
npm test        # node:test, no extra tooling
npm run build   # production frontend build
```

No API keys are needed. Copy `.env.example` to `.env` only if you want to try the optional AI or Gemini audio features.

## Ground rules for changes

- **Money logic stays deterministic.** Amounts are integer paise; the AI fallback never writes to the ledger.
- **Nothing is saved without an explicit confirmation** that carries the pending entry's id.
- **Ledger rows are immutable.** Fix mistakes with linked reversals.
- **Every ledger, report and reminder query is scoped by shop id.** Add a test when you add an endpoint.
- **Use parameterised SQL.** A test fails if a query interpolates values.
- **Ambiguity asks a question.** Do not guess names, dates, amounts or payment direction.
- Add or update tests next to the behaviour you change. The suite must pass (`npm test`) and the build must succeed before a pull request.

## Layout

`server/` (API, ledger, reports, commitments, dates, parser, dialogue), `src/` (React UI, voice loop, state machine), `test/`, `docs/`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/API.md](docs/API.md).
