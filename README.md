# VibeFinance

Explainable, personalised market intelligence from parallel AI agents, with every claim cited.

Not financial advice. Demonstration only. The app runs keyless in mock mode.

## Submission links and hosting

- [Live demo](https://erickwarui28.github.io/vibefinance/)
- [Narrated demo video](https://youtu.be/AGOFE457x9U)
- [Review-only source repository](https://github.com/erickwarui28/Wild-Bugs-VibeFinance)
- [Architecture](docs/architecture.md) and [submission guide](docs/SUBMISSION.md)

This repository is a single-commit source submission, not a GitHub Pages host. The built frontend is published in the `vibefinance/` folder of `erickwarui28.github.io`; the HTTPS API is hosted separately. The profile repository owns the manual VibeFinance quality workflow. Production builds use `VITE_BASE=/vibefinance/`; this URL does not depend on the source repository name.

Use Node.js 22.12 or newer. No production credentials or databases are required for local review. First visits open **Demo** for reproducible synthetic evidence without paid model calls. **Try Live** is optional, and a saved Live selection is remembered.

## Quickstart

```bash
npm ci
npm run build -w shared
npm run seed
npm run dev
```

API: http://localhost:8080/api/health

Web: http://localhost:5173/

`npm test` passes with no API keys and no network, with every feature flag on. `VF_ALL_FEATURES=0 npm test` passes with every flag off.

## Data sources

| Source | Data | Provenance | Note |
|---|---|---|---|
| Seeded generator | Daily OHLCV for 10 NSE symbols | SYNTHETIC | Markov regimes, weekends skipped |
| Seeded filings | Results, transcripts, disclosures | SYNTHETIC | Bodies start with a synthetic-document banner |
| Seeded flows | Sector FII/DII net, ₹ crore | SYNTHETIC | Not a real flow print |
| Yahoo Finance chart | NSE daily OHLCV | LIVE or CACHED | Unofficial server-side source; frozen per-analysis evidence |
| NSE RSS | Announcement titles and available summaries | LIVE or CACHED | Not full filings or earnings transcripts |
| NSE FII/DII CSV | Market-wide net flows | CACHED | Downloaded by hand. Not per sector |
| GDELT | Headlines | LIVE or CACHED | Uneven India coverage |

`npm run snapshot:build` fetches the live sources once. Pin `SNAPSHOT_ID` and set `DATA_MODE=cached`. With no network, `DATA_MODE=synthetic` still passes the tests.

## Flags

`FEATURES` in `server/.env` is a comma list: `x1` live snapshot, `x2` search, `x3` local alerts, `x4` evaluation, `x6` session history, `x7` shared feature prep. `x5` remains accepted for configuration compatibility but legacy calibration is not applied to confidence.

## Evaluation

`npm run backtest` creates an isolated synthetic database and writes `docs/evaluation/backtest.json`, without reading production environment files or calling paid models. A chronological last-30% window has a 30-session purge after development; paired baselines use identical scored rows and coverage reports abstentions. Confidence calibration is disabled. Results are synthetic diagnostics, not validated investment performance.

`npm run latency-report` writes repeated warmed mock-engine measurements to `docs/evaluation/latency.json`. These are not production HTTP latency promises. Both reports record source hashes and configuration. See the [submission guide](docs/SUBMISSION.md) and [architecture](docs/architecture.md).

## Limitations

Live prices are daily close-field observations from an unofficial Yahoo client; the latest bar can be provisional, not a verified final close or licensed real-time quote. NSE announcements are titles and summaries. FII/DII from the CSV are market-wide; sector splits in the demo are synthetic. Transcripts are synthetic. GDELT coverage of Indian companies is uneven. The lexicon is not a model of management intent. One year of 10 symbols is a small evaluation sample. This is not SEBI-registered advice.

## Commercial model

A personalised financial-intelligence layer, offered as a research subscription for retail investors and as an API for fintech platforms, wealth managers and advisory businesses. The trace is the audit trail.

## Not financial advice

Simulated and cached data in this demo are for demonstration. Nothing here is a recommendation to buy or sell a security.
