import type { NextFunction, Request, Response } from "express";
import { getConfig } from "./config.js";
import { abortError } from "./reliability.js";

export function requestLifecycle(req: Request, res: Response, next: NextFunction): void {
  const controller = new AbortController();
  const cancel = () => { if (!res.writableEnded) controller.abort(abortError()); cleanup(); };
  const timer = setTimeout(() => controller.abort(Object.assign(new Error("The request deadline was reached. Please retry."), { status: 504 })), getConfig().ANALYSIS_REQUEST_TIMEOUT_MS);
  const cleanup = () => { clearTimeout(timer); req.removeListener("aborted", cancel); res.removeListener("close", cancel); res.removeListener("finish", cleanup); };
  req.once("aborted", cancel); res.once("close", cancel); res.once("finish", cleanup);
  res.locals.requestSignal = controller.signal;
  if (req.aborted || res.destroyed) cancel();
  next();
}
