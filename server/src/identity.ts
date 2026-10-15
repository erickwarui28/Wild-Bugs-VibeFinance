import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { getDb } from "./db/db.js";

// Persisted server secret: never returned to clients or written to application logs.
function secret(): string {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('identity_secret_v1', ?)").run(randomBytes(32).toString("hex"));
  return (db.prepare("SELECT value FROM meta WHERE key = 'identity_secret_v1'").get() as { value: string }).value;
}

function signature(id: string): string {
  return createHmac("sha256", secret()).update(`vf-v1:${id}`).digest("base64url");
}

export function issueIdentity(): { token: string; visitorId: string } {
  const visitorId = `visitor_${randomUUID()}`;
  return { visitorId, token: `${visitorId}.${signature(visitorId)}` };
}

export function verifyIdentity(token: string | undefined): string | null {
  if (!token || token.length > 128) return null;
  const parts = token.split(".");
  const id = parts[0];
  if (parts.length !== 2 || !id || !/^visitor_[0-9a-f-]{36}$/.test(id)) return null;
  const actual = Buffer.from(parts[1] ?? "");
  const expected = Buffer.from(signature(id));
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? id : null;
}

export function networkId(ip: string): string {
  // A keyed hash avoids storing raw IPs and resists dictionary enumeration.
  return createHmac("sha256", secret()).update(`network:${ip.replace(/^::ffff:/, "")}`).digest("hex");
}

export function requireVisitor(_req: Request, res: Response, next: NextFunction): void {
  if (!res.locals.authenticatedVisitor) {
    res.status(401).json({ error: "Anonymous visitor identity is missing or invalid. Reload the page to reconnect." });
    return;
  }
  next();
}
