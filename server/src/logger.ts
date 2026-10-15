import pino from "pino";
import { getConfig } from "./config.js";

export const logger = pino({ level: getConfig().LOG_LEVEL });
