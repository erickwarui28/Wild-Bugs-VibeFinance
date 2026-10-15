import { hashString } from "../math.js";

const DIM = 512;

export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
}

export function embedLocal(text: string): number[] {
  const vec = new Array<number>(DIM).fill(0);
  const tokens = tokenize(text);
  const grams = [...tokens];
  for (let i = 0; i < tokens.length - 1; i++) grams.push(`${tokens[i]}_${tokens[i + 1]}`);
  const tf = new Map<string, number>();
  for (const g of grams) tf.set(g, (tf.get(g) ?? 0) + 1);
  for (const [g, c] of tf) {
    const h = hashString(g);
    const idx = Math.abs(h) % DIM;
    const sign = (h & 1) === 0 ? 1 : -1;
    vec[idx] = (vec[idx] ?? 0) + sign * (1 + Math.log(c));
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

export function parseVec(raw: string): number[] {
  const parsed = JSON.parse(raw) as number[];
  return parsed;
}

export const LOCAL_DIM = DIM;
