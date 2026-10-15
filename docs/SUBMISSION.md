# VibeFinance submission guide

## Positioning

Live app: https://erickwarui28.github.io/vibefinance/

Demo video: https://youtu.be/AGOFE457x9U

Review-only source: https://github.com/erickwarui28/Wild-Bugs-VibeFinance

The source repository is a single-commit submission. Frontend hosting and the manual quality workflow belong to the separate `erickwarui28.github.io` repository. The frontend is built for `/vibefinance/`; the source repository name does not determine its public URL.

VibeFinance helps retail investors inspect why market signals disagree and how identical evidence changes under different risk profiles. The differentiator is a frozen, cited reasoning chain with explicit missing evidence, not a claim to predict profitable trades. The commercial hypothesis is a research subscription or embedded fintech API. Demand and willingness to pay remain unvalidated.

## Five minute walkthrough

1. Open Dashboard and choose Demo for a repeatable keyless path. Explain the synthetic label, company, cut-off, example portfolio, four specialist cards and session metrics.
2. Open a sentiment citation and its frozen document passage in Docs. Explain how retrieved text supports tone scoring. Distinguish synthetic transcripts from live announcement summaries.
3. Open Compare. Show three stored profiles receiving identical evidence but different rule-based actions or sizes. If actions coincide, explain sizing and thresholds rather than claiming every input must produce distinct labels.
4. Open Trace. Show concurrent specialist spans, weighted synthesis, disagreements, risk rules and citation enforcement. Explain that arithmetic is deterministic and LLM sentences are constrained to verified facts.
5. In Demo, enable Missing filing and Conflicting agents. Show insufficient evidence, excluded weights and conservative handling. Clear switches afterward. A complete Live outage produces explicit unavailable data, not invented prices.
6. Open Eval. Explain chronological windows, abstentions, same-sample baselines, heuristic Brier, curated retrieval checks and repeated engine timings. Do not present synthetic metrics as live profitability or a production SLA.

## Mandatory and rubric evidence

| Criterion | Weight | Evidence |
|---|---:|---|
| Signal classification | 20 | Four dimensions with labels/confidence/citations; agent contracts and tests |
| Multi-agent synthesis | 20 | Four concurrent specialists, Trace, weighted synthesis and timeout handling |
| Retrieval and attribution | 15 | Frozen citation-to-passage links, Docs, curated retrieval checks |
| Personalization and risk | 15 | Same-snapshot Compare, stored profiles, HHI, behavior/risk rules, divergence tests |
| Engineering and reliability | 10 | Immutable evidence, ownership, persistence, migrations, failure tests, browser QA |
| Performance and evaluation | 10 | Session metrics, synthetic chronological benchmark, paired baselines, timing manifests |
| Explainability and commercial relevance | 10 | Reasoning overview, glossary, evidence coverage, example investor workflow |

The mandatory dashboard, parallel agents, RAG, stored profiles, three session metrics, end-to-end trace, graceful degradation and written architecture all have implementation evidence. Simulated data is allowed by PS 04. Accounts, a hosted vector database and full live transcripts are optional, not prerequisites.

## Reproduction

Use Node 22.12 or newer. Run `npm ci`, `npm run build`, `npm run lint`, `npm test`. Repeat tests with `VF_ALL_FEATURES=0` (PowerShell: set `$env:VF_ALL_FEATURES='0'`, test, then remove it).

`npm run backtest` and `npm run latency-report` generate `docs/evaluation/` reports in isolated temporary databases. They ignore environment files, explicitly select mock/synthetic, never spend the API budget and never modify production calibration. Temporary databases remain in the system temporary directory, not the submission repository. Reports include base revision, dirty-tree indicator and normalized source hash, so pre-commit generation is disclosed rather than misattributed to committed code. Observation hashes support deterministic result comparison. Timing is host-dependent.

Install browsers with `npx playwright install chromium firefox webkit`, then run `npm run test:e2e`. Fixtures use isolated DBs and recorded sources, not production credentials. Linux CI covers Chromium/Firefox/WebKit desktop and Chromium/WebKit mobile. A Chromium visual sweep covers six widths, landscape and 200%-equivalent reflow (720 CSS pixels at 2× pixel density, not native browser zoom certification). Inspect screenshots as well as test status. Automated axe checks are not screen-reader certification.

## Final handoff checklist

- Provide the public app URL, repository and architecture summary.
- Prepare a short recording covering retrieval, Compare, degradation, Trace and metrics. The recording and final portal submission remain human deliverables.
- Verify the latest quality/Pages workflows and backend health; an old failed run does not establish current deployment status.
- Exclude credentials, private notes, production DBs, visitor tokens and organizer attachments from public artifacts.
- Disclose unofficial daily sources, synthetic transcripts/sector flows, designed samples, overlapping outcome windows, uncalibrated confidence and absent execution/cost modeling.
- Confirm organizer deadline, eligibility, recording length, license rules and submission fields against the actual portal. PS 04 does not establish those details.

Real predictive validation, user research, screen-reader/real-device certification and future provider uptime cannot be guaranteed by this demonstration. Do not describe these unknowns as completed checks.
