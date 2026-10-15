import type Database from "better-sqlite3";
import { buildMarket } from "../data/generator.js";

export const FIXTURE_VERSION = "2";

/** Upgrade only generated seed bars. Never reseed profiles, Live data, history or accounting. */
export function upgradeSeedBars(db: Database.Database, fallbackSeed: number): void {
  const version = db.prepare("SELECT value FROM meta WHERE key='fixture_version'").get() as { value: string } | undefined;
  if (version?.value === FIXTURE_VERSION) return;
  const stored = db.prepare("SELECT value FROM meta WHERE key='seed'").get() as { value: string } | undefined;
  const seed = stored ? Number(stored.value) : fallbackSeed;
  if (!Number.isFinite(seed)) throw new Error("Invalid stored fixture seed");
  const market = buildMarket(seed);
  const update = db.prepare(`UPDATE bars SET open=@open, high=@high, low=@low, close=@close,
    volume=@volume, regime=@regime, spike=@spike, fwd_ret_30=@fwd
    WHERE ticker=@ticker AND date=@date AND provenance='SYNTHETIC' AND origin='synthetic'`);
  db.transaction(() => {
    for (const bars of Object.values(market.bars)) for (const bar of bars)
      update.run({ ...bar, spike: Number(bar.spike), fwd: bar.fwdRet30 });
    db.prepare("INSERT INTO meta(key,value) VALUES('fixture_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(FIXTURE_VERSION);
  })();
}
