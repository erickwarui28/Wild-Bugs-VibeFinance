import { AnalyzeRequest, DISCLAIMER, EvaluationReport, LatencyReport, RunRequest, SearchResponse, TICKERS, type Profile } from "@vibefinance/shared";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { listAlerts } from "./alerts.js";
import { getConfig } from "./config.js";
import { ensureSeeded, getDb, getProfile, listProfiles, metaValue, sectorOf } from "./db/db.js";
import { getLiveDoc, liveDocs, searchLiveDocs } from "./data/live/fetch.js";
import { loadMarket } from "./data/providers/index.js";
import { forwardReturn } from "./data/providers/synthetic.js";
import { sessionMetrics } from "./metrics.js";
import { analyze, compare } from "./orchestrator.js";
import { getDoc } from "./rag/retrieve.js";
import { searchChunks } from "./rag/search.js";
import { sessionHistory } from "./sessions.js";
import { readTrace } from "./trace.js";
import { adminPage, adminReset, adminSnapshot, requireAdmin } from "./admin.js";
import { adminOverview, adminRecords } from "./adminRecords.js";
import { UsageLimitError, recordActivity, usageContext } from "./usage.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pLimit from "p-limit";
import { issueIdentity, requireVisitor } from "./identity.js";
import { readSnapshot, snapshotDoc } from "./snapshots.js";
import { requestLifecycle } from "./requestLifecycle.js";
import { analysisRuntimeStatus } from "./analysisRuntime.js";
import { sourceRuntimeStatus } from "./data/live/fetch.js";
import { BusyError, isAbort } from "./reliability.js";

export function createApp() {
  ensureSeeded();
  const cfg = getConfig();
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(express.json({ limit: "1mb" }));
  app.use(usageContext);
  app.use(recordActivity);
  const origins = cfg.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || origins.includes(origin)) cb(null, true);
        else cb(null, false);
      },
    }),
  );
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.VITEST === "true",
    message: { error: "Too many runs", degraded: ["rate_limited"] },
  });
  app.use(["/admin", "/api/admin"], rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.VITEST === "true",
    message: { error: "Too many admin requests. Please try again later." },
  }));

  app.get("/admin", requireAdmin, adminPage);
  app.get("/api/admin/usage", requireAdmin, adminSnapshot);
  app.get("/api/admin/overview", requireAdmin, adminOverview);
  app.get("/api/admin/records/:kind", requireAdmin, adminRecords);
  app.get("/api/admin/export/:kind", requireAdmin, adminRecords);
  app.post("/api/admin/usage/reset", requireAdmin, adminReset);
  app.get("/api/admin/reliability", requireAdmin, (_req, res) => res.json({ analysis: analysisRuntimeStatus(), sources: sourceRuntimeStatus() }));
  app.use(["/api/analyze", "/api/compare", "/api/tickers", "/api/market", "/api/search"], requestLifecycle);

  app.get("/api/health", (_req, res) => {
    const live = getConfig();
    res.json({
      ok: true,
      provider: live.LLM_PROVIDER === "openai" && !live.OPENAI_API_KEY ? "mock" : live.LLM_PROVIDER,
      embeddings: live.EMBEDDINGS,
      seed: live.SEED,
      version: live.version,
      features: [...live.featureSet],
      dataMode: live.DATA_MODE,
      snapshotId: live.SNAPSHOT_ID || null,
      disclaimer: DISCLAIMER,
    });
  });

  app.post("/api/visitor", limiter, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(issueIdentity());
  });

  app.use(["/api/analyze", "/api/compare", "/api/metrics", "/api/alerts", "/api/sessions", "/api/trace", "/api/snapshots"], requireVisitor);
  app.use(["/api/metrics", "/api/alerts", "/api/sessions", "/api/trace", "/api/snapshots"], (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store"); next();
  });

  app.get("/api/snapshots/:id/market", (req, res) => {
    const snapshot = readSnapshot(String(req.params.id), res.locals.authenticatedVisitor);
    if (!snapshot) { res.status(404).json({ error: "Snapshot not found for this visitor" }); return; }
    res.json({ bars: snapshot.market.bars, ticker: snapshot.ticker, asOf: snapshot.asOf,
      snapshotId: snapshot.id, capturedAt: snapshot.capturedAt, provenance: snapshot.market.provenance, disclaimer: DISCLAIMER });
  });

  app.get("/api/tickers", async (req, res, next) => {
    try {
    const mode = req.query.mode === "live" || req.query.mode === "demo" ? req.query.mode : undefined;
    const asOf = mode === "live" ? new Date().toISOString().slice(0, 10) : (metaValue("as_of") ?? "");
    const limit = pLimit(mode === "live" ? 4 : 10);
    const rows = (
      await Promise.all(
        TICKERS.map((ticker) =>
          limit(async () => {
            try {
              res.locals.requestSignal.throwIfAborted();
              const market = await loadMarket(ticker, asOf, [], mode, true, res.locals.requestSignal);
              const last = market.bars[market.bars.length - 1];
              return {
                ticker,
                sector: sectorOf(ticker),
                lastClose: last?.close ?? 0,
                provenance: last?.provenance ?? "SYNTHETIC",
                asOf: last?.date ?? asOf,
              };
            } catch (err) {
              res.locals.requestSignal.throwIfAborted();
              if (mode !== "live") throw err;
              return null;
            }
          }),
        ),
      )
    ).filter((row): row is NonNullable<typeof row> => Boolean(row));
    res.json({ tickers: rows, disclaimer: DISCLAIMER });
    } catch (error) { next(error); }
  });

  app.get("/api/market/:ticker", async (req, res, next) => {
    try {
    const ticker = String(req.params.ticker).toUpperCase();
    if (!(TICKERS as readonly string[]).includes(ticker)) { res.status(400).json({ error: "Unsupported ticker" }); return; }
    const mode = req.query.mode === "live" || req.query.mode === "demo" ? req.query.mode : undefined;
    const asOf = String(req.query.asOf ?? (mode === "live" ? new Date().toISOString().slice(0, 10) : metaValue("as_of") ?? ""));
    const market = await loadMarket(ticker, asOf, [], mode, true, res.locals.requestSignal);
    res.json({
      ticker,
      asOf,
      bars: market.bars,
      fwdRet30: forwardReturn(ticker, asOf),
      provenance: market.provenance,
      disclaimer: DISCLAIMER,
    });
    } catch (error) { next(error); }
  });

  app.get("/api/profiles", (_req, res) => {
    res.json({ profiles: listProfiles(), disclaimer: DISCLAIMER });
  });

  app.get("/api/profiles/:id", (req, res) => {
    const profile = getProfile(String(req.params.id));
    if (!profile) {
      res.status(404).json({ error: "Unknown profile", degraded: [] });
      return;
    }
    res.json({ profile, disclaimer: DISCLAIMER });
  });

  app.post("/api/analyze", limiter, async (req, res, next) => {
    try {
      const parsed = AnalyzeRequest.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join("; "), degraded: [] });
        return;
      }
      const body = parsed.data;
      const mode = body.mode === "live" || body.mode === "demo" ? body.mode : undefined;
      const synthesis = await analyze({
        ticker: body.ticker.toUpperCase(),
        profileId: body.profileId,
        sessionId: res.locals.authenticatedVisitor,
        degrade: body.degrade,
        mode,
        refresh: body.refresh,
        signal: res.locals.requestSignal,
      });
      res.json(synthesis);
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/compare", limiter, async (req, res, next) => {
    try {
      const parsed = RunRequest.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join("; "), degraded: [] });
        return;
      }
      const body = parsed.data;
      const mode = body.mode === "live" || body.mode === "demo" ? body.mode : undefined;
      const result = await compare({ ticker: body.ticker.toUpperCase(), sessionId: res.locals.authenticatedVisitor, degrade: body.degrade, mode, refresh: body.refresh, signal: res.locals.requestSignal });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/trace/:runId", (req, res) => {
    const owned = getDb().prepare("SELECT 1 FROM runs WHERE run_id = ? AND session_id = ?")
      .get(String(req.params.runId), res.locals.authenticatedVisitor);
    if (!owned) { res.status(404).json({ error: "Unknown run for this visitor" }); return; }
    const steps = readTrace(String(req.params.runId));
    if (steps.length === 0) {
      res.status(404).json({ error: "Unknown run", degraded: [] });
      return;
    }
    res.json({ runId: req.params.runId, steps, disclaimer: DISCLAIMER });
  });

  app.get("/api/docs/:docId", (req, res) => {
    if (req.query.snapshotId) {
      res.setHeader("Cache-Control", "private, no-store");
      if (!res.locals.authenticatedVisitor) { res.status(401).json({ error: "Visitor identity required" }); return; }
      const snapshot = readSnapshot(String(req.query.snapshotId), res.locals.authenticatedVisitor);
      const doc = snapshot ? snapshotDoc(snapshot, String(req.params.docId)) : null;
      if (!doc) { res.status(404).json({ error: "Document not found in this analysis snapshot" }); return; }
      res.json({ ...doc, disclaimer: DISCLAIMER }); return;
    }
    const doc = getLiveDoc(String(req.params.docId)) ?? getDoc(String(req.params.docId));
    if (!doc) {
      res.status(404).json({ error: "Unknown document", degraded: [] });
      return;
    }
    res.json({ ...doc, disclaimer: DISCLAIMER });
  });

  app.get("/api/metrics", (_req, res) => {
    const sessionId = res.locals.authenticatedVisitor as string;
    res.json(sessionMetrics(sessionId));
  });

  app.get("/api/alerts", (_req, res) => {
    if (!getConfig().featureSet.has("x3")) {
      res.json({ alerts: [], disclaimer: DISCLAIMER });
      return;
    }
    res.json({ alerts: listAlerts(res.locals.authenticatedVisitor), disclaimer: DISCLAIMER });
  });

  app.get("/api/sessions/:id/history", (_req, res) => {
    if (!getConfig().featureSet.has("x6")) {
      res.status(404).json({ error: "sessions flag is off", degraded: [] });
      return;
    }
    res.json({ decisions: sessionHistory(res.locals.authenticatedVisitor), disclaimer: DISCLAIMER });
  });

  app.get("/api/search", async (req, res, next) => {
    if (!getConfig().featureSet.has("x2")) {
      res.status(404).json({ error: "search flag is off", degraded: [] });
      return;
    }
    const q = String(req.query.q ?? "");
    const ticker = String(req.query.ticker ?? "").toUpperCase();
    if (q.length > 200 || (ticker && ticker !== "*" && !(TICKERS as readonly string[]).includes(ticker))) {
      res.status(400).json({ error: "Search requires a supported ticker and a query of at most 200 characters" }); return;
    }
    try {
      if (req.query.mode === "live") await liveDocs(ticker || "*", res.locals.requestSignal);
      const hits = req.query.mode === "live" ? searchLiveDocs(q, ticker || null) : searchChunks(q, ticker || null);
      res.json(SearchResponse.parse({ hits, disclaimer: DISCLAIMER }));
    } catch (error) { next(error); }
  });

  app.get("/api/eval", (_req, res) => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // Do not resurrect unversioned reports with obsolete calibration claims.
    const roots = [path.resolve(here, "../../docs/evaluation")];
    const read = (name: string) => {
      for (const root of roots) {
        const file = path.join(root, name);
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
      }
      return null;
    };
    const backtest = read("backtest.json"), latency = read("latency.json");
    res.json({ backtest: backtest === null ? null : EvaluationReport.parse(backtest),
      latency: latency === null ? null : LatencyReport.parse(latency), disclaimer: DISCLAIMER });
  });

  app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    if (res.destroyed || res.writableEnded || res.headersSent) return;
    if (isAbort(err)) { res.status(499).json({ error: "Request cancelled", degraded: ["cancelled"] }); return; }
    if (err instanceof BusyError) res.setHeader("Retry-After", "3");
    const status = err instanceof UsageLimitError ? 429 : (err.status ?? 500);
    res.status(status).json({ error: err.message || "Request failed", degraded: ["error"] });
  });

  return app;
}

export type { Profile };
