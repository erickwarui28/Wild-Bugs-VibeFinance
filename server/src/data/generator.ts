import { ASOF_INDEX, SECTOR_BY_TICKER, SYNTHETIC_ASOF_END, TICKERS, TRADING_DAYS, type Ticker } from "@vibefinance/shared";
import seedrandom from "seedrandom";
import { normal } from "../math.js";

export type Regime = "bull" | "bear" | "sideways";

export interface InternalBar {
  ticker: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  regime: Regime;
  spike: boolean;
  fwdRet30: number | null;
}

export interface InternalFlow {
  date: string;
  sector: string;
  fiiNet: number;
  diiNet: number;
  scope: "sector";
}

const BASE_PRICE: Record<string, number> = {
  RELIANCE: 1000,
  TCS: 1200,
  INFY: 800,
  HDFCBANK: 900,
  ICICIBANK: 700,
  ITC: 400,
  SBIN: 500,
  BHARTIARTL: 850,
  LT: 1100,
  HINDUNILVR: 950,
};

const BASE_VOLUME: Record<string, number> = {
  RELIANCE: 2_500_000,
  TCS: 1_800_000,
  INFY: 3_200_000,
  HDFCBANK: 2_200_000,
  ICICIBANK: 2_000_000,
  ITC: 4_000_000,
  SBIN: 5_000_000,
  BHARTIARTL: 2_800_000,
  LT: 1_200_000,
  HINDUNILVR: 900_000,
};

/** Extra daily drift over the 80 sessions up to and including the as-of day, so planted conflicts are stable at SEED 42. */
const DEMO_DRIFT: Record<string, number> = {
  INFY: 0.0022,
  SBIN: -0.0024,
};

const REGIME_PARAMS: Record<Regime, { mu: number; sigma: number }> = {
  bull: { mu: 0.0008, sigma: 0.011 },
  bear: { mu: -0.0007, sigma: 0.014 },
  sideways: { mu: 0, sigma: 0.008 },
};

export function tradingDaysEnding(endIso: string, n: number): string[] {
  const dates: string[] = [];
  const d = new Date(`${endIso}T00:00:00Z`);
  while (dates.length < n) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return dates.reverse();
}

function nextRegime(current: Regime, rng: () => number): Regime {
  if (rng() < 0.97) return current;
  const options: Regime[] = ["bull", "bear", "sideways"];
  return options[Math.floor(rng() * options.length)] ?? "sideways";
}

export function generateBars(seed: number, dates: string[]): Record<string, InternalBar[]> {
  const out: Record<string, InternalBar[]> = {};
  for (const ticker of TICKERS) {
    const rng = seedrandom(`${seed}${ticker}`);
    let regime: Regime = "sideways";
    let prev = BASE_PRICE[ticker] ?? 1000;
    const bars: InternalBar[] = [];
    for (let i = 0; i < dates.length; i++) {
      regime = nextRegime(regime, rng);
      const params = REGIME_PARAMS[regime];
      let ret = params.mu + params.sigma * normal(rng);
      if (i <= ASOF_INDEX && i > ASOF_INDEX - 80 && DEMO_DRIFT[ticker]) {
        ret += DEMO_DRIFT[ticker] ?? 0;
      }
      const close = Math.max(1, prev * (1 + ret));
      const open = prev;
      const wiggle = Math.abs(normal(rng)) * 0.004;
      const high = Math.max(open, close) * (1 + wiggle);
      const low = Math.min(open, close) * (1 - wiggle);
      const base = BASE_VOLUME[ticker] ?? 1_000_000;
      let volume = Math.exp(Math.log(base) + 0.25 * normal(rng));
      let spike = rng() < 0.02;
      if (spike) volume *= 3 + rng() * 3;
      if (ticker === "ITC" && (i === ASOF_INDEX || i === ASOF_INDEX - 1)) {
        spike = true;
        volume *= 5.5;
      }
      const date = dates[i] ?? dates[0] ?? SYNTHETIC_ASOF_END;
      bars.push({
        ticker,
        date,
        open: roundPrice(open),
        high: roundPrice(high),
        low: roundPrice(low),
        close: roundPrice(close),
        volume: Math.round(volume),
        regime,
        spike,
        fwdRet30: null,
      });
      prev = close;
    }
    imposeDemoPath(ticker, bars, seed);
    for (let t = 0; t < bars.length; t++) {
      const future = bars[t + 30];
      const cur = bars[t];
      if (future && cur) cur.fwdRet30 = future.close / cur.close - 1;
    }
    out[ticker] = bars;
  }
  return out;
}

function roundPrice(n: number): number {
  return Math.round(n * 100) / 100;
}

function imposeDemoPath(ticker: string, bars: InternalBar[], seed: number): void {
  const rng = seedrandom(`${seed}:${ticker}:demo-trend-v2`);
  if (ticker === "INFY") imposeTrend(bars, ASOF_INDEX - 29, ASOF_INDEX, 0.006, "bull", rng);
  if (ticker === "SBIN") imposeTrend(bars, ASOF_INDEX - 29, ASOF_INDEX, -0.007, "bear", rng);
}

function imposeTrend(bars: InternalBar[], from: number, to: number, daily: number, regime: Regime, rng: () => number): void {
  for (let i = Math.max(1, from); i <= to && i < bars.length; i++) {
    const prev = bars[i - 1]?.close ?? 1;
    // Both up and down sessions: a teaching trend, not a zero-variance ramp.
    const change = daily + 0.014 * Math.sin((i - from) * 2.1) + (rng() - 0.5) * 0.006;
    const close = roundPrice(prev * (1 + change));
    const bar = bars[i];
    if (!bar) continue;
    bar.open = roundPrice(prev);
    bar.close = close;
    bar.high = roundPrice(Math.max(prev, close) * 1.004);
    bar.low = roundPrice(Math.min(prev, close) * 0.997);
    bar.regime = regime;
  }
}

export function generateFlows(seed: number, bars: Record<string, InternalBar[]>): InternalFlow[] {
  const dates = bars[TICKERS[0]]?.map((b) => b.date) ?? [];
  const sectors = [...new Set(Object.values(SECTOR_BY_TICKER))];
  const flows: InternalFlow[] = [];
  for (const sector of sectors) {
    const rng = seedrandom(`${seed}flow${sector}`);
    const members = (Object.entries(SECTOR_BY_TICKER) as [Ticker, string][])
      .filter(([, s]) => s === sector)
      .map(([t]) => t);
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i] ?? "";
      const regimes = members.map((t) => bars[t]?.[i]?.regime ?? "sideways");
      const lean = regimes.reduce((s, r) => s + (r === "bull" ? 1 : r === "bear" ? -1 : 0), 0) / Math.max(1, regimes.length);
      const mu = lean * 900;
      const fiiNet = mu + 350 * normal(rng);
      const diiNet = -0.6 * fiiNet + 180 * normal(rng);
      flows.push({
        date,
        sector,
        fiiNet: Math.round(fiiNet * 100) / 100,
        diiNet: Math.round(diiNet * 100) / 100,
        scope: "sector",
      });
    }
  }
  return flows;
}

export function syntheticAsOf(dates: string[]): string {
  return dates[ASOF_INDEX] ?? dates[dates.length - 1] ?? SYNTHETIC_ASOF_END;
}

export function buildMarket(seed: number): { dates: string[]; asOf: string; bars: Record<string, InternalBar[]>; flows: InternalFlow[] } {
  const dates = tradingDaysEnding(SYNTHETIC_ASOF_END, TRADING_DAYS);
  const bars = generateBars(seed, dates);
  const flows = generateFlows(seed, bars);
  return { dates, asOf: syntheticAsOf(dates), bars, flows };
}
