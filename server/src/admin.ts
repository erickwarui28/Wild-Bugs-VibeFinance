import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { getConfig } from "./config.js";
import { resetUsage, usageSnapshot } from "./usage.js";
import { clearAdminSummaryCache } from "./adminRecords.js";
export { adminPage } from "./adminView.js";

function matches(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const cfg = getConfig();
  if (!cfg.ADMIN_USERNAME || !cfg.ADMIN_PASSWORD) { res.status(503).json({ error: "Admin access is not configured." }); return; }
  const header = req.headers.authorization ?? "";
  const decoded = Buffer.from(header.startsWith("Basic ") ? header.slice(6) : "", "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (!matches(colon >= 0 ? decoded.slice(0, colon) : "", cfg.ADMIN_USERNAME) || !matches(colon >= 0 ? decoded.slice(colon + 1) : "", cfg.ADMIN_PASSWORD)) {
    res.setHeader("WWW-Authenticate", 'Basic realm="VibeFinance Admin", charset="UTF-8"');
    res.status(401).send("Authentication required"); return;
  }
  res.setHeader("Cache-Control", "no-store"); next();
}
// Retained for existing clients. New admin UI uses bounded records/overview endpoints.
export function adminSnapshot(req: Request, res: Response): void {
  const offset = Number(req.query.offset ?? 0), limit = Number(req.query.limit ?? 25);
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(limit) || offset < 0 || limit < 1) {
    res.status(400).json({ error: "Invalid pagination parameters" }); return;
  }
  res.json(usageSnapshot(offset, limit));
}
export function adminReset(req: Request, res: Response): void {
  const origin = req.get("origin");
  if ((origin && origin !== `${req.protocol}://${req.get("host")}`) || req.get("sec-fetch-site") === "cross-site") {
    res.status(403).json({ error: "Resets must originate from the admin site" }); return;
  }
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    res.status(400).json({ error: "A JSON reset request is required" }); return;
  }
  const body = req.body as { scope?: string; visitorId?: string; compact?: boolean };
  if (body.scope !== "global" && body.scope !== "visitor" && body.scope !== "budget") {
    res.status(400).json({ error: "scope must be global, visitor or budget" }); return;
  }
  if (body.scope === "visitor" && (typeof body.visitorId !== "string" || !body.visitorId.length || body.visitorId.length > 128)) {
    res.status(400).json({ error: "Valid visitorId is required" }); return;
  }
  try { resetUsage(body.scope, body.visitorId); clearAdminSummaryCache(); res.json(body.compact === true ? { ok: true } : usageSnapshot()); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not reset usage" }); }
}
