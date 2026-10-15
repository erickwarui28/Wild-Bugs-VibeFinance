import { COMPANY_NAME, TICKERS, type Ticker } from "@vibefinance/shared";
import seedrandom from "seedrandom";
import { wordCount } from "../math.js";

export interface InternalDoc {
  id: string;
  ticker: string;
  type: string;
  date: string;
  title: string;
  body: string;
  synthetic: true;
}

const POS = "Revenue growth remained strong and the company reported a record quarter, an earnings beat, margin expansion, and an upgrade to full-year guidance. Management sounded optimistic.";
const NEG = "The call disclosed a guidance cut, a margin miss, weaker demand, and a decline versus last year. Management flagged concern about the outlook.";
const NEUTRAL = "Volumes were stable and management kept annual guidance flat. Margins moved within the usual seasonal range.";

const FILLER = [
  "The board reviewed ordinary-course capital expenditure and confirmed that no unpublished price-sensitive information is being withheld beyond this note.",
  "Working capital moved with the festival calendar and collections remained inside the internal policy band.",
  "Employee costs, depreciation, and finance costs were in line with the plan discussed at the previous meeting.",
  "The audit committee took note of related-party transactions, all of which were on an arm's-length basis.",
  "Geographic mix was unchanged. Domestic demand and export realisation offset each other during the quarter.",
  "Management reiterated that this document is a synthetic teaching fixture and not a filing made with any regulator.",
  "Capacity utilisation, order backlog, and dealer inventory were described only in qualitative terms.",
  "The risk committee discussed currency, rates, and commodity sensitivity without publishing a new numerical forecast.",
  "Shareholders were reminded that past quarterly patterns in this fixture are generated, not observed in the market.",
  "No dividend recommendation, buyback, or bonus issue is proposed in this synthetic note.",
];

interface Spec {
  ticker: Ticker;
  type: string;
  idSuffix: string;
  title: string;
  lead: string;
  dateOffset: number;
}

const SPECS: Spec[] = [
  { ticker: "INFY", type: "transcript", idSuffix: "Q2-T", title: "Q2 earnings call transcript", lead: `${NEG} Guidance was cut. The tone on the call was cautious and the outlook was revised lower.`, dateOffset: 12 },
  { ticker: "INFY", type: "results", idSuffix: "Q2-R", title: "Q2 results note", lead: NEUTRAL, dateOffset: 14 },
  { ticker: "TCS", type: "results", idSuffix: "Q2-R", title: "Q2 results note", lead: POS, dateOffset: 10 },
  { ticker: "TCS", type: "transcript", idSuffix: "Q2-T", title: "Q2 earnings call transcript", lead: POS, dateOffset: 9 },
  { ticker: "TCS", type: "board", idSuffix: "BD-1", title: "Board meeting outcome", lead: NEUTRAL, dateOffset: 40 },
  { ticker: "RELIANCE", type: "results", idSuffix: "Q2-R", title: "Q2 results note", lead: POS, dateOffset: 18 },
  { ticker: "RELIANCE", type: "transcript", idSuffix: "Q2-T", title: "Q2 earnings call transcript", lead: NEUTRAL, dateOffset: 17 },
  { ticker: "RELIANCE", type: "disclosure", idSuffix: "R30-1", title: "Regulation 30 style event note", lead: NEUTRAL, dateOffset: 30 },
  { ticker: "HDFCBANK", type: "results", idSuffix: "Q2-R", title: "Q2 results note", lead: POS, dateOffset: 20 },
  { ticker: "HDFCBANK", type: "disclosure", idSuffix: "R30-1", title: "Regulation 30 style event note", lead: NEUTRAL, dateOffset: 50 },
  { ticker: "ICICIBANK", type: "results", idSuffix: "Q2-R", title: "Q2 results note", lead: POS, dateOffset: 16 },
  { ticker: "ICICIBANK", type: "transcript", idSuffix: "Q2-T", title: "Q2 earnings call transcript", lead: NEUTRAL, dateOffset: 15 },
  { ticker: "ITC", type: "disclosure", idSuffix: "PLG-1", title: "Pledge disclosure", lead: "A promoter pledge disclosure. The pledge increased. The note is negative. Concern, decline, and a weaker collateral cover were discussed.", dateOffset: 6 },
  { ticker: "ITC", type: "results", idSuffix: "Q2-R", title: "Q2 results note", lead: NEUTRAL, dateOffset: 22 },
  { ticker: "SBIN", type: "results", idSuffix: "Q2-R", title: "Q2 results note", lead: `${POS} This was a strong-results filing with a beat and record operating profit.`, dateOffset: 11 },
  { ticker: "SBIN", type: "transcript", idSuffix: "Q2-T", title: "Q2 earnings call transcript", lead: POS, dateOffset: 10 },
  { ticker: "BHARTIARTL", type: "results", idSuffix: "Q2-R", title: "Q2 results note", lead: POS, dateOffset: 19 },
  { ticker: "BHARTIARTL", type: "disclosure", idSuffix: "R30-1", title: "Regulation 30 style event note", lead: NEUTRAL, dateOffset: 33 },
  { ticker: "LT", type: "results", idSuffix: "Q2-R", title: "Q2 results note", lead: POS, dateOffset: 21 },
  { ticker: "LT", type: "board", idSuffix: "BD-1", title: "Board meeting outcome", lead: NEUTRAL, dateOffset: 28 },
];

function shiftBack(iso: string, tradingSteps: number, dates: string[]): string {
  const idx = dates.indexOf(iso);
  const target = Math.max(0, (idx === -1 ? dates.length - 1 : idx) - tradingSteps);
  return dates[target] ?? iso;
}

function expand(seedKey: string, lead: string, ticker: Ticker): string {
  const rng = seedrandom(seedKey);
  const name = COMPANY_NAME[ticker];
  const parts = [
    "[SYNTHETIC DOCUMENT – for demo only]",
    lead,
    `This synthetic note concerns ${name} (${ticker}) and exists only so a demo can retrieve and cite a paragraph.`,
  ];
  let guard = 0;
  while (wordCount(parts.join(" ")) < 420 && guard < 80) {
    parts.push(FILLER[Math.floor(rng() * FILLER.length)] ?? FILLER[0] ?? "");
    const growth = (2 + rng() * 12).toFixed(1);
    const margin = Math.round(20 + rng() * 80);
    parts.push(
      `Seeded illustration only: revenue growth ${growth} percent and a margin move of ${margin} basis points were written by the generator, not taken from a live filing.`,
    );
    guard++;
  }
  const text = parts.join("\n\n");
  const words = text.split(/\s+/);
  if (words.length > 680) return words.slice(0, 680).join(" ");
  return text;
}

export function generateDocs(seed: number, dates: string[], asOf: string): InternalDoc[] {
  return SPECS.map((spec) => {
    const date = shiftBack(asOf, spec.dateOffset, dates);
    const id = `DOC-${spec.ticker}-${spec.idSuffix}`;
    return {
      id,
      ticker: spec.ticker,
      type: spec.type,
      date,
      title: `${spec.ticker} ${spec.title}`,
      body: expand(`${seed}${id}`, spec.lead, spec.ticker),
      synthetic: true as const,
    };
  });
}

export function plantedTickersPresent(): Ticker[] {
  return TICKERS.filter((t) => t !== "HINDUNILVR");
}
