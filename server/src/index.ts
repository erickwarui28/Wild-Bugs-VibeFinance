import { createApp } from "./app.js";
import { getConfig } from "./config.js";
import { installLiveLoader } from "./data/live/fetch.js";
import { logger } from "./logger.js";
import { getDb } from "./db/db.js";

installLiveLoader();

const app = createApp();
const cfg = getConfig();
// A process interruption leaves billing uncertain; never release those reservations automatically.
getDb().prepare("UPDATE openai_attempts SET status = 'unknown', error_kind = 'process_interrupted' WHERE status = 'pending'").run();
app.listen(cfg.PORT, cfg.HOST, () => {
  logger.info({ port: cfg.PORT, provider: cfg.LLM_PROVIDER, dataMode: cfg.DATA_MODE }, "vibefinance api listening");
});
