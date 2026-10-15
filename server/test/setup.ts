import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "vf-"));
process.env.VF_SKIP_ENV_FILES = "1";
process.env.DB_PATH = path.join(dir, "test.db");
process.env.SEED = "42";
process.env.LLM_PROVIDER = "mock";
process.env.DATA_MODE = "synthetic";
process.env.EMBEDDINGS = "local";
process.env.FEATURES = process.env.VF_ALL_FEATURES === "0" ? "" : "x1,x2,x3,x4,x5,x6,x7";
process.env.PORT = "0";
process.env.CORS_ORIGINS = "http://localhost:5173";
process.env.AGENT_TIMEOUT_MS = "8000";
process.env.GDELT_ENABLED = "false";
process.env.LOG_LEVEL = "silent";
