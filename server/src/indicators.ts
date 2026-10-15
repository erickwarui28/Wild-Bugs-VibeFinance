import { mean, stdev } from "./math.js";

export function sma(values: number[], window: number): number | null {
  if (values.length < window) return null;
  const slice = values.slice(-window);
  return slice.reduce((a, b) => a + b, 0) / window;
}

export function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  for (const v of values) {
    prev = v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function macdHistSign(closes: number[]): number {
  if (closes.length < 35) return 0;
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macd = ema12.map((v, i) => v - (ema26[i] ?? 0));
  const signal = emaSeries(macd, 9);
  const hist = (macd[macd.length - 1] ?? 0) - (signal[signal.length - 1] ?? 0);
  if (hist > 0) return 1;
  if (hist < 0) return -1;
  return 0;
}

export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = (closes[i] ?? 0) - (closes[i - 1] ?? 0);
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function returnOver(closes: number[], n: number): number | null {
  if (closes.length <= n) return null;
  const last = closes[closes.length - 1] ?? 0;
  const prev = closes[closes.length - 1 - n] ?? 0;
  if (prev === 0) return null;
  return last / prev - 1;
}

export function zscoreLast(series: number[]): number | null {
  if (series.length < 5) return null;
  const last = series[series.length - 1] ?? 0;
  const prior = series.slice(0, -1);
  const sd = stdev(prior);
  if (sd === 0) return 0;
  return (last - mean(prior)) / sd;
}

export function rollingReturns(closes: number[], n: number): number[] {
  const out: number[] = [];
  for (let i = n; i < closes.length; i++) {
    const prev = closes[i - n] ?? 0;
    const cur = closes[i] ?? 0;
    if (prev !== 0) out.push(cur / prev - 1);
  }
  return out;
}

export function realisedVol(closes: number[], window = 20): number | null {
  if (closes.length < window + 1) return null;
  const rets: number[] = [];
  const slice = closes.slice(-(window + 1));
  for (let i = 1; i < slice.length; i++) {
    const prev = slice[i - 1] ?? 1;
    rets.push((slice[i] ?? prev) / prev - 1);
  }
  return stdev(rets) * Math.sqrt(252);
}

export function maxDrawdown(closes: number[], window = 60): number | null {
  const slice = closes.slice(-window);
  if (slice.length < 2) return null;
  let peak = slice[0] ?? 1;
  let dd = 0;
  for (const c of slice) {
    peak = Math.max(peak, c);
    dd = Math.min(dd, c / peak - 1);
  }
  return dd;
}

export function beta(stockRets: number[], indexRets: number[]): number | null {
  const n = Math.min(stockRets.length, indexRets.length);
  if (n < 10) return null;
  const s = stockRets.slice(-n);
  const ix = indexRets.slice(-n);
  const ms = mean(s);
  const mi = mean(ix);
  let cov = 0;
  let v = 0;
  for (let i = 0; i < n; i++) {
    cov += ((s[i] ?? 0) - ms) * ((ix[i] ?? 0) - mi);
    v += ((ix[i] ?? 0) - mi) ** 2;
  }
  if (v === 0) return null;
  return cov / v;
}

export function dailyReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1] ?? 1;
    out.push((closes[i] ?? prev) / prev - 1);
  }
  return out;
}

export function sumLast(values: number[], n: number): number | null {
  if (values.length < n) return null;
  return values.slice(-n).reduce((a, b) => a + b, 0);
}
